/**
 * Authentication credential storage (single-row table pattern).
 */

import { withDbSpan } from "../telemetry.js";
import { getDatabase } from "./index.js";
import { upsert } from "./utils.js";

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

export function getAuthConfig(): AuthConfig | undefined {
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
    };
  });
}

/** Get the stored token, or undefined if expired. Use refreshToken() for auto-refresh. */
export function getAuthToken(): string | undefined {
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

    const { sql, values } = upsert(
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
    db.query(sql).run(...values);
  });
}

export function clearAuth(): void {
  withDbSpan("clearAuth", () => {
    const db = getDatabase();
    db.query("DELETE FROM auth WHERE id = 1").run();
    // Also clear user info and org region cache when logging out
    db.query("DELETE FROM user_info WHERE id = 1").run();
    db.query("DELETE FROM org_regions").run();
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
