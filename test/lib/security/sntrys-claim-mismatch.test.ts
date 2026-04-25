/**
 * Defense-in-depth: `sntrys_` token claim vs request-origin mismatch.
 *
 * The `sntrys_` org-auth-token format embeds an unsigned `url` claim
 * (see `src/lib/token-claims.ts`). When a token's claim and the request
 * origin disagree, the fetch-layer guard refuses to attach the token —
 * even if the more general host-scoping check (against `auth.host` /
 * env-token-snapshot) would pass.
 *
 * The realistic case this defends:
 *
 * - User has accounts on instances A and B (e.g. consultant working on
 *   two customers' Sentry deployments).
 * - User has a token issued by A (claim says `url: A`).
 * - User runs the CLI in a context routed to B (e.g. a `.sentryclirc`
 *   in customer-B's repo says `url = B`, and the user has previously
 *   logged in against B so `auth.host` agrees with B).
 * - Without claim check: the bearer token from A would be sent to B
 *   because `auth.host` matches the request origin. Token leaks to B.
 * - With claim check: claim says A, request goes to B → guard fires
 *   before the token is attached.
 *
 * The claim is unsigned plaintext base64, so this catches HONEST
 * misconfigurations more than malicious attacks. A real attacker can
 * forge the claim. See `src/lib/token-claims.ts` JSDoc for the trust
 * contract.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const ENV_KEYS = [
  "SENTRY_AUTH_TOKEN",
  "SENTRY_TOKEN",
  "SENTRY_HOST",
  "SENTRY_URL",
] as const;

/** Mint a sntrys_ token shape for testing (matches server format). */
function mintSntrysToken(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64").replace(/=+$/, "");
  return `sntrys_${b64}_secret-tail-for-test`;
}

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe("CVE defense-in-depth: sntrys_ claim vs request mismatch", () => {
  let saved: Record<string, string | undefined>;
  let fetchCalls: { url: string; auth: string | null }[];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) {
      delete process.env[k];
    }
    const { resetEnvTokenHostForTesting } = await import(
      "../../../src/lib/env-token-host.js"
    );
    resetEnvTokenHostForTesting();

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
        url: extractUrl(input),
        auth: headers.get("Authorization"),
      });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v !== undefined) {
        process.env[k] = v;
      } else {
        delete process.env[k];
      }
    }
    const { resetEnvTokenHostForTesting } = await import(
      "../../../src/lib/env-token-host.js"
    );
    resetEnvTokenHostForTesting();
    globalThis.fetch = originalFetch;
  });

  test("token whose claim says A is refused when env routing says B", async () => {
    // Token issued by sentry.firsthost.com (claim).
    // Env says SENTRY_HOST = sentry.secondhost.com (user's shell — trusted).
    process.env.SENTRY_AUTH_TOKEN = mintSntrysToken({
      iat: 1_700_000_000,
      url: "https://sentry.firsthost.com",
      org: "x",
    });
    process.env.SENTRY_HOST = "https://sentry.secondhost.com";
    const { captureEnvTokenHost } = await import(
      "../../../src/lib/env-token-host.js"
    );
    captureEnvTokenHost();

    // Direct request to sentry.secondhost.com (matches env scope but NOT the claim).
    const { apiRequest } = await import(
      "../../../src/lib/api/infrastructure.js"
    );
    await expect(
      apiRequest("https://sentry.secondhost.com/api/0/organizations/", {
        method: "GET",
      })
    ).rejects.toThrow(/embedded claim|sentry\.firsthost\.com/i);

    // Token never hit the wire.
    const leaked = fetchCalls.filter((c) =>
      c.auth?.includes("secret-tail-for-test")
    );
    expect(leaked).toEqual([]);
  });

  test("token whose claim matches the request proceeds normally", async () => {
    process.env.SENTRY_AUTH_TOKEN = mintSntrysToken({
      iat: 1_700_000_000,
      url: "https://sentry.acme.com",
      org: "x",
    });
    process.env.SENTRY_HOST = "https://sentry.acme.com";
    const { captureEnvTokenHost } = await import(
      "../../../src/lib/env-token-host.js"
    );
    captureEnvTokenHost();

    // Request to the host the claim agrees with → bearer attaches.
    const { apiRequest } = await import(
      "../../../src/lib/api/infrastructure.js"
    );
    await apiRequest("https://sentry.acme.com/api/0/organizations/", {
      method: "GET",
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.auth).toContain("Bearer ");
  });

  test("opaque (non-sntrys_) tokens are not affected by claim check", async () => {
    // A `sntryu_` user-auth token has no claim — the claim check is a
    // no-op. The existing host-scoping check is the only enforcement.
    process.env.SENTRY_AUTH_TOKEN = "sntryu_opaqueusertoken1234567890abcdef";
    process.env.SENTRY_HOST = "https://sentry.acme.com";
    const { captureEnvTokenHost } = await import(
      "../../../src/lib/env-token-host.js"
    );
    captureEnvTokenHost();

    const { apiRequest } = await import(
      "../../../src/lib/api/infrastructure.js"
    );
    await apiRequest("https://sentry.acme.com/api/0/organizations/", {
      method: "GET",
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.auth).toContain("Bearer ");
  });
});

describe("UX path: env-token-host falls back to sntrys_ claim url", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) {
      delete process.env[k];
    }
    const { resetEnvTokenHostForTesting } = await import(
      "../../../src/lib/env-token-host.js"
    );
    resetEnvTokenHostForTesting();
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v !== undefined) {
        process.env[k] = v;
      } else {
        delete process.env[k];
      }
    }
    const { resetEnvTokenHostForTesting } = await import(
      "../../../src/lib/env-token-host.js"
    );
    resetEnvTokenHostForTesting();
  });

  test("self-hosted user with sntrys_ token but no SENTRY_HOST → snapshot uses claim", async () => {
    // User pasted a sntrys_ token from their self-hosted UI but didn't
    // also export SENTRY_HOST. Without the claim fallback, the snapshot
    // would default to SaaS and every command would trip the host
    // guard. With the claim fallback, the snapshot picks up the
    // self-hosted url from the token itself.
    process.env.SENTRY_AUTH_TOKEN = mintSntrysToken({
      iat: 1_700_000_000,
      url: "https://sentry.selfhosted.example.com",
      org: "x",
    });
    // No SENTRY_HOST, no SENTRY_URL set.

    const { captureEnvTokenHost, getEnvTokenHost } = await import(
      "../../../src/lib/env-token-host.js"
    );
    captureEnvTokenHost();

    expect(getEnvTokenHost()).toBe("https://sentry.selfhosted.example.com");
  });

  test("explicit SENTRY_HOST wins over claim (env trumps claim)", async () => {
    // CRITICAL: even though the claim says A, an explicit SENTRY_HOST
    // from the user's shell is authoritative. The claim is a fallback,
    // not an override.
    process.env.SENTRY_AUTH_TOKEN = mintSntrysToken({
      iat: 1_700_000_000,
      url: "https://sentry.firsthost.com",
      org: "x",
    });
    process.env.SENTRY_HOST = "https://sentry.secondhost.com";

    const { captureEnvTokenHost, getEnvTokenHost } = await import(
      "../../../src/lib/env-token-host.js"
    );
    captureEnvTokenHost();

    expect(getEnvTokenHost()).toBe("https://sentry.secondhost.com");
  });

  test("non-sntrys_ token + no SENTRY_HOST → snapshot falls back to SaaS default", async () => {
    process.env.SENTRY_AUTH_TOKEN = "sntryu_opaque-user-token";
    // No SENTRY_HOST.

    const { captureEnvTokenHost, getEnvTokenHost } = await import(
      "../../../src/lib/env-token-host.js"
    );
    captureEnvTokenHost();

    expect(getEnvTokenHost()).toBe("https://sentry.io");
  });

  test("forged claim url is captured (claim is NOT a security primitive)", async () => {
    // Documents the trust contract: the snapshot picks up whatever the
    // claim says, even if forged. This is acceptable because:
    // - For a legitimate token, the url is authoritative.
    // - For a forged token (user pasted attacker's token), the user
    //   has already authorized the attacker server — out of threat
    //   model.
    process.env.SENTRY_AUTH_TOKEN = mintSntrysToken({
      iat: 1_700_000_000,
      url: "https://evil.com",
      org: "victim",
    });

    const { captureEnvTokenHost, getEnvTokenHost } = await import(
      "../../../src/lib/env-token-host.js"
    );
    captureEnvTokenHost();

    // Yes, the snapshot is evil.com — because that's what the user's
    // token says. If the user trusts the token they pasted, they're
    // trusting that source. The CLI's job is to prevent OTHER inputs
    // (rc files, URL args) from redirecting credentials AWAY from the
    // token's host, not to second-guess the token itself.
    expect(getEnvTokenHost()).toBe("https://evil.com");
  });
});
