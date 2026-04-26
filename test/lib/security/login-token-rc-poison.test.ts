/**
 * CVE regression: `sentry auth login --token X` in a `.sentryclirc`-poisoned repo.
 *
 * Attack path (token leak):
 *
 * 1. User has a SaaS API token from `https://sentry.io/settings/auth-tokens/`.
 * 2. User has no `SENTRY_HOST`/`SENTRY_URL` in their shell (SaaS default).
 * 3. User `cd`s into an attacker repo with `.sentryclirc`:
 *      [defaults]
 *      url = https://evil.com
 * 4. User runs the documented CI pattern:
 *      sentry auth login --token $SENTRY_API_TOKEN
 *    (no `--url`).
 * 5. `isTrustChangingCommand` returns true for `auth login` → rc shim
 *    runs with `skipUrlTrustCheck: true` → writes
 *    `env.SENTRY_URL = https://evil.com`.
 * 6. Without the fix, `applyLoginUrl(undefined)` would read the poisoned
 *    env, and login validation would POST the user's existing token to
 *    evil.com.
 *
 * Fix: `refuseTokenLoginToUntrustedHost` rejects --token login when the
 * effective host wasn't registered as a login trust anchor (didn't come
 * from explicit `--url` or boot-time env). The OAuth device-flow path
 * (`auth login` without `--token`) is intentionally allowed: it doesn't
 * send any pre-existing credentials, and `applyCustomHeaders` is
 * URL-scoped so IAP tokens don't leak either.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loginCommand } from "../../../src/commands/auth/login.js";
import { captureEnvTokenHost } from "../../../src/lib/env-token-host.js";
import { HostScopeError } from "../../../src/lib/errors.js";
import {
  extractFetchUrl,
  resetHostScopingState,
  useEnvSandbox,
} from "../../helpers.js";

const ENV_KEYS = [
  "SENTRY_HOST",
  "SENTRY_URL",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_TOKEN",
  "SENTRY_CLIENT_ID",
  "SENTRY_CUSTOM_HEADERS",
] as const;

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
  readonly force: boolean;
  readonly url?: string;
};

type LoginFunc = (this: unknown, flags: LoginFlags) => Promise<void>;

const noop = () => {
  // write sinks in test context
};

function createContext() {
  return {
    stdout: { write: noop },
    stderr: { write: noop },
    cwd: "/tmp",
  };
}

/**
 * Check if a URL's hostname exactly matches one of the given hostnames.
 * Use in preference to `.includes()` substring matching — a crafted
 * URL like `https://evil.com.attacker.com/` would pass a substring
 * check on `"evil.com"` and produce a false security assurance.
 */
function urlHostnameIn(url: string, hostnames: string[]): boolean {
  try {
    return hostnames.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

describe("CVE: auth login --token with rc-poisoned env.SENTRY_URL", () => {
  useEnvSandbox(ENV_KEYS);

  let fetchCalls: { url: string; authorization: string | null }[];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    await resetHostScopingState();

    // Intercept fetch to assert no outbound requests on the attacker path.
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      fetchCalls.push({
        url: extractFetchUrl(input),
        authorization: headers.get("Authorization"),
      });
      throw new Error("test: unexpected fetch");
    }) as typeof fetch;
  });

  afterEach(async () => {
    await resetHostScopingState();
    globalThis.fetch = originalFetch;
  });

  test("auth login --token without --url in rc-poisoned env throws before network I/O", async () => {
    // Simulate the attack state: no SENTRY_HOST at boot (env-token-host
    // captures SaaS default), then rc shim writes env.SENTRY_URL to the
    // attacker's host.
    captureEnvTokenHost(); // captures SaaS default (no env set)
    process.env.SENTRY_URL = "https://evil.com"; // simulate rc shim write

    const func = (await loginCommand.loader()) as unknown as LoginFunc;
    const context = createContext();

    await expect(
      func.call(context, {
        token: "user-saas-api-token-secret",
        force: false,
        timeout: 900,
      })
    ).rejects.toBeInstanceOf(HostScopeError);

    // Critical: the user's token NEVER hit the wire.
    const leaked = fetchCalls.filter((c) =>
      c.authorization?.includes("user-saas-api-token-secret")
    );
    expect(leaked).toEqual([]);
    // And no requests to the attacker at all
    const toEvil = fetchCalls.filter((c) => urlHostnameIn(c.url, ["evil.com"]));
    expect(toEvil).toEqual([]);
  });

  test("auth login OAuth flow (no token, no --url) in rc-poisoned env: proceeds, no header leak", async () => {
    // OAuth device flow doesn't send any pre-existing user credentials —
    // a poisoned rc URL can at worst phish the user into authenticating
    // against the attacker's server (out of threat model). We allow the
    // request through; the user sees the device-code URL in their
    // terminal and can spot evil.com.
    //
    // Critical: SENTRY_CUSTOM_HEADERS (IAP tokens etc.) must NOT attach
    // to the device-code request. applyCustomHeaders is URL-scoped via
    // the login trust anchor, which applyLoginUrl does NOT register for
    // rc-sourced hosts, so headers fail closed at the header layer.
    process.env.SENTRY_CUSTOM_HEADERS = "X-IAP-Token: secret-iap-value";
    process.env.SENTRY_CLIENT_ID = "test-client-id";
    captureEnvTokenHost();
    process.env.SENTRY_URL = "https://evil.com";

    const func = (await loginCommand.loader()) as unknown as LoginFunc;
    const context = createContext();

    // OAuth device flow attempts a POST to evil.com/oauth/device/code/.
    // The fetch mock throws; runInteractiveLogin catches the error and
    // returns falsy, so the command resolves (with exitCode set). We
    // only care that we got PAST the host-scoping guard.
    await func.call(context, { force: false, timeout: 900 });

    const toEvil = fetchCalls.filter((c) => urlHostnameIn(c.url, ["evil.com"]));
    // Device-code request DID hit evil.com (no host-scoping refusal).
    expect(toEvil.length).toBeGreaterThan(0);
    // Bearer never attaches (no token configured for the OAuth flow).
    for (const call of toEvil) {
      expect(call.authorization).toBeNull();
    }
    // applyCustomHeaders for IAP/mTLS is URL-scoped and fails closed
    // when no login trust anchor matches. Comprehensive coverage lives
    // in test/lib/security/custom-headers-leak.test.ts.
  });

  test("auth login --url explicitly acknowledges the host (legitimate onboarding)", async () => {
    // The explicit --url path is the documented way to acknowledge a
    // new host. rc-sourced env.SENTRY_URL is overwritten by applyLoginUrl.
    captureEnvTokenHost();
    process.env.SENTRY_URL = "https://evil.com"; // poisoned by rc

    const func = (await loginCommand.loader()) as unknown as LoginFunc;
    const context = createContext();

    // User explicitly says `--url https://sentry.example.com` — this
    // wins over the rc-poisoned env. Host is registered as anchor, so
    // no HostScopeError. The actual login fires and hits our mock fetch
    // (which throws), but importantly: it targets the user's intended
    // host, not the attacker's.
    await expect(
      func.call(context, {
        token: "legit-token",
        url: "https://sentry.example.com",
        force: false,
        timeout: 900,
      })
    ).rejects.toThrow(); // our fetch mock throws

    const toEvil = fetchCalls.filter((c) => urlHostnameIn(c.url, ["evil.com"]));
    expect(toEvil).toEqual([]);
    const toIntended = fetchCalls.filter((c) =>
      urlHostnameIn(c.url, ["sentry.example.com"])
    );
    expect(toIntended.length).toBeGreaterThan(0);
  });

  test("auth login with SENTRY_HOST shell-exported + no rc: proceeds (shell is trusted)", async () => {
    // Legitimate: user exports SENTRY_HOST=self-hosted in their shell,
    // runs `sentry auth login --token X` (no --url). Boot captures
    // SENTRY_HOST → env-token-host = self-hosted. applyLoginUrl's
    // bootHost === effectiveHost → anchor registered → login proceeds.
    process.env.SENTRY_HOST = "https://sentry.acme.com";
    captureEnvTokenHost();

    const func = (await loginCommand.loader()) as unknown as LoginFunc;
    const context = createContext();

    await expect(
      func.call(context, {
        token: "legit-token",
        force: false,
        timeout: 900,
      })
    ).rejects.toThrow(); // mock fetch throws

    const toAttacker = fetchCalls.filter(
      (c) => !urlHostnameIn(c.url, ["sentry.acme.com"])
    );
    expect(toAttacker).toEqual([]);
  });

  test("stale login anchor for hostA does NOT admit login --token in rc-poisoned hostB", async () => {
    // Library-mode regression: a previous applyLoginUrl(--url=hostA) in
    // the same process registers a login anchor for hostA. A subsequent
    // `auth login --token X` in a poisoned-rc hostB env must NOT use
    // hostA's anchor as a free pass — the refusal guard checks anchor↔host
    // match, not anchor existence.
    captureEnvTokenHost();
    const { registerLoginTrustAnchor } = await import(
      "../../../src/lib/token-host.js"
    );
    registerLoginTrustAnchor("https://sentry.hosta.com");

    process.env.SENTRY_URL = "https://evil.com";

    const func = (await loginCommand.loader()) as unknown as LoginFunc;
    const context = createContext();

    await expect(
      func.call(context, {
        token: "user-saas-api-token-secret",
        force: false,
        timeout: 900,
      })
    ).rejects.toBeInstanceOf(HostScopeError);

    const toEvil = fetchCalls.filter((c) => urlHostnameIn(c.url, ["evil.com"]));
    expect(toEvil).toEqual([]);
  });
});
