/**
 * CVE regression: `sentry auth login --token X` in a `.sentryclirc`-poisoned repo.
 *
 * Attack path (discovered in the second security subagent review):
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
 * 6. `applyLoginUrl(undefined)` would read the poisoned env and return
 *    `https://evil.com` as the effective host.
 * 7. Login would store the token with host=evil.com, then fire
 *    authenticated requests against evil.com (which match the
 *    just-stored host → fetch-layer guard admits them).
 *
 * Fix: `refuseLoginToUntrustedHost` rejects login when the effective
 * host wasn't registered as a login trust anchor (i.e. didn't come
 * from explicit `--url` or boot-time env).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loginCommand } from "../../../src/commands/auth/login.js";
import {
  captureEnvTokenHost,
  resetEnvTokenHostForTesting,
} from "../../../src/lib/env-token-host.js";
import { HostScopeError } from "../../../src/lib/errors.js";
import { resetLoginTrustAnchorForTesting } from "../../../src/lib/token-host.js";

const ENV_KEYS = [
  "SENTRY_HOST",
  "SENTRY_URL",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_TOKEN",
] as const;

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
  readonly force: boolean;
  readonly url?: string;
};

type LoginFunc = (this: unknown, flags: LoginFlags) => Promise<void>;

function createContext() {
  return {
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
    cwd: "/tmp",
  };
}

describe("CVE: auth login --token with rc-poisoned env.SENTRY_URL", () => {
  let saved: Record<string, string | undefined>;
  let fetchCalls: { url: string; authorization: string | null }[];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) {
      delete process.env[k];
    }
    resetEnvTokenHostForTesting();
    resetLoginTrustAnchorForTesting();

    // Intercept fetch to assert no outbound requests on the attacker path.
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      fetchCalls.push({
        url,
        authorization: headers.get("Authorization"),
      });
      throw new Error("test: unexpected fetch");
    }) as typeof fetch;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v !== undefined) {
        process.env[k] = v;
      } else {
        delete process.env[k];
      }
    }
    resetEnvTokenHostForTesting();
    resetLoginTrustAnchorForTesting();
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
    const toEvil = fetchCalls.filter((c) => c.url.includes("evil.com"));
    expect(toEvil).toEqual([]);
  });

  test("auth login OAuth flow (no token, no --url) in rc-poisoned env also throws", async () => {
    // OAuth path: the device-code request would otherwise go to
    // evil.com/oauth/device/code/. Defense-in-depth rejects this too —
    // an attacker's OAuth device-code page could phish the user for
    // their SaaS credentials in the browser tab that opens.
    captureEnvTokenHost();
    process.env.SENTRY_URL = "https://evil.com";

    const func = (await loginCommand.loader()) as unknown as LoginFunc;
    const context = createContext();

    await expect(
      func.call(context, { force: false, timeout: 900 })
    ).rejects.toBeInstanceOf(HostScopeError);

    const toEvil = fetchCalls.filter((c) => c.url.includes("evil.com"));
    expect(toEvil).toEqual([]);
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

    const toEvil = fetchCalls.filter((c) => c.url.includes("evil.com"));
    expect(toEvil).toEqual([]);
    const toIntended = fetchCalls.filter((c) =>
      c.url.includes("sentry.example.com")
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
      (c) => c.url.includes("evil.com") || !c.url.includes("sentry.acme.com")
    );
    expect(toAttacker).toEqual([]);
  });
});
