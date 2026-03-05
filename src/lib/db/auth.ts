/**
 * Authentication credential storage (single-row table pattern).
 */

import { withDbSpan } from "../telemetry.js";
import { getDatabase } from "./index.js";
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
 * Read token from environment variables.
 * `SENTRY_AUTH_TOKEN` takes priority over `SENTRY_TOKEN` (matches legacy sentry-cli).
 * Empty or whitespace-only values are treated as unset.
 */
function getEnvToken(): { token: string; source: AuthSource } | undefined {
  const authToken = process.env.SENTRY_AUTH_TOKEN?.trim();
  if (authToken) {
    return { token: authToken, source: "env:SENTRY_AUTH_TOKEN" };
  }
  const sentryToken = process.env.SENTRY_TOKEN?.trim();
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
 * Get the name of the active env var providing authentication.
 * Returns the specific variable name (e.g. "SENTRY_AUTH_TOKEN" or "SENTRY_TOKEN").
 *
 * **Important**: Call only after checking {@link isEnvTokenActive} returns true.
 * Falls back to "SENTRY_AUTH_TOKEN" if no env source is active, which is a safe
 * default for error messages but may be misleading if used unconditionally.
 */
export function getActiveEnvVarName(): string {
  const env = getEnvToken();
  if (env) {
    return env.source.slice(ENV_SOURCE_PREFIX.length);
  }
  return "SENTRY_AUTH_TOKEN";
}

export function getAuthConfig(): AuthConfig | undefined {
  const envToken = getEnvToken();
  if (envToken) {
    return { token: envToken.token, source: envToken.source };
  }

  return withDbSpan("getAuthConfig", () => {
    const db = getDatabase();
    const row = db.query("SELECT * FROM auth WHERE id = 1").get() as
      | AuthRow
      | undefined;

    if (!row?.token) {
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
}

/** Get the active auth token. Checks env vars first, then falls back to SQLite. */
export function getAuthToken(): string | undefined {
  const envToken = getEnvToken();
  if (envToken) {
    return envToken.token;
  }

  return withDbSpan("getAuthToken", () => {
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

export function clearAuth(): void {
  withDbSpan("clearAuth", () => {
    const db = getDatabase();
    db.query("DELETE FROM auth WHERE id = 1").run();
    // Also clear user info, org region cache, and pagination cursors when logging out
    db.query("DELETE FROM user_info WHERE id = 1").run();
    db.query("DELETE FROM org_regions").run();
    db.query("DELETE FROM pagination_cursors").run();
  });
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAuthToken();
  return !!token;
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
  // Env var tokens are assumed valid — no refresh, no expiry check
  const envToken = getEnvToken();
  if (envToken) {
    return { token: envToken.token, refreshed: false };
  }

  const { force = false } = options;
  const { AuthError } = await import("../errors.js");

  const db = getDatabase();
  const row = db.query("SELECT * FROM auth WHERE id = 1").get() as
    | AuthRow
    | undefined;

  if (!row?.token) {
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
