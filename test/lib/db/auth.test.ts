/**
 * Auth Environment Variable Tests
 *
 * Note: Core invariants (priority, source tracking, refresh skip, isEnvTokenActive)
 * are tested via property-based tests in auth.property.test.ts. These tests focus on
 * edge cases (whitespace, empty strings), shape assertions, and functions not covered
 * by property tests (isAuthenticated, getActiveEnvVarName).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getActiveEnvVarName,
  getAuthConfig,
  getAuthToken,
  getRawEnvToken,
  isAuthenticated,
  isEnvTokenActive,
  refreshToken,
  setAuthToken,
} from "../../../src/lib/db/auth.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("auth-env-");

let savedAuthToken: string | undefined;
let savedSentryToken: string | undefined;

beforeEach(() => {
  savedAuthToken = process.env.SENTRY_AUTH_TOKEN;
  savedSentryToken = process.env.SENTRY_TOKEN;
  delete process.env.SENTRY_AUTH_TOKEN;
  delete process.env.SENTRY_TOKEN;
});

afterEach(() => {
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

describe("env var auth: getAuthToken edge cases", () => {
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

describe("env var auth: getAuthConfig shape", () => {
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
    expect(isAuthenticated()).toBe(true);
  });

  test("returns false when nothing is set", async () => {
    expect(isAuthenticated()).toBe(false);
  });
});

describe("env var auth: isEnvTokenActive edge case", () => {
  test("returns false for empty env var", () => {
    process.env.SENTRY_AUTH_TOKEN = "";
    expect(isEnvTokenActive()).toBe(false);
  });
});

describe("env var auth: getActiveEnvVarName", () => {
  test("returns SENTRY_AUTH_TOKEN when that var is set", () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    expect(getActiveEnvVarName()).toBe("SENTRY_AUTH_TOKEN");
  });

  test("returns SENTRY_TOKEN when only that var is set", () => {
    process.env.SENTRY_TOKEN = "test_token";
    expect(getActiveEnvVarName()).toBe("SENTRY_TOKEN");
  });

  test("prefers SENTRY_AUTH_TOKEN when both are set", () => {
    process.env.SENTRY_AUTH_TOKEN = "primary";
    process.env.SENTRY_TOKEN = "secondary";
    expect(getActiveEnvVarName()).toBe("SENTRY_AUTH_TOKEN");
  });

  test("falls back to SENTRY_AUTH_TOKEN when no env var is set", () => {
    expect(getActiveEnvVarName()).toBe("SENTRY_AUTH_TOKEN");
  });
});

describe("env var auth: refreshToken edge cases", () => {
  test("env token used when no stored OAuth exists", async () => {
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const result = await refreshToken();
    expect(result.token).toBe("env_token");
    expect(result.refreshed).toBe(false);
  });

  test("stored OAuth preferred over env token", async () => {
    setAuthToken("stored_token", 3600);
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const result = await refreshToken();
    expect(result.token).toBe("stored_token");
    expect(result.refreshed).toBe(false);
  });

  test("SENTRY_FORCE_ENV_TOKEN overrides stored OAuth in refreshToken", async () => {
    setAuthToken("stored_token", 3600);
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    try {
      process.env.SENTRY_FORCE_ENV_TOKEN = "1";
      const result = await refreshToken();
      expect(result.token).toBe("env_token");
      expect(result.refreshed).toBe(false);
    } finally {
      delete process.env.SENTRY_FORCE_ENV_TOKEN;
    }
  });

  test("has no expiresAt or expiresIn for env tokens", async () => {
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const result = await refreshToken();
    expect(result.expiresAt).toBeUndefined();
    expect(result.expiresIn).toBeUndefined();
  });
});

describe("env var auth: getRawEnvToken", () => {
  test("returns SENTRY_TOKEN when SENTRY_AUTH_TOKEN is unset", () => {
    process.env.SENTRY_TOKEN = "fallback_token";
    expect(getRawEnvToken()).toBe("fallback_token");
  });

  test("returns undefined when no env var is set", () => {
    expect(getRawEnvToken()).toBeUndefined();
  });
});

describe("OAuth-preferred auth (#646)", () => {
  test("getAuthConfig prefers stored OAuth over env token", () => {
    setAuthToken("stored_oauth", 3600);
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const config = getAuthConfig();
    expect(config?.source).toBe("oauth");
    expect(config?.token).toBe("stored_oauth");
  });

  test("getAuthConfig falls back to env token when no stored OAuth", () => {
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const config = getAuthConfig();
    expect(config?.source).toBe("env:SENTRY_AUTH_TOKEN");
    expect(config?.token).toBe("env_token");
  });

  test("getAuthToken skips expired stored token and falls to env", () => {
    setAuthToken("expired_token", -1);
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    expect(getAuthToken()).toBe("env_token");
  });

  test("SENTRY_FORCE_ENV_TOKEN makes getAuthConfig prefer env token", () => {
    setAuthToken("stored_oauth", 3600);
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    try {
      process.env.SENTRY_FORCE_ENV_TOKEN = "1";
      const config = getAuthConfig();
      expect(config?.source).toBe("env:SENTRY_AUTH_TOKEN");
      expect(config?.token).toBe("env_token");
    } finally {
      delete process.env.SENTRY_FORCE_ENV_TOKEN;
    }
  });
});
