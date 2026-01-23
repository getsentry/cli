/**
 * Configuration Management
 *
 * Handles reading/writing the ~/.sentry/config.json file.
 * Uses Bun file APIs for I/O and Zod for validation.
 *
 * Permissions follow SSH conventions for sensitive files.
 * @see https://superuser.com/a/215506/26230
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  CachedProject,
  ProjectAliasEntry,
  SentryConfig,
} from "../types/index.js";
import { SentryConfigSchema } from "../types/index.js";

/** Environment variable to override the config directory path */
export const CONFIG_DIR_ENV_VAR = "SENTRY_CONFIG_DIR";

/** Default config directory name (relative to home directory) */
export const DEFAULT_CONFIG_DIR_NAME = ".sentry";

/**
 * Get config directory path (reads env var at runtime for test isolation)
 */
export function getConfigDir(): string {
  return (
    process.env[CONFIG_DIR_ENV_VAR] || join(homedir(), DEFAULT_CONFIG_DIR_NAME)
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
 * use `refreshToken()` instead.
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
export const REFRESH_THRESHOLD = 0.1;

/** Default token lifetime assumption (1 hour) for tokens without issuedAt */
export const DEFAULT_TOKEN_LIFETIME_MS = 3600 * 1000;

export type RefreshTokenOptions = {
  /** Bypass threshold check and always refresh */
  force?: boolean;
};

export type RefreshTokenResult = {
  token: string;
  refreshed: boolean;
  /** Unix timestamp (ms) when token expires */
  expiresAt?: number;
  /** Seconds until token expires */
  expiresIn?: number;
};

/** Shared promise for concurrent refresh requests */
let refreshPromise: Promise<RefreshTokenResult> | null = null;

async function performTokenRefresh(
  storedRefreshToken: string
): Promise<RefreshTokenResult> {
  const { refreshAccessToken } = await import("./oauth.js");
  const { AuthError } = await import("./errors.js");

  try {
    const tokenResponse = await refreshAccessToken(storedRefreshToken);
    const now = Date.now();
    const expiresAt = now + tokenResponse.expires_in * 1000;

    await setAuthToken(
      tokenResponse.access_token,
      tokenResponse.expires_in,
      tokenResponse.refresh_token ?? storedRefreshToken
    );

    return {
      token: tokenResponse.access_token,
      refreshed: true,
      expiresAt,
      expiresIn: tokenResponse.expires_in,
    };
  } catch (error) {
    // Only clear auth if the server explicitly rejected the refresh token.
    // Don't clear on network errors - the existing token may still be valid.
    if (error instanceof AuthError) {
      await clearAuth();
    }
    throw error;
  }
}

/**
 * Get a valid authentication token, refreshing if needed or forced.
 *
 * @param options.force - Bypass threshold check and always refresh (e.g., after 401)
 */
export async function refreshToken(
  options: RefreshTokenOptions = {}
): Promise<RefreshTokenResult> {
  const { force = false } = options;
  const { AuthError } = await import("./errors.js");
  const config = await readConfig();

  if (!config.auth?.token) {
    throw new AuthError("not_authenticated");
  }

  const now = Date.now();
  const expiresAt = config.auth.expiresAt;

  // Token without expiry - return as-is (can't refresh)
  if (!expiresAt) {
    return { token: config.auth.token, refreshed: false };
  }

  const issuedAt =
    config.auth.issuedAt ?? expiresAt - DEFAULT_TOKEN_LIFETIME_MS;
  const totalLifetime = expiresAt - issuedAt;
  const remainingLifetime = expiresAt - now;
  const remainingRatio = remainingLifetime / totalLifetime;
  const expiresIn = Math.max(0, Math.floor(remainingLifetime / 1000));

  // Return existing token if still valid and not forcing refresh
  if (!force && remainingRatio > REFRESH_THRESHOLD && now < expiresAt) {
    return {
      token: config.auth.token,
      refreshed: false,
      expiresAt,
      expiresIn,
    };
  }

  if (!config.auth.refreshToken) {
    await clearAuth();
    throw new AuthError(
      "expired",
      "Session expired and no refresh token available. Run 'sentry auth login'."
    );
  }

  // Deduplicate concurrent refresh requests
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
  newRefreshToken?: string
): Promise<void> {
  const now = Date.now();
  const expiresAt = expiresIn ? now + expiresIn * 1000 : undefined;
  const issuedAt = expiresIn ? now : undefined;

  await updateConfig({
    auth: {
      token,
      refreshToken: newRefreshToken,
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

// ─────────────────────────────────────────────────────────────────────────────
// Project Aliases (for short issue ID resolution)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set project aliases for short issue ID resolution.
 * Called by `issue list` when multiple projects are detected.
 *
 * @param aliases - Map of alias letter (A, B, C...) to org/project
 */
export async function setProjectAliases(
  aliases: Record<string, ProjectAliasEntry>
): Promise<void> {
  const config = await readConfig();
  config.projectAliases = {
    aliases,
    cachedAt: Date.now(),
  };
  await writeConfig(config);
}

/**
 * Get project aliases for short issue ID resolution.
 *
 * @returns Map of alias letter to org/project, or undefined if not set
 */
export async function getProjectAliases(): Promise<
  Record<string, ProjectAliasEntry> | undefined
> {
  const config = await readConfig();
  return config.projectAliases?.aliases;
}

/**
 * Get a specific project by its alias.
 *
 * @param alias - The alias letter (A, B, C...)
 * @returns Project entry or undefined if not found
 */
export async function getProjectByAlias(
  alias: string
): Promise<ProjectAliasEntry | undefined> {
  const aliases = await getProjectAliases();
  // Case-insensitive lookup (aliases are stored lowercase)
  return aliases?.[alias.toLowerCase()];
}

/**
 * Clear project aliases
 */
export async function clearProjectAliases(): Promise<void> {
  const config = await readConfig();
  config.projectAliases = undefined;
  await writeConfig(config);
}
