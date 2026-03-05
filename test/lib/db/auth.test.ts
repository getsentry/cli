/**
 * Auth Environment Variable Tests
 *
 * Tests for SENTRY_AUTH_TOKEN and SENTRY_TOKEN env var support.
 * Verifies priority, source tracking, and interaction with stored tokens.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type AuthSource,
  getAuthConfig,
  getAuthToken,
  isAuthenticated,
  isEnvTokenActive,
  refreshToken,
  setAuthToken,
} from "../../../src/lib/db/auth.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("auth-env-");

/** Save and restore env vars around each test */
let savedAuthToken: string | undefined;
let savedSentryToken: string | undefined;

beforeEach(() => {
  savedAuthToken = process.env.SENTRY_AUTH_TOKEN;
  savedSentryToken = process.env.SENTRY_TOKEN;
  delete process.env.SENTRY_AUTH_TOKEN;
  delete process.env.SENTRY_TOKEN;
});

afterEach(() => {
  // Restore — never leave env vars dangling
  if (savedAuthToken !== undefined) {
    process.env.SENTRY_AUTH_TOKEN = savedAuthToken;
  } else {
    delete process.env.SENTRY_AUTH_TOKEN;
  }
  if (savedSentryToken !== undefined) {
    process.env.SENTRY_TOKEN = savedSentryToken;
  } else {
    delete process.env.SENTRY_TOKEN;
  }
});

describe("env var auth: getAuthToken", () => {
  test("returns SENTRY_AUTH_TOKEN when set", () => {
    process.env.SENTRY_AUTH_TOKEN = "sntrys_token_abc";
    expect(getAuthToken()).toBe("sntrys_token_abc");
  });

  test("returns SENTRY_TOKEN when set", () => {
    process.env.SENTRY_TOKEN = "sntrys_token_xyz";
    expect(getAuthToken()).toBe("sntrys_token_xyz");
  });

  test("SENTRY_AUTH_TOKEN takes priority over SENTRY_TOKEN", () => {
    process.env.SENTRY_AUTH_TOKEN = "auth_token";
    process.env.SENTRY_TOKEN = "sentry_token";
    expect(getAuthToken()).toBe("auth_token");
  });

  test("env var takes priority over stored token", () => {
    setAuthToken("stored_token");
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    expect(getAuthToken()).toBe("env_token");
  });

  test("falls back to stored token when no env var", () => {
    setAuthToken("stored_token");
    expect(getAuthToken()).toBe("stored_token");
  });

  test("ignores empty SENTRY_AUTH_TOKEN", () => {
    process.env.SENTRY_AUTH_TOKEN = "";
    setAuthToken("stored_token");
    expect(getAuthToken()).toBe("stored_token");
  });

  test("ignores whitespace-only SENTRY_AUTH_TOKEN", () => {
    process.env.SENTRY_AUTH_TOKEN = "   ";
    setAuthToken("stored_token");
    expect(getAuthToken()).toBe("stored_token");
  });

  test("trims whitespace from env var", () => {
    process.env.SENTRY_AUTH_TOKEN = "  token_with_spaces  ";
    expect(getAuthToken()).toBe("token_with_spaces");
  });
});

describe("env var auth: getAuthConfig", () => {
  test("returns env source for SENTRY_AUTH_TOKEN", () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    const config = getAuthConfig();
    expect(config).toBeDefined();
    expect(config?.token).toBe("test_token");
    expect(config?.source).toBe("env:SENTRY_AUTH_TOKEN" satisfies AuthSource);
  });

  test("returns env source for SENTRY_TOKEN", () => {
    process.env.SENTRY_TOKEN = "test_token";
    const config = getAuthConfig();
    expect(config).toBeDefined();
    expect(config?.token).toBe("test_token");
    expect(config?.source).toBe("env:SENTRY_TOKEN" satisfies AuthSource);
  });

  test("returns oauth source for stored token", () => {
    setAuthToken("stored_token");
    const config = getAuthConfig();
    expect(config).toBeDefined();
    expect(config?.source).toBe("oauth" satisfies AuthSource);
  });

  test("env config has no refreshToken or expiry", () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    const config = getAuthConfig();
    expect(config?.refreshToken).toBeUndefined();
    expect(config?.expiresAt).toBeUndefined();
    expect(config?.issuedAt).toBeUndefined();
  });
});

describe("env var auth: isAuthenticated", () => {
  test("returns true when env var is set", async () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    expect(await isAuthenticated()).toBe(true);
  });

  test("returns false when nothing is set", async () => {
    expect(await isAuthenticated()).toBe(false);
  });
});

describe("env var auth: isEnvTokenActive", () => {
  test("returns true for SENTRY_AUTH_TOKEN", () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    expect(isEnvTokenActive()).toBe(true);
  });

  test("returns true for SENTRY_TOKEN", () => {
    process.env.SENTRY_TOKEN = "test_token";
    expect(isEnvTokenActive()).toBe(true);
  });

  test("returns false when no env var set", () => {
    expect(isEnvTokenActive()).toBe(false);
  });

  test("returns false for empty env var", () => {
    process.env.SENTRY_AUTH_TOKEN = "";
    expect(isEnvTokenActive()).toBe(false);
  });
});

describe("env var auth: refreshToken", () => {
  test("returns env token without refreshing", async () => {
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const result = await refreshToken();
    expect(result.token).toBe("env_token");
    expect(result.refreshed).toBe(false);
  });

  test("returns env token even with force=true", async () => {
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const result = await refreshToken({ force: true });
    expect(result.token).toBe("env_token");
    expect(result.refreshed).toBe(false);
  });

  test("env token skips stored token entirely", async () => {
    // Store a token that would require refresh (expired)
    setAuthToken("stored_token", -1, "refresh_token");
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const result = await refreshToken();
    expect(result.token).toBe("env_token");
    expect(result.refreshed).toBe(false);
  });

  test("has no expiresAt or expiresIn for env tokens", async () => {
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const result = await refreshToken();
    expect(result.expiresAt).toBeUndefined();
    expect(result.expiresIn).toBeUndefined();
  });
});
