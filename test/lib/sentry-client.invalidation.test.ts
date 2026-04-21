/**
 * Integration tests for the HTTP-layer auto-invalidation hook.
 *
 * The hook lives in `sentry-client.ts` (`invalidateAfterMutation`)
 * and fires after every successful non-GET at the
 * `authenticatedFetch` seam. Prefix computation is delegated to
 * `computeInvalidationPrefixes`; this file verifies the end-to-end
 * behavior through the real response cache.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setAuthToken } from "../../src/lib/db/auth.js";
import {
  getCachedResponse,
  storeCachedResponse,
} from "../../src/lib/response-cache.js";
import { resetAuthenticatedFetch } from "../../src/lib/sentry-client.js";
import { useTestConfigDir } from "../helpers.js";

useTestConfigDir("invalidation-");

/**
 * Factory for a `Response` with a cacheable JSON body. Used both for
 * priming the cache (`storeCachedResponse`) and for mock-fetch returns.
 */
function makeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

let originalFetch: typeof globalThis.fetch;
type FetchHandler = (
  input: Request | string | URL,
  init?: RequestInit
) => Promise<Response>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  resetAuthenticatedFetch();
  setAuthToken("test-token", 3600, "test-refresh");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAuthenticatedFetch();
});

/** Swap `globalThis.fetch` with a deterministic handler for one test. */
function installMockFetch(handler: FetchHandler): void {
  globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) =>
    handler(input, init)) as typeof fetch;
}

/**
 * Run the authenticated fetch against a URL + method. Spins up the
 * singleton fresh (we reset it in beforeEach) so it picks up whichever
 * mock is installed.
 */
async function runAuthenticatedFetch(
  url: string,
  method = "GET"
): Promise<Response> {
  // Import lazily so the module's cached state is reset between tests.
  const { getSdkConfig } = await import("../../src/lib/sentry-client.js");
  const { fetch } = getSdkConfig("https://us.sentry.io");
  return fetch(url, { method });
}

const BASE = "https://us.sentry.io/api/0/";
const DETAIL_URL = `${BASE}organizations/acme/issues/12345/`;
const LIST_URL = `${BASE}organizations/acme/issues/`;

describe("HTTP-layer auto-invalidation", () => {
  test("successful non-GET clears cached detail + list entries", async () => {
    // Prime the cache as if earlier GETs populated these entries.
    await storeCachedResponse(
      "GET",
      DETAIL_URL,
      {},
      makeResponse({ id: "12345" })
    );
    await storeCachedResponse(
      "GET",
      `${LIST_URL}?cursor=abc`,
      {},
      makeResponse({ data: [] })
    );
    expect(await getCachedResponse("GET", DETAIL_URL, {})).toBeDefined();
    expect(
      await getCachedResponse("GET", `${LIST_URL}?cursor=abc`, {})
    ).toBeDefined();

    // Perform a mutation on the detail URL.
    installMockFetch(async (input, init) => {
      expect(init?.method).toBe("PUT");
      expect(String(input)).toBe(DETAIL_URL);
      return makeResponse({ id: "12345", status: "resolved" });
    });
    const response = await runAuthenticatedFetch(DETAIL_URL, "PUT");
    expect(response.ok).toBe(true);

    // Invalidation is awaited inside the fetch hook, so by the time
    // the mutation's caller sees the response, the cache is already
    // cleared — no race, no sleep needed.
    expect(await getCachedResponse("GET", DETAIL_URL, {})).toBeUndefined();
    expect(
      await getCachedResponse("GET", `${LIST_URL}?cursor=abc`, {})
    ).toBeUndefined();
  });

  test("failed non-GET does NOT invalidate the cache", async () => {
    await storeCachedResponse(
      "GET",
      DETAIL_URL,
      {},
      makeResponse({ id: "12345" })
    );
    expect(await getCachedResponse("GET", DETAIL_URL, {})).toBeDefined();

    installMockFetch(async () => makeResponse({ error: "denied" }, 403));
    const response = await runAuthenticatedFetch(DETAIL_URL, "PUT");
    expect(response.status).toBe(403);

    // Cache entry survives — a rejected mutation didn't change state.
    expect(await getCachedResponse("GET", DETAIL_URL, {})).toBeDefined();
  });

  test("GET does NOT invalidate the cache", async () => {
    await storeCachedResponse(
      "GET",
      DETAIL_URL,
      {},
      makeResponse({ id: "12345" })
    );
    expect(await getCachedResponse("GET", DETAIL_URL, {})).toBeDefined();

    // A fresh GET to a different URL — shouldn't touch existing cache entries.
    installMockFetch(async () => makeResponse({ id: "99999" }));
    await runAuthenticatedFetch(
      `${BASE}organizations/acme/issues/99999/`,
      "GET"
    );

    expect(await getCachedResponse("GET", DETAIL_URL, {})).toBeDefined();
  });

  test("cross-endpoint rule fires for project delete", async () => {
    // Prime the org project-list cache.
    const orgListUrl = `${BASE}organizations/acme/projects/`;
    await storeCachedResponse(
      "GET",
      `${orgListUrl}?cursor=xyz`,
      {},
      makeResponse({ data: [] })
    );
    expect(
      await getCachedResponse("GET", `${orgListUrl}?cursor=xyz`, {})
    ).toBeDefined();

    // DELETE on the non-org-prefixed project URL.
    const deleteUrl = `${BASE}projects/acme/frontend/`;
    installMockFetch(async () => makeResponse({}, 204));
    await runAuthenticatedFetch(deleteUrl, "DELETE");

    // The cross-endpoint rule sweeps the org project-list even though
    // the mutation hit a different URL tree.
    expect(
      await getCachedResponse("GET", `${orgListUrl}?cursor=xyz`, {})
    ).toBeUndefined();
  });

  test("another identity's cache survives a mutation", async () => {
    // Identity A caches an entry.
    setAuthToken("identity-a", 3600, "refresh-a");
    await storeCachedResponse(
      "GET",
      DETAIL_URL,
      {},
      makeResponse({ owner: "a" })
    );
    expect(await getCachedResponse("GET", DETAIL_URL, {})).toBeDefined();

    // Switch to identity B and mutate the same URL.
    setAuthToken("identity-b", 3600, "refresh-b");
    installMockFetch(async () => makeResponse({}, 200));
    await runAuthenticatedFetch(DETAIL_URL, "PUT");

    // Back as identity A: the entry must survive because invalidation
    // is identity-gated.
    setAuthToken("identity-a", 3600, "refresh-a");
    expect(await getCachedResponse("GET", DETAIL_URL, {})).toBeDefined();
  });
});
