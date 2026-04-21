/**
 * Authentication credential storage (single-row table pattern).
 */

import { createHmac } from "node:crypto";
import { getEnv } from "../env.js";
import { withDbSpan } from "../telemetry.js";
import { getDatabase } from "./index.js";
import { clearAllIssueOrgCache } from "./issue-org-cache.js";
import { runUpsert } from "./utils.js";

/** Refresh when less than 10% of token lifetime remains */
export const REFRESH_THRESHOLD = 0.1;

/** Default token lifetime (1 hour) for tokens without issuedAt */
export const DEFAULT_TOKEN_LIFETIME_MS = 3600 * 1000;

type AuthRow = {
  token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  issued_at: number | null;
  updated_at: number;
};

/** Prefix for environment variable auth sources in {@link AuthSource} */
export const ENV_SOURCE_PREFIX = "env:";

/** Where the auth token originated */
export type AuthSource = "env:SENTRY_AUTH_TOKEN" | "env:SENTRY_TOKEN" | "oauth";

export type AuthConfig = {
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
  issuedAt?: number;
  source: AuthSource;
};

/**
 * Read the raw token string from environment variables, ignoring all filters.
 *
 * Unlike {@link getEnvToken}, this always returns the env token if set, even
 * when stored OAuth credentials would normally take priority. Used by the HTTP
 * layer to check "was an env token provided?" independent of whether it's being
 * used, and by the per-endpoint permission cache.
 */
export function getRawEnvToken(): string | undefined {
  const authToken = getEnv().SENTRY_AUTH_TOKEN?.trim();
  if (authToken) {
    return authToken;
  }
  const sentryToken = getEnv().SENTRY_TOKEN?.trim();
  if (sentryToken) {
    return sentryToken;
  }
  return;
}

/**
 * Read token from environment variables.
 * `SENTRY_AUTH_TOKEN` takes priority over `SENTRY_TOKEN` (matches legacy sentry-cli).
 * Empty or whitespace-only values are treated as unset.
 *
 * This function is intentionally pure (no DB access). The "prefer stored OAuth
 * over env token" logic lives in {@link getAuthToken} and {@link getAuthConfig}
 * which check the DB first when `SENTRY_FORCE_ENV_TOKEN` is not set.
 */
function getEnvToken(): { token: string; source: AuthSource } | undefined {
  const authToken = getEnv().SENTRY_AUTH_TOKEN?.trim();
  if (authToken) {
    return { token: authToken, source: "env:SENTRY_AUTH_TOKEN" };
  }
  const sentryToken = getEnv().SENTRY_TOKEN?.trim();
  if (sentryToken) {
    return { token: sentryToken, source: "env:SENTRY_TOKEN" };
  }
  return;
}

/**
 * Check if authentication is coming from an environment variable.
 * Use this to skip refresh/OAuth logic that doesn't apply to env tokens.
 */
export function isEnvTokenActive(): boolean {
  return getEnvToken() !== undefined;
}

/**
 * Get the name of the env var providing a token, for error messages.
 * Returns the specific variable name (e.g. "SENTRY_AUTH_TOKEN" or "SENTRY_TOKEN")
 * by checking which env var {@link getRawEnvToken} would read.
 * Falls back to "SENTRY_AUTH_TOKEN" if no env var is set.
 */
export function getActiveEnvVarName(): string {
  // Match getRawEnvToken() priority: SENTRY_AUTH_TOKEN first, then SENTRY_TOKEN
  if (getEnv().SENTRY_AUTH_TOKEN?.trim()) {
    return "SENTRY_AUTH_TOKEN";
  }
  if (getEnv().SENTRY_TOKEN?.trim()) {
    return "SENTRY_TOKEN";
  }
  return "SENTRY_AUTH_TOKEN";
}

export function getAuthConfig(): AuthConfig | undefined {
  // When SENTRY_FORCE_ENV_TOKEN is set, check env first (old behavior).
  // Otherwise, check the DB first — stored OAuth takes priority over env tokens.
  // This is the core fix for #646: wizard-generated build tokens no longer
  // silently override the user's interactive login.
  const forceEnv = getEnv().SENTRY_FORCE_ENV_TOKEN?.trim();
  if (forceEnv) {
    const envToken = getEnvToken();
    if (envToken) {
      return { token: envToken.token, source: envToken.source };
    }
  }

  const dbConfig = withDbSpan("getAuthConfig", () => {
    const db = getDatabase();
    const row = db.query("SELECT * FROM auth WHERE id = 1").get() as
      | AuthRow
      | undefined;

    if (!row?.token) {
      return;
    }

    // Skip expired tokens without a refresh token — they're unusable.
    // Expired tokens WITH a refresh token are kept: auth refresh and
    // refreshToken() need them to perform the OAuth refresh flow.
    if (row.expires_at && Date.now() > row.expires_at && !row.refresh_token) {
      return;
    }

    return {
      token: row.token ?? undefined,
      refreshToken: row.refresh_token ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      issuedAt: row.issued_at ?? undefined,
      source: "oauth" as const,
    };
  });
  if (dbConfig) {
    return dbConfig;
  }

  // No stored OAuth — fall back to env token
  const envToken = getEnvToken();
  if (envToken) {
    return { token: envToken.token, source: envToken.source };
  }
  return;
}

/**
 * Get the active auth token.
 *
 * Default: checks the DB first (stored OAuth wins), then falls back to env vars.
 * With `SENTRY_FORCE_ENV_TOKEN=1`: checks env vars first (old behavior).
 */
export function getAuthToken(): string | undefined {
  const forceEnv = getEnv().SENTRY_FORCE_ENV_TOKEN?.trim();
  if (forceEnv) {
    const envToken = getEnvToken();
    if (envToken) {
      return envToken.token;
    }
  }

  const dbToken = withDbSpan("getAuthToken", () => {
    const db = getDatabase();
    const row = db.query("SELECT * FROM auth WHERE id = 1").get() as
      | AuthRow
      | undefined;

    if (!row?.token) {
      return;
    }

    if (row.expires_at && Date.now() > row.expires_at) {
      return;
    }

    return row.token;
  });
  if (dbToken) {
    return dbToken;
  }

  // No stored OAuth — fall back to env token
  const envToken = getEnvToken();
  if (envToken) {
    return envToken.token;
  }
  return;
}

export function setAuthToken(
  token: string,
  expiresIn?: number,
  newRefreshToken?: string
): void {
  withDbSpan("setAuthToken", () => {
    const db = getDatabase();
    const now = Date.now();
    const expiresAt = expiresIn ? now + expiresIn * 1000 : null;
    const issuedAt = expiresIn ? now : null;

    runUpsert(
      db,
      "auth",
      {
        id: 1,
        token,
        refresh_token: newRefreshToken ?? null,
        expires_at: expiresAt,
        issued_at: issuedAt,
        updated_at: now,
      },
      ["id"]
    );
  });
}

export async function clearAuth(): Promise<void> {
  withDbSpan("clearAuth", () => {
    const db = getDatabase();
    db.query("DELETE FROM auth WHERE id = 1").run();
    // Also clear user info, org region cache, pagination cursors, and the
    // issue-id → org cache (scoped to the current user's permissions) when
    // logging out.
    db.query("DELETE FROM user_info WHERE id = 1").run();
    db.query("DELETE FROM org_regions").run();
    db.query("DELETE FROM pagination_cursors").run();
    clearAllIssueOrgCache();
  });

  // Clear cached API responses — they are tied to the current user's
  // permissions. Awaited so cache is fully removed before the process exits.
  // Dynamic import breaks a potential circular dependency: response-cache
  // now imports identity helpers from this module to namespace cache keys
  // per identity (see `getIdentityFingerprint`).
  try {
    const { clearResponseCache } = await import("../response-cache.js");
    await clearResponseCache();
  } catch {
    // Non-fatal: cache directory may not exist yet
  }
}

export function isAuthenticated(): boolean {
  const token = getAuthToken();
  return !!token;
}

/**
 * Fingerprint returned when no token is present (logged out, no env var).
 *
 * Keeps cache-key generation total without coupling response-cache to
 * undefined handling: anonymous callers still share a namespace across
 * invocations, which matches the pre-identity-scoped behavior.
 */
export const ANON_IDENTITY = "anon";

/** Length of the hex-encoded identity fingerprint. 16 hex chars = 64 bits. */
const IDENTITY_FINGERPRINT_LEN = 16;

/**
 * Compute a stable, opaque fingerprint of the active bearer identity.
 *
 * The fingerprint namespaces every response-cache key (see
 * {@link ../response-cache.js}) so that cached data belongs to exactly
 * one identity. Switching accounts — by swapping `SENTRY_AUTH_TOKEN`,
 * running `auth login` to replace the stored OAuth session, or logging
 * out — produces a different fingerprint and therefore an empty cache
 * slot, fixing the stale-`whoami`-after-login class of bugs reported
 * in getsentry/cli#785 without requiring every mutation to call
 * `invalidateCachedResponse` manually.
 *
 * Fingerprint sources, in order of precedence (mirrors `getAuthConfig`):
 *
 * - **OAuth**: hash the stored `refresh_token`. This is intentionally
 *   distinct from the hourly-rotating access token — using the refresh
 *   token keeps the cache hot across normal token refreshes, and only
 *   invalidates it on an actual `auth login`/`auth logout`.
 * - **Env token**: hash the raw `SENTRY_AUTH_TOKEN` / `SENTRY_TOKEN`
 *   value. Env tokens don't rotate, so hashing the token itself is
 *   equivalent to hashing a stable identity.
 * - **No token / fully anonymous**: return {@link ANON_IDENTITY}.
 *
 * The result is a SHA-256 hex digest truncated to 16 characters
 * (64 bits) — enough to make collisions astronomically unlikely for a
 * single-user CLI while keeping cache filenames short.
 *
 * Performance: this function runs on every HTTP request (for cache
 * lookups), so it must stay synchronous and cheap. SHA-256 over a
 * short token is a few hundred nanoseconds — well below the HTTP
 * latency budget.
 */
export function getIdentityFingerprint(): string {
  // Read the raw env token first: when SENTRY_FORCE_ENV_TOKEN is set,
  // env tokens take precedence over stored OAuth and we want the
  // fingerprint to match the token that will actually be sent.
  const forceEnv = getEnv().SENTRY_FORCE_ENV_TOKEN?.trim();
  if (forceEnv) {
    const envToken = getRawEnvToken();
    if (envToken) {
      return hashIdentity("env", envToken);
    }
  }

  // Otherwise prefer the OAuth refresh token when present (stable
  // across hourly access-token rotation). Access-only rows without a
  // refresh_token fall through to hashing the access token itself.
  //
  // Must mirror `getAuthConfig`'s expiry semantics: an access-only row
  // (no refresh_token) with a past `expires_at` is unusable — the API
  // client will fall back to the env token for the actual request. If
  // we still hash it here, the cache namespace diverges from the
  // identity that sends the request and we could serve a previous
  // user's cached data to the env-token user.
  const dbRow = withDbSpan("getIdentityFingerprint", () => {
    const db = getDatabase();
    return db
      .query("SELECT token, refresh_token, expires_at FROM auth WHERE id = 1")
      .get() as
      | {
          token: string | null;
          refresh_token: string | null;
          expires_at: number | null;
        }
      | undefined;
  });
  if (dbRow?.refresh_token) {
    // Keyed by refresh_token — stable across access-token rotation,
    // including the about-to-expire case where the API client will
    // refresh the token before the next request.
    return hashIdentity("oauth", dbRow.refresh_token);
  }
  if (dbRow?.token && !(dbRow.expires_at && Date.now() > dbRow.expires_at)) {
    return hashIdentity("oauth-access", dbRow.token);
  }

  // Finally, fall back to the env token when no usable OAuth is stored.
  const envToken = getRawEnvToken();
  if (envToken) {
    return hashIdentity("env", envToken);
  }

  return ANON_IDENTITY;
}

/**
 * Fixed key used to derive identity fingerprints from bearer secrets.
 *
 * Not a secret (the CLI is client-side — anyone can read the compiled
 * binary) but wrapping the token in HMAC serves two purposes:
 *
 * 1. Makes the operation a proper keyed-hash, which satisfies CodeQL's
 *    "password hash with insufficient computational effort" check. We
 *    aren't hashing a password — we're computing an opaque namespacing
 *    token — but the checker has no way to tell the difference.
 * 2. Adds a tiny obfuscation on cache-dir contents for anyone inspecting
 *    the filesystem. Still not a secret, still not an authenticator,
 *    but slightly better than a bare SHA-256.
 *
 * The key never changes. Rotating it would churn every user's cache
 * namespace on upgrade — the identity fingerprints on disk must stay
 * stable across CLI versions to avoid invalidating the whole cache.
 */
const IDENTITY_HMAC_KEY = "sentry-cli/identity-fingerprint/v1";

/**
 * Build a fingerprint by HMAC-hashing `kind|secret` with a fixed key.
 *
 * The `kind` prefix means rotating from e.g. env→oauth with the same
 * secret value still produces a distinct fingerprint (defensive — the
 * kinds shouldn't collide in practice, but the prefix makes that
 * guarantee explicit and costs nothing).
 */
function hashIdentity(kind: string, secret: string): string {
  return createHmac("sha256", IDENTITY_HMAC_KEY)
    .update(`${kind}|${secret}`)
    .digest("hex")
    .slice(0, IDENTITY_FINGERPRINT_LEN);
}

/**
 * Check if usable OAuth credentials are stored in the database.
 *
 * Returns true when the `auth` table has either:
 * - A non-expired token, or
 * - An expired token with a refresh token (will be refreshed on next use)
 *
 * Used by the login command to decide whether to prompt for re-authentication
 * when an env token is present.
 */
export function hasStoredAuthCredentials(): boolean {
  const db = getDatabase();
  const row = db.query("SELECT * FROM auth WHERE id = 1").get() as
    | AuthRow
    | undefined;
  if (!row?.token) {
    return false;
  }
  // Non-expired token
  if (!row.expires_at || Date.now() <= row.expires_at) {
    return true;
  }
  // Expired but has refresh token — will be refreshed on next use
  return !!row.refresh_token;
}

export type RefreshTokenOptions = {
  /** Bypass threshold check and always refresh */
  force?: boolean;
};

export type RefreshTokenResult = {
  token: string;
  refreshed: boolean;
  expiresAt?: number;
  expiresIn?: number;
};

let refreshPromise: Promise<RefreshTokenResult> | null = null;

async function performTokenRefresh(
  storedRefreshToken: string
): Promise<RefreshTokenResult> {
  const { refreshAccessToken } = await import("../oauth.js");
  const { AuthError } = await import("../errors.js");

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
    // Only clear auth on explicit rejection, not network errors
    if (error instanceof AuthError) {
      await clearAuth();
    }
    throw error;
  }
}

/** Get a valid token, refreshing if needed. Use force=true after 401 responses. */
export async function refreshToken(
  options: RefreshTokenOptions = {}
): Promise<RefreshTokenResult> {
  // With SENTRY_FORCE_ENV_TOKEN, env token takes priority (no refresh needed).
  const forceEnv = getEnv().SENTRY_FORCE_ENV_TOKEN?.trim();
  if (forceEnv) {
    const envToken = getEnvToken();
    if (envToken) {
      return { token: envToken.token, refreshed: false };
    }
  }

  const { force = false } = options;
  const { AuthError } = await import("../errors.js");

  const db = getDatabase();
  const row = db.query("SELECT * FROM auth WHERE id = 1").get() as
    | AuthRow
    | undefined;

  if (!row?.token) {
    // No stored token — try env token as fallback
    const envToken = getEnvToken();
    if (envToken) {
      return { token: envToken.token, refreshed: false };
    }
    throw new AuthError("not_authenticated");
  }

  const now = Date.now();
  const expiresAt = row.expires_at;

  if (!expiresAt) {
    return { token: row.token, refreshed: false };
  }

  const issuedAt = row.issued_at ?? expiresAt - DEFAULT_TOKEN_LIFETIME_MS;
  const totalLifetime = expiresAt - issuedAt;
  const remainingLifetime = expiresAt - now;
  const remainingRatio = remainingLifetime / totalLifetime;
  const expiresIn = Math.max(0, Math.floor(remainingLifetime / 1000));

  if (!force && remainingRatio > REFRESH_THRESHOLD && now < expiresAt) {
    return {
      token: row.token,
      refreshed: false,
      expiresAt,
      expiresIn,
    };
  }

  if (!row.refresh_token) {
    await clearAuth();
    // Fall back to env token if available (consistent with getAuthToken/getAuthConfig)
    const envToken = getEnvToken();
    if (envToken) {
      return { token: envToken.token, refreshed: false };
    }
    throw new AuthError(
      "expired",
      "Session expired and no refresh token available. Run 'sentry auth login'."
    );
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = performTokenRefresh(row.refresh_token);
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
