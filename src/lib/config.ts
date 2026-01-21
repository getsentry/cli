/**
 * Configuration Management
 *
 * Handles reading/writing the ~/.sentry-cli-next/config.json file.
 * Uses Bun file APIs for I/O and Zod for validation.
 *
 * Permissions follow SSH conventions for sensitive files.
 * @see https://superuser.com/a/215506/26230
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CachedProject, SentryConfig } from "../types/index.js";
import { SentryConfigSchema } from "../types/index.js";

/**
 * Get config directory path (reads env var at runtime for test isolation)
 */
function getConfigDir(): string {
  return (
    process.env.SENTRY_CLI_CONFIG_DIR || join(homedir(), ".sentry-cli-next")
  );
}

/**
 * Get config file path
 */
function getConfigFile(): string {
  return join(getConfigDir(), "config.json");
}

/**
 * Ensure the config directory exists
 *
 * Permissions:
 * - Directory: 700 (drwx------)
 * - Config file: 600 (-rw-------)
 *
 * Using node:fs for directory creation to support explicit permissions.
 * mkdirSync with recursive: true is idempotent - it won't fail if dir exists.
 */
function ensureConfigDir(): void {
  mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
}

/**
 * Read the configuration file with Zod validation
 */
export async function readConfig(): Promise<SentryConfig> {
  try {
    const configFile = getConfigFile();
    const file = Bun.file(configFile);
    if (!(await file.exists())) {
      return {};
    }
    const content = await file.json();
    // Validate with Zod, using safeParse to avoid throwing on invalid config
    const result = SentryConfigSchema.safeParse(content);
    if (result.success) {
      return result.data;
    }
    // If validation fails, return empty config (don't crash on corrupted file)
    console.error("Warning: Config file has invalid format, using defaults");
    return {};
  } catch {
    return {};
  }
}

/**
 * Write the configuration file
 *
 * Note: Bun.write doesn't support mode option, but the directory
 * permissions (700) provide adequate protection for the config file.
 */
export async function writeConfig(config: SentryConfig): Promise<void> {
  ensureConfigDir();
  await Bun.write(getConfigFile(), JSON.stringify(config, null, 2));
}

/**
 * Update specific fields in the configuration
 */
export async function updateConfig(
  updates: Partial<SentryConfig>
): Promise<SentryConfig> {
  const config = await readConfig();
  const newConfig = { ...config, ...updates };
  await writeConfig(newConfig);
  return newConfig;
}

/**
 * Get the stored authentication token.
 *
 * Returns undefined if the token has expired. For automatic token refresh,
 * use `getValidAuthToken()` instead.
 */
export async function getAuthToken(): Promise<string | undefined> {
  const config = await readConfig();

  // Check if token has expired
  if (config.auth?.expiresAt && Date.now() > config.auth.expiresAt) {
    return;
  }

  return config.auth?.token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Automatic Token Refresh
// ─────────────────────────────────────────────────────────────────────────────

/** Refresh when less than 10% of token lifetime remains */
const REFRESH_THRESHOLD = 0.1;

/** Default token lifetime assumption (1 hour) for tokens without issuedAt */
const DEFAULT_TOKEN_LIFETIME_MS = 3600 * 1000;

/** Shared promise for concurrent refresh requests */
let refreshPromise: Promise<string> | null = null;

async function performTokenRefresh(refreshToken: string): Promise<string> {
  const { refreshAccessToken } = await import("./oauth.js");

  try {
    const tokenResponse = await refreshAccessToken(refreshToken);
    await setAuthToken(
      tokenResponse.access_token,
      tokenResponse.expires_in,
      tokenResponse.refresh_token ?? refreshToken
    );
    return tokenResponse.access_token;
  } catch (error) {
    await clearAuth();
    throw error;
  }
}

/**
 * Get a valid authentication token, refreshing proactively if needed.
 */
export async function getValidAuthToken(): Promise<string> {
  const { AuthError } = await import("./errors.js");
  const config = await readConfig();

  if (!config.auth?.token) {
    throw new AuthError("not_authenticated");
  }

  if (!config.auth.expiresAt) {
    return config.auth.token;
  }

  const now = Date.now();
  const expiresAt = config.auth.expiresAt;
  const issuedAt =
    config.auth.issuedAt ?? expiresAt - DEFAULT_TOKEN_LIFETIME_MS;
  const totalLifetime = expiresAt - issuedAt;
  const remainingLifetime = expiresAt - now;
  const remainingRatio = remainingLifetime / totalLifetime;

  if (remainingRatio > REFRESH_THRESHOLD && now < expiresAt) {
    return config.auth.token;
  }

  if (!config.auth.refreshToken) {
    await clearAuth();
    throw new AuthError(
      "expired",
      "Session expired and no refresh token available. Run 'sentry auth login'."
    );
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = performTokenRefresh(config.auth.refreshToken);
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * Store authentication credentials
 */
export async function setAuthToken(
  token: string,
  expiresIn?: number,
  refreshToken?: string
): Promise<void> {
  const now = Date.now();
  const expiresAt = expiresIn ? now + expiresIn * 1000 : undefined;
  const issuedAt = expiresIn ? now : undefined;

  await updateConfig({
    auth: {
      token,
      refreshToken,
      expiresAt,
      issuedAt,
    },
  });
}

/**
 * Clear authentication credentials
 */
export async function clearAuth(): Promise<void> {
  const config = await readConfig();
  config.auth = undefined;
  await writeConfig(config);
}

/**
 * Get default organization
 */
export async function getDefaultOrganization(): Promise<string | undefined> {
  const config = await readConfig();
  return config.defaults?.organization;
}

/**
 * Get default project
 */
export async function getDefaultProject(): Promise<string | undefined> {
  const config = await readConfig();
  return config.defaults?.project;
}

/**
 * Set default organization and/or project
 */
export async function setDefaults(
  organization?: string,
  project?: string
): Promise<void> {
  const config = await readConfig();
  config.defaults = {
    ...config.defaults,
    ...(organization && { organization }),
    ...(project && { project }),
  };
  await writeConfig(config);
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getAuthToken();
  return !!token;
}

/**
 * Get the config file path (for display purposes)
 */
export function getConfigPath(): string {
  return getConfigFile();
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate cache key for a project
 */
function projectCacheKey(orgId: string, projectId: string): string {
  return `${orgId}:${projectId}`;
}

/**
 * Get cached project information
 *
 * @param orgId - Organization ID (numeric)
 * @param projectId - Project ID (numeric)
 * @returns Cached project info or undefined if not cached
 */
export async function getCachedProject(
  orgId: string,
  projectId: string
): Promise<CachedProject | undefined> {
  const config = await readConfig();
  const key = projectCacheKey(orgId, projectId);
  return config.projectCache?.[key];
}

/**
 * Cache project information
 *
 * @param orgId - Organization ID (numeric)
 * @param projectId - Project ID (numeric)
 * @param info - Project information to cache
 */
export async function setCachedProject(
  orgId: string,
  projectId: string,
  info: Omit<CachedProject, "cachedAt">
): Promise<void> {
  const config = await readConfig();
  const key = projectCacheKey(orgId, projectId);

  config.projectCache = {
    ...config.projectCache,
    [key]: {
      ...info,
      cachedAt: Date.now(),
    },
  };

  await writeConfig(config);
}

/**
 * Clear the project cache
 */
export async function clearProjectCache(): Promise<void> {
  const config = await readConfig();
  config.projectCache = undefined;
  await writeConfig(config);
}
