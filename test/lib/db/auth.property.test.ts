/**
 * Property-Based Tests for Auth Environment Variable Priority
 *
 * Verifies invariants that must hold for any valid token values:
 * - SENTRY_AUTH_TOKEN always takes priority over SENTRY_TOKEN
 * - Env vars always take priority over stored tokens
 * - Env tokens never trigger refresh
 * - AuthConfig.source correctly identifies the origin
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  asyncProperty,
  assert as fcAssert,
  option,
  property,
  string,
} from "fast-check";
import {
  type AuthSource,
  getAuthConfig,
  getAuthToken,
  isEnvTokenActive,
  refreshToken,
  setAuthToken,
} from "../../../src/lib/db/auth.js";
import { useTestConfigDir } from "../../helpers.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

useTestConfigDir("auth-prop-");

/** Arbitrary for non-empty, trimmed token strings */
const tokenArb = string({ minLength: 1, maxLength: 100 }).filter(
  (s) => s.trim().length > 0
);

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

describe("property: env var priority", () => {
  test("SENTRY_AUTH_TOKEN always wins over SENTRY_TOKEN", () => {
    fcAssert(
      property(tokenArb, tokenArb, (authToken, sentryToken) => {
        process.env.SENTRY_AUTH_TOKEN = authToken;
        process.env.SENTRY_TOKEN = sentryToken;

        expect(getAuthToken()).toBe(authToken.trim());
        expect(getAuthConfig()?.source).toBe(
          "env:SENTRY_AUTH_TOKEN" satisfies AuthSource
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("env var always wins over stored token", () => {
    fcAssert(
      property(tokenArb, tokenArb, (envToken, storedToken) => {
        setAuthToken(storedToken);
        process.env.SENTRY_AUTH_TOKEN = envToken;

        expect(getAuthToken()).toBe(envToken.trim());
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("SENTRY_TOKEN wins over stored token when SENTRY_AUTH_TOKEN is absent", () => {
    fcAssert(
      property(tokenArb, tokenArb, (envToken, storedToken) => {
        setAuthToken(storedToken);
        process.env.SENTRY_TOKEN = envToken;

        expect(getAuthToken()).toBe(envToken.trim());
        expect(getAuthConfig()?.source).toBe(
          "env:SENTRY_TOKEN" satisfies AuthSource
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("stored token used when no env vars set", () => {
    fcAssert(
      property(tokenArb, (storedToken) => {
        setAuthToken(storedToken);

        expect(getAuthToken()).toBe(storedToken);
        expect(getAuthConfig()?.source).toBe("oauth" satisfies AuthSource);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: env tokens never trigger refresh", () => {
  test("refreshToken returns env token without refreshing", async () => {
    await fcAssert(
      asyncProperty(tokenArb, async (envToken) => {
        process.env.SENTRY_AUTH_TOKEN = envToken;

        const result = await refreshToken();
        expect(result.token).toBe(envToken.trim());
        expect(result.refreshed).toBe(false);
        expect(result.expiresAt).toBeUndefined();
        expect(result.expiresIn).toBeUndefined();
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("refreshToken with force=true still returns env token without refreshing", async () => {
    await fcAssert(
      asyncProperty(tokenArb, async (envToken) => {
        process.env.SENTRY_AUTH_TOKEN = envToken;

        const result = await refreshToken({ force: true });
        expect(result.token).toBe(envToken.trim());
        expect(result.refreshed).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: isEnvTokenActive consistency", () => {
  test("isEnvTokenActive matches whether getAuthConfig returns env source", () => {
    fcAssert(
      property(
        option(tokenArb),
        option(tokenArb),
        option(tokenArb),
        (authTokenOpt, sentryTokenOpt, storedTokenOpt) => {
          // Clean slate
          delete process.env.SENTRY_AUTH_TOKEN;
          delete process.env.SENTRY_TOKEN;

          if (authTokenOpt !== null) {
            process.env.SENTRY_AUTH_TOKEN = authTokenOpt;
          }
          if (sentryTokenOpt !== null) {
            process.env.SENTRY_TOKEN = sentryTokenOpt;
          }
          if (storedTokenOpt !== null) {
            setAuthToken(storedTokenOpt);
          }

          const config = getAuthConfig();
          const envActive = isEnvTokenActive();

          if (envActive) {
            expect(config?.source).toMatch(/^env:/);
          } else if (config) {
            expect(config.source).toBe("oauth");
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: source round-trip", () => {
  test("source correctly identifies SENTRY_AUTH_TOKEN", () => {
    fcAssert(
      property(tokenArb, (token) => {
        process.env.SENTRY_AUTH_TOKEN = token;
        const config = getAuthConfig();
        expect(config?.source).toBe("env:SENTRY_AUTH_TOKEN");
        // Verify we can extract the env var name
        expect(config?.source.slice(4)).toBe("SENTRY_AUTH_TOKEN");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("source correctly identifies SENTRY_TOKEN", () => {
    fcAssert(
      property(tokenArb, (token) => {
        process.env.SENTRY_TOKEN = token;
        const config = getAuthConfig();
        expect(config?.source).toBe("env:SENTRY_TOKEN");
        expect(config?.source.slice(4)).toBe("SENTRY_TOKEN");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
