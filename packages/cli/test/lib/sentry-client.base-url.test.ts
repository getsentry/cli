/**
 * Unit tests for base-URL resolution (`getApiBaseUrl` / `getControlSiloUrl`).
 *
 * Regression coverage for #1568: when only a `sntrys_` org-auth token is set
 * (no `SENTRY_HOST`/`SENTRY_URL`), the request base URL must fall back to the
 * token's embedded host so it agrees with the host-scoping trust check,
 * instead of defaulting to `https://sentry.io`.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_SENTRY_URL } from "../../src/lib/constants.js";
import {
  getApiBaseUrl,
  getControlSiloUrl,
} from "../../src/lib/sentry-client.js";
import {
  mintSntrysToken,
  resetHostScopingState,
  useEnvSandbox,
  useTestConfigDir,
} from "../helpers.js";

const ENV_KEYS = [
  "SENTRY_HOST",
  "SENTRY_URL",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_TOKEN",
  "SENTRY_FORCE_ENV_TOKEN",
] as const;

describe("base URL resolution", () => {
  useTestConfigDir();
  useEnvSandbox(ENV_KEYS);
  beforeEach(resetHostScopingState);
  afterEach(resetHostScopingState);

  test("defaults to SaaS when nothing is configured", () => {
    expect(getApiBaseUrl()).toBe(DEFAULT_SENTRY_URL);
    expect(getControlSiloUrl()).toBe(DEFAULT_SENTRY_URL);
  });

  test("falls back to the sntrys_ token claim host when no URL is set", () => {
    process.env.SENTRY_AUTH_TOKEN = mintSntrysToken({
      iat: 1_700_000_000,
      url: "http://localhost:8000",
      org: "acme",
    });
    expect(getApiBaseUrl()).toBe("http://localhost:8000");
    expect(getControlSiloUrl()).toBe("http://localhost:8000");
  });

  test("explicit SENTRY_URL overrides the token claim host", () => {
    process.env.SENTRY_AUTH_TOKEN = mintSntrysToken({
      iat: 1_700_000_000,
      url: "http://localhost:8000",
      org: "acme",
    });
    process.env.SENTRY_URL = "https://sentry.acme.com";
    expect(getApiBaseUrl()).toBe("https://sentry.acme.com");
    expect(getControlSiloUrl()).toBe("https://sentry.acme.com");
  });

  test("explicit SENTRY_HOST overrides the token claim host", () => {
    process.env.SENTRY_AUTH_TOKEN = mintSntrysToken({
      iat: 1_700_000_000,
      url: "http://localhost:8000",
      org: "acme",
    });
    process.env.SENTRY_HOST = "sentry.acme.com";
    expect(getApiBaseUrl()).toBe("https://sentry.acme.com");
    expect(getControlSiloUrl()).toBe("https://sentry.acme.com");
  });

  test("non-sntrys_ env token without a URL still defaults to SaaS", () => {
    process.env.SENTRY_AUTH_TOKEN = "plain-token-no-claim";
    expect(getApiBaseUrl()).toBe(DEFAULT_SENTRY_URL);
    expect(getControlSiloUrl()).toBe(DEFAULT_SENTRY_URL);
  });
});
