/** Regression coverage for malformed bearer credentials. */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { shouldAutoAuth } from "../../src/lib/auto-auth.js";
import { getAuthConfig, setAuthToken } from "../../src/lib/db/auth.js";
import { setEnv } from "../../src/lib/env.js";
import { AuthError, EXIT, withAuthGuard } from "../../src/lib/errors.js";
import {
  getSdkConfig,
  resetAuthenticatedFetch,
} from "../../src/lib/sentry-client.js";
import {
  extractFetchUrl,
  mintSntrysToken,
  mockFetch,
  resetHostScopingState,
  useEnvSandbox,
  useTestConfigDir,
} from "../helpers.js";

const REGION_URL = "https://us.sentry.io";
const RESOURCE_URL = `${REGION_URL}/api/0/organizations/synthetic-org/chunk-upload/`;
const ENV_TOKEN_KEYS = ["SENTRY_AUTH_TOKEN", "SENTRY_TOKEN"] as const;
const ORG_TOKEN = mintSntrysToken({
  iat: 1,
  url: "https://sentry.io",
  org: "synthetic-org",
});
const MALFORMED_TOKEN = ORG_TOKEN.replace(
  "test-secret-tail",
  "te\nst-secret-tail"
);

describe("authenticated fetch bearer validation", () => {
  useTestConfigDir("sentry-client-auth-");
  useEnvSandbox([
    ...ENV_TOKEN_KEYS,
    "SENTRY_FORCE_ENV_TOKEN",
    "SENTRY_HOST",
    "SENTRY_URL",
    "SENTRY_CLIENT_ID",
  ]);

  let originalFetch: typeof globalThis.fetch;
  let requests: { url: string; authorization: string | null }[];

  beforeEach(async () => {
    await resetHostScopingState();
    resetAuthenticatedFetch();
    originalFetch = globalThis.fetch;
    requests = [];
    globalThis.fetch = mockFetch((input, init) => {
      requests.push({
        url: extractFetchUrl(input),
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
  });

  afterEach(async () => {
    setEnv(process.env);
    globalThis.fetch = originalFetch;
    resetAuthenticatedFetch();
    await resetHostScopingState();
  });

  function request(): Promise<Response> {
    return getSdkConfig(REGION_URL).fetch(RESOURCE_URL);
  }

  test.each([
    ...ENV_TOKEN_KEYS,
    "stored",
  ])("rejects an internal LF from %s before any request or auth fallback", async (source) => {
    if (source === "stored") {
      setAuthToken(MALFORMED_TOKEN);
    } else {
      process.env[source] = MALFORMED_TOKEN;
    }

    const error = await withAuthGuard(request).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(AuthError);
    const authError = error as AuthError;
    expect(authError.reason).toBe("invalid");
    expect(authError.exitCode).toBe(EXIT.AUTH_INVALID);
    expect(authError.message).toContain("single line");
    expect(authError.cause).toBeUndefined();
    expect(`${authError.message}\n${authError.stack}`).not.toContain(
      MALFORMED_TOKEN
    );
    expect(shouldAutoAuth(authError, () => true)).toBe(false);
    expect(requests).toEqual([]);
  });

  test.each([
    ["CR", "\r"],
    ["NUL", "\0"],
    ["tab", "\t"],
    ["space", " "],
    ["control character", "\x01"],
    ["DEL", "\x7f"],
    ["non-ASCII byte", "\x80"],
    ["non-ByteString character", "\u0100"],
    ["surrogate pair", "💥"],
  ])("rejects %s in SDK credentials without exposing it", async (_, char) => {
    const token = `synthetic-prefix${char}synthetic-secret`;
    // SDK options use an in-memory env copy, which preserves even NULs.
    // process.env and the SQLite binding truncate NUL-containing strings.
    setEnv({ ...process.env, SENTRY_AUTH_TOKEN: token });
    const error = await request().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      reason: "invalid",
      exitCode: EXIT.AUTH_INVALID,
    });
    expect(String(error)).not.toContain(token);
    expect(requests).toEqual([]);
  });

  test.each([
    ["org", ORG_TOKEN],
    ["user", `sntryu_${"a".repeat(64)}`],
    ["opaque legacy/OAuth", "opaque.legacy_token+with/punctuation=~-"],
  ])("preserves a printable %s token", async (_, token) => {
    setAuthToken(token);
    await request();
    expect(requests).toEqual([
      { url: RESOURCE_URL, authorization: `Bearer ${token}` },
    ]);
  });

  test.each(ENV_TOKEN_KEYS)("preserves outer trimming for %s", async (key) => {
    process.env[key] = "\t\n  synthetic-token  \r\n";
    await request();
    expect(requests[0]?.authorization).toBe("Bearer synthetic-token");
  });

  test("does not silently trim stored credentials", async () => {
    const token = " stored-token ";
    setAuthToken(token);
    await expect(request()).rejects.toMatchObject({
      reason: "invalid",
      exitCode: EXIT.AUTH_INVALID,
    });
    expect(requests).toEqual([]);
  });

  test.each(
    ENV_TOKEN_KEYS
  )("ignores a malformed %s when stored OAuth takes precedence", async (key) => {
    process.env[key] = MALFORMED_TOKEN;
    setAuthToken("stored-token");
    await request();
    expect(requests[0]?.authorization).toBe("Bearer stored-token");
  });

  test("rejects forced malformed env credentials instead of using stored OAuth", async () => {
    process.env.SENTRY_AUTH_TOKEN = MALFORMED_TOKEN;
    process.env.SENTRY_FORCE_ENV_TOKEN = "1";
    setAuthToken("stored-token");
    await expect(request()).rejects.toMatchObject({
      reason: "invalid",
      exitCode: EXIT.AUTH_INVALID,
    });
    expect(requests).toEqual([]);
  });

  test("retries with a valid refreshed bearer", async () => {
    process.env.SENTRY_CLIENT_ID = "synthetic-client-id";
    setAuthToken("stored-token", 3600, "synthetic-refresh-token");
    globalThis.fetch = mockFetch((input, init) => {
      const url = extractFetchUrl(input);
      const authorization = new Headers(init?.headers).get("Authorization");
      requests.push({ url, authorization });
      if (url.endsWith("/oauth/token/")) {
        return Promise.resolve(
          Response.json({
            access_token: "refreshed-token",
            token_type: "bearer",
            expires_in: 3600,
          })
        );
      }
      return Promise.resolve(
        new Response("{}", {
          status: authorization === "Bearer stored-token" ? 401 : 200,
        })
      );
    });

    expect((await request()).status).toBe(200);
    expect(requests).toEqual([
      { url: RESOURCE_URL, authorization: "Bearer stored-token" },
      { url: "https://sentry.io/oauth/token/", authorization: null },
      { url: RESOURCE_URL, authorization: "Bearer refreshed-token" },
    ]);
  });

  test.each([
    MALFORMED_TOKEN,
    "",
    "opaque-\0-token",
    "opaque-\u0100-token",
  ])("rejects malformed refreshed credentials without retrying the request %#", async (token) => {
    process.env.SENTRY_CLIENT_ID = "synthetic-client-id";
    setAuthToken("stored-token", 3600, "synthetic-refresh-token");
    globalThis.fetch = mockFetch((input, init) => {
      const url = extractFetchUrl(input);
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      if (url.endsWith("/oauth/token/")) {
        return Promise.resolve(
          Response.json({
            access_token: token,
            token_type: "bearer",
            expires_in: 3600,
            refresh_token: "synthetic-refresh-token",
          })
        );
      }
      return Promise.resolve(new Response("{}", { status: 401 }));
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await request().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        reason: "invalid",
        exitCode: EXIT.AUTH_INVALID,
      });
      expect((error as Error).cause).toBeUndefined();
      if (token) {
        expect(String(error)).not.toContain(token);
      }
      expect(getAuthConfig()).toMatchObject({
        token: "stored-token",
        refreshToken: "synthetic-refresh-token",
      });
    }
    const refreshAttempt = [
      { url: RESOURCE_URL, authorization: "Bearer stored-token" },
      { url: "https://sentry.io/oauth/token/", authorization: null },
    ];
    expect(requests).toEqual([...refreshAttempt, ...refreshAttempt]);
  });

  test("rejects malformed proactive refresh before storing or using the token", async () => {
    process.env.SENTRY_CLIENT_ID = "synthetic-client-id";
    setAuthToken("expired-token", -1, "synthetic-refresh-token");
    globalThis.fetch = mockFetch((input, init) => {
      requests.push({
        url: extractFetchUrl(input),
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      return Promise.resolve(
        Response.json({
          access_token: "opaque-\0-secret-tail",
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "replacement-refresh-token",
        })
      );
    });

    await expect(request()).rejects.toMatchObject({
      reason: "invalid",
      exitCode: EXIT.AUTH_INVALID,
    });
    expect(getAuthConfig()).toMatchObject({
      token: "expired-token",
      refreshToken: "synthetic-refresh-token",
    });
    expect(requests).toEqual([
      { url: "https://sentry.io/oauth/token/", authorization: null },
    ]);
  });
});
