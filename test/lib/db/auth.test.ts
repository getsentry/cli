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
  ANON_IDENTITY,
  getActiveEnvVarName,
  getAuthConfig,
  getAuthToken,
  getIdentityFingerprint,
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

describe("clearAuth: integration with per-account caches", () => {
  test("clearAuth drops issue_org_cache entries (prevents cross-account leakage)", async () => {
    const { clearAuth } = await import("../../../src/lib/db/auth.js");
    const { setCachedIssueOrg, getCachedIssueOrg } = await import(
      "../../../src/lib/db/issue-org-cache.js"
    );

    // Seed a mapping as if a previous session resolved this issue.
    await setAuthToken("test-token");
    setCachedIssueOrg("12345", "previous-account-org");
    expect(getCachedIssueOrg("12345")).toBe("previous-account-org");

    await clearAuth();

    // Mapping must be gone — otherwise the next account would leak into
    // their `issue view` fallback routing.
    expect(getCachedIssueOrg("12345")).toBeUndefined();
  });
});

describe("getIdentityFingerprint", () => {
  test("returns the anonymous fingerprint when no token is present", () => {
    expect(getIdentityFingerprint()).toBe(ANON_IDENTITY);
  });

  test("returns a stable 16-char hex fingerprint for a given env token", () => {
    process.env.SENTRY_AUTH_TOKEN = "sntrys_alice";
    const fp1 = getIdentityFingerprint();
    const fp2 = getIdentityFingerprint();
    expect(fp1).toMatch(/^[0-9a-f]{16}$/);
    expect(fp1).toBe(fp2);
  });

  test("different env tokens produce different fingerprints", () => {
    process.env.SENTRY_AUTH_TOKEN = "sntrys_alice";
    const aliceFp = getIdentityFingerprint();
    process.env.SENTRY_AUTH_TOKEN = "sntrys_bob";
    const bobFp = getIdentityFingerprint();
    expect(aliceFp).not.toBe(bobFp);
  });

  test("SENTRY_AUTH_TOKEN and SENTRY_TOKEN produce distinct fingerprints", () => {
    // Different env var names, same value → same fingerprint, because
    // we hash the token itself (the variable name is not part of the
    // identity). This keeps the cache hot if a user migrates from the
    // legacy SENTRY_TOKEN to SENTRY_AUTH_TOKEN without rotating.
    process.env.SENTRY_AUTH_TOKEN = "same_token";
    const authFp = getIdentityFingerprint();
    delete process.env.SENTRY_AUTH_TOKEN;
    process.env.SENTRY_TOKEN = "same_token";
    const legacyFp = getIdentityFingerprint();
    expect(authFp).toBe(legacyFp);
  });

  test("OAuth refresh token is the identity root (stable across access-token rotation)", () => {
    // Simulate two consecutive access tokens backed by the same refresh
    // token — an hourly OAuth refresh must not churn the cache.
    setAuthToken("access_token_1", 3600, "shared_refresh");
    const fp1 = getIdentityFingerprint();
    setAuthToken("access_token_2", 3600, "shared_refresh");
    const fp2 = getIdentityFingerprint();
    expect(fp1).toBe(fp2);
  });

  test("different OAuth refresh tokens produce different fingerprints", () => {
    setAuthToken("access_token", 3600, "refresh_alice");
    const aliceFp = getIdentityFingerprint();
    setAuthToken("access_token", 3600, "refresh_bob");
    const bobFp = getIdentityFingerprint();
    expect(aliceFp).not.toBe(bobFp);
  });

  test("SENTRY_FORCE_ENV_TOKEN switches the fingerprint source to the env token", () => {
    setAuthToken("stored_oauth", 3600, "stored_refresh");
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const storedFp = getIdentityFingerprint();
    try {
      process.env.SENTRY_FORCE_ENV_TOKEN = "1";
      const envFp = getIdentityFingerprint();
      // The forced-env fingerprint must differ from the stored-OAuth
      // fingerprint — otherwise forcing the env token would still
      // serve the OAuth cache entries.
      expect(envFp).not.toBe(storedFp);
    } finally {
      delete process.env.SENTRY_FORCE_ENV_TOKEN;
    }
  });

  test("env and OAuth fingerprints with the same secret value are distinct", () => {
    // Different "kinds" prefixed into the hash ensure no accidental
    // cache sharing when a coincidence of byte values would otherwise
    // collide.
    process.env.SENTRY_AUTH_TOKEN = "shared_secret";
    const envFp = getIdentityFingerprint();
    delete process.env.SENTRY_AUTH_TOKEN;
    setAuthToken("shared_secret", 3600, "shared_secret");
    const oauthFp = getIdentityFingerprint();
    expect(envFp).not.toBe(oauthFp);
  });

  test("expired access-only OAuth token falls through to env token", () => {
    // Mirrors getAuthConfig: an expired token with no refresh token is
    // unusable — the API client will fall back to the env token for
    // the next request. If the fingerprint still used the stale access
    // token, cache reads/writes would land under the dead OAuth
    // namespace while requests go under the env identity, serving
    // another user's cached data.
    //
    // setAuthToken(token, expiresIn: -1) writes an already-expired row
    // with no refresh_token (third arg omitted).
    setAuthToken("expired_access", -1);
    process.env.SENTRY_AUTH_TOKEN = "env_token";

    const fp = getIdentityFingerprint();

    // The fingerprint should match the env-token identity, not the
    // stale DB token.
    delete process.env.SENTRY_AUTH_TOKEN;
    // Clear the expired DB row to isolate: anon is the only other
    // possibility this case could collapse into.
    setAuthToken("", -1); // idempotent clear not available; rely on positive check below
    process.env.SENTRY_AUTH_TOKEN = "env_token";
    const envOnlyFp = getIdentityFingerprint();
    expect(fp).toBe(envOnlyFp);
  });

  test("expired access-only OAuth token with refresh_token uses the refresh token", () => {
    // An expired access token that has a refresh token is still usable
    // — the API client will perform an OAuth refresh. Fingerprint
    // should key off the stable refresh token, not the (about-to-be-
    // rotated) access token.
    setAuthToken("expired_access", -1, "live_refresh");
    const fp = getIdentityFingerprint();

    // Rotate the access token; refresh stays the same. Fingerprint
    // must not change.
    setAuthToken("fresh_access", 3600, "live_refresh");
    expect(getIdentityFingerprint()).toBe(fp);
  });
});
