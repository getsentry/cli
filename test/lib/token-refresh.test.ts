/**
 * Token Refresh Tests
 *
 * Tests for automatic token refresh functionality.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  getValidAuthToken,
  readConfig,
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

describe("getValidAuthToken", () => {
  test("returns token when no expiration is set (manual API token)", async () => {
    await writeConfig({
      auth: {
        token: "manual-api-token",
      },
    });

    const token = await getValidAuthToken();
    expect(token).toBe("manual-api-token");
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

    const token = await getValidAuthToken();
    expect(token).toBe("fresh-token");
  });

  test("throws AuthError when not authenticated", async () => {
    await expect(getValidAuthToken()).rejects.toThrow(AuthError);
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

    await expect(getValidAuthToken()).rejects.toThrow(AuthError);
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
      await getValidAuthToken();
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
    const token = await getValidAuthToken();
    expect(token).toBe("nearly-expired-but-ok");
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
    await expect(getValidAuthToken()).rejects.toThrow();
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
    const { getValidAuthToken: getValidAuthTokenMocked } = await import(
      "../../src/lib/config.js"
    );

    // This should trigger refresh
    const token = await getValidAuthTokenMocked();

    expect(refreshCalled).toBe(true);
    expect(token).toBe(mockNewToken);

    // Verify new tokens were stored
    const config = await readConfig();
    expect(config.auth?.token).toBe(mockNewToken);
    expect(config.auth?.refreshToken).toBe(mockNewRefreshToken);
  });
});
