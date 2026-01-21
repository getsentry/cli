/**
 * Token Refresh Tests
 *
 * Tests for automatic token refresh functionality.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  readConfig,
  refreshToken,
  setAuthToken,
  writeConfig,
} from "../../src/lib/config.js";
import { AuthError } from "../../src/lib/errors.js";

// Each test gets its own config directory
let testConfigDir: string;

beforeEach(() => {
  testConfigDir = join(
    process.env.SENTRY_CLI_CONFIG_DIR!,
    `test-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env.SENTRY_CLI_CONFIG_DIR = testConfigDir;
});

afterEach(() => {
  try {
    rmSync(testConfigDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("setAuthToken with issuedAt", () => {
  test("stores issuedAt timestamp when expiresIn is provided", async () => {
    const before = Date.now();
    await setAuthToken("test-token", 3600, "refresh-token");
    const after = Date.now();

    const config = await readConfig();
    expect(config.auth?.issuedAt).toBeGreaterThanOrEqual(before);
    expect(config.auth?.issuedAt).toBeLessThanOrEqual(after);
  });

  test("does not store issuedAt when expiresIn is not provided", async () => {
    await setAuthToken("manual-api-token");

    const config = await readConfig();
    expect(config.auth?.issuedAt).toBeUndefined();
    expect(config.auth?.expiresAt).toBeUndefined();
  });
});

describe("refreshToken", () => {
  test("returns token when no expiration is set (manual API token)", async () => {
    await writeConfig({
      auth: {
        token: "manual-api-token",
      },
    });

    const result = await refreshToken();
    expect(result.token).toBe("manual-api-token");
    expect(result.refreshed).toBe(false);
  });

  test("returns token when more than 10% of lifetime remains", async () => {
    const now = Date.now();
    const lifetime = 3600 * 1000; // 1 hour

    await writeConfig({
      auth: {
        token: "fresh-token",
        issuedAt: now - lifetime * 0.5, // 50% elapsed
        expiresAt: now + lifetime * 0.5, // 50% remaining
      },
    });

    const result = await refreshToken();
    expect(result.token).toBe("fresh-token");
    expect(result.refreshed).toBe(false);
    expect(result.expiresIn).toBeGreaterThan(0);
  });

  test("throws AuthError when not authenticated", async () => {
    await expect(refreshToken()).rejects.toThrow(AuthError);
  });

  test("throws AuthError when token is expired and no refresh token", async () => {
    await writeConfig({
      auth: {
        token: "expired-token",
        issuedAt: Date.now() - 7200 * 1000,
        expiresAt: Date.now() - 3600 * 1000, // Expired 1 hour ago
        // No refreshToken
      },
    });

    await expect(refreshToken()).rejects.toThrow(AuthError);
    // Auth was cleared by the first call, so verify that separately
    const config = await readConfig();
    expect(config.auth).toBeUndefined();
  });

  test("clears auth when expired with no refresh token", async () => {
    await writeConfig({
      auth: {
        token: "expired-token",
        expiresAt: Date.now() - 1000,
      },
    });

    try {
      await refreshToken();
    } catch {
      // Expected
    }

    const config = await readConfig();
    expect(config.auth).toBeUndefined();
  });
});

describe("proactive refresh threshold", () => {
  test("token with 11% remaining is considered fresh", async () => {
    const now = Date.now();
    const lifetime = 3600 * 1000; // 1 hour
    const elapsed = lifetime * 0.89; // 89% elapsed, 11% remaining

    await writeConfig({
      auth: {
        token: "nearly-expired-but-ok",
        issuedAt: now - elapsed,
        expiresAt: now + lifetime * 0.11,
        refreshToken: "refresh-token",
      },
    });

    // Should return token without refreshing (>10% remaining)
    const result = await refreshToken();
    expect(result.token).toBe("nearly-expired-but-ok");
    expect(result.refreshed).toBe(false);
  });

  test("token with 9% remaining triggers refresh threshold", async () => {
    const now = Date.now();
    const lifetime = 3600 * 1000;
    const remaining = lifetime * 0.09; // 9% remaining

    await writeConfig({
      auth: {
        token: "needs-refresh",
        issuedAt: now - lifetime + remaining,
        expiresAt: now + remaining,
        refreshToken: "refresh-token",
      },
    });

    // This would attempt refresh if refreshAccessToken wasn't mocked
    // Since it's not mocked, this will fail to refresh, but proves the threshold triggers
    await expect(refreshToken()).rejects.toThrow();
  });
});

describe("token storage on refresh", () => {
  test("setAuthToken with refresh token stores all fields correctly", async () => {
    const before = Date.now();
    await setAuthToken("new-access-token", 7200, "new-refresh-token");
    const after = Date.now();

    const config = await readConfig();
    expect(config.auth?.token).toBe("new-access-token");
    expect(config.auth?.refreshToken).toBe("new-refresh-token");
    expect(config.auth?.expiresAt).toBeGreaterThanOrEqual(before + 7200 * 1000);
    expect(config.auth?.expiresAt).toBeLessThanOrEqual(after + 7200 * 1000);
    expect(config.auth?.issuedAt).toBeGreaterThanOrEqual(before);
    expect(config.auth?.issuedAt).toBeLessThanOrEqual(after);
  });
});

describe("token refresh with mocked oauth", () => {
  test("calls refreshAccessToken and stores new tokens when below threshold", async () => {
    // Track if refresh was called
    let refreshCalled = false;
    const mockNewToken = "refreshed-access-token";
    const mockNewRefreshToken = "refreshed-refresh-token";

    // Mock the oauth module
    mock.module("../../src/lib/oauth.js", () => ({
      refreshAccessToken: async () => {
        refreshCalled = true;
        return {
          access_token: mockNewToken,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: mockNewRefreshToken,
        };
      },
    }));

    // Set up a token that needs refresh (5% remaining)
    const now = Date.now();
    const lifetime = 3600 * 1000;
    const remaining = lifetime * 0.05;

    await writeConfig({
      auth: {
        token: "old-token",
        issuedAt: now - lifetime + remaining,
        expiresAt: now + remaining,
        refreshToken: "old-refresh-token",
      },
    });

    // Re-import to get mocked version
    const { refreshToken: refreshTokenMocked } = await import(
      "../../src/lib/config.js"
    );

    // This should trigger refresh
    const result = await refreshTokenMocked();

    expect(refreshCalled).toBe(true);
    expect(result.token).toBe(mockNewToken);
    expect(result.refreshed).toBe(true);

    // Verify new tokens were stored
    const config = await readConfig();
    expect(config.auth?.token).toBe(mockNewToken);
    expect(config.auth?.refreshToken).toBe(mockNewRefreshToken);
  });
});

describe("force refresh", () => {
  test("force: true refreshes even when token has plenty of lifetime remaining", async () => {
    let refreshCalled = false;
    const mockNewToken = "force-refreshed-token";

    mock.module("../../src/lib/oauth.js", () => ({
      refreshAccessToken: async () => {
        refreshCalled = true;
        return {
          access_token: mockNewToken,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "new-refresh-token",
        };
      },
    }));

    // Set up a token with 90% remaining (way above threshold)
    const now = Date.now();
    const lifetime = 3600 * 1000;

    await writeConfig({
      auth: {
        token: "valid-token",
        issuedAt: now - lifetime * 0.1, // 10% elapsed
        expiresAt: now + lifetime * 0.9, // 90% remaining
        refreshToken: "old-refresh-token",
      },
    });

    // Re-import to get mocked version
    const { refreshToken: refreshTokenMocked } = await import(
      "../../src/lib/config.js"
    );

    // Without force, should NOT refresh
    const normalResult = await refreshTokenMocked();
    expect(normalResult.refreshed).toBe(false);
    expect(normalResult.token).toBe("valid-token");

    // Reset for force test
    refreshCalled = false;

    // With force: true, SHOULD refresh
    const forceResult = await refreshTokenMocked({ force: true });
    expect(refreshCalled).toBe(true);
    expect(forceResult.refreshed).toBe(true);
    expect(forceResult.token).toBe(mockNewToken);
  });
});

describe("server-side token revocation scenario", () => {
  test("force refresh works when token appears valid but was revoked server-side", async () => {
    // This test simulates the bug scenario:
    // 1. Client has a token with 90% lifetime remaining (looks valid)
    // 2. Server revokes the token (returns 401)
    // 3. Without force:true, refreshToken() would return the same invalid token
    // 4. With force:true, refreshToken() fetches a new token

    let refreshCalled = false;
    const revokedToken = "revoked-by-server-token";
    const newToken = "fresh-token-after-revocation";

    mock.module("../../src/lib/oauth.js", () => ({
      refreshAccessToken: async () => {
        refreshCalled = true;
        return {
          access_token: newToken,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "new-refresh-token",
        };
      },
    }));

    // Set up a token that looks valid (90% remaining) but imagine server revoked it
    const now = Date.now();
    const lifetime = 3600 * 1000;

    await writeConfig({
      auth: {
        token: revokedToken,
        issuedAt: now - lifetime * 0.1, // 10% elapsed
        expiresAt: now + lifetime * 0.9, // 90% remaining - looks valid!
        refreshToken: "stored-refresh-token",
      },
    });

    const { refreshToken: refreshTokenMocked } = await import(
      "../../src/lib/config.js"
    );

    // Without force: returns the same (revoked) token - this is the bug!
    const withoutForce = await refreshTokenMocked();
    expect(withoutForce.token).toBe(revokedToken);
    expect(withoutForce.refreshed).toBe(false);
    expect(refreshCalled).toBe(false);

    // With force: true (what 401 handler does), fetches new token
    const withForce = await refreshTokenMocked({ force: true });
    expect(withForce.token).toBe(newToken);
    expect(withForce.refreshed).toBe(true);
    expect(refreshCalled).toBe(true);
  });
});
