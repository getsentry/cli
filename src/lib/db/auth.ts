/**
 * Authentication credential storage (single-row table pattern).
 */

import { getDatabase } from "./index.js";

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

export type AuthConfig = {
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
  issuedAt?: number;
};

export async function getAuthConfig(): Promise<AuthConfig | undefined> {
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
  };
}

/** Get the stored token, or undefined if expired. Use refreshToken() for auto-refresh. */
export async function getAuthToken(): Promise<string | undefined> {
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
}

export async function setAuthToken(
  token: string,
  expiresIn?: number,
  newRefreshToken?: string
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  const expiresAt = expiresIn ? now + expiresIn * 1000 : null;
  const issuedAt = expiresIn ? now : null;

  db.query(`
    INSERT INTO auth (id, token, refresh_token, expires_at, issued_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      token = excluded.token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      issued_at = excluded.issued_at,
      updated_at = excluded.updated_at
  `).run(token, newRefreshToken ?? null, expiresAt, issuedAt, now);
}

export async function clearAuth(): Promise<void> {
  const db = getDatabase();
  db.query("DELETE FROM auth WHERE id = 1").run();
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
