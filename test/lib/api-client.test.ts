/**
 * API Client Tests
 *
 * Tests for the Sentry API client 401 retry behavior.
 * Uses manual fetch mocking to avoid polluting the module cache.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildSearchParams,
  listOrganizations,
  rawApiRequest,
} from "../../src/lib/api-client.js";
import { CONFIG_DIR_ENV_VAR, setAuthToken } from "../../src/lib/config.js";
import { cleanupTestDir, createTestConfigDir } from "../helpers.js";

// Test config directory
let testConfigDir: string;
let originalFetch: typeof globalThis.fetch;

/**
 * Tracks requests made during a test
 */
type RequestLog = {
  url: string;
  method: string;
  authorization: string | null;
  isRetry: boolean;
};

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-api-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;

  // Set required env var for OAuth refresh
  process.env.SENTRY_CLIENT_ID = "test-client-id";

  // Save original fetch
  originalFetch = globalThis.fetch;

  // Set up initial auth token with a refresh token so 401 retry can get a new token
  await setAuthToken("initial-token", 3600, "test-refresh-token");
});

afterEach(async () => {
  // Restore original fetch
  globalThis.fetch = originalFetch;

  await cleanupTestDir(testConfigDir);
});

describe("401 retry behavior", () => {
  test("retries request with new token on 401 response", async () => {
    const requests: RequestLog[] = [];
    let apiRequestCount = 0;

    // Mock fetch to return 401 on first API request, then success
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push({
        url: req.url,
        method: req.method,
        authorization: req.headers.get("Authorization"),
        isRetry: req.headers.get("x-sentry-cli-retry") === "1",
      });

      // OAuth token refresh endpoint - return new token
      if (req.url.includes("/oauth/token/")) {
        return new Response(
          JSON.stringify({
            access_token: "refreshed-token",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "new-refresh-token",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // API requests
      apiRequestCount += 1;

      // First API request: return 401
      if (apiRequestCount === 1) {
        return new Response(JSON.stringify({ detail: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Retry request: return success
      return new Response(
        JSON.stringify([{ id: "1", slug: "test-org", name: "Test Org" }]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await listOrganizations();

    // Verify successful result from retry
    expect(result).toEqual([{ id: "1", slug: "test-org", name: "Test Org" }]);

    // Verify request sequence:
    // 1. Initial request with initial-token -> 401
    // 2. OAuth refresh request
    // 3. Retry with refreshed-token -> 200
    expect(requests).toHaveLength(3);

    // First API request
    expect(requests[0].url).toContain("/api/0/organizations");
    expect(requests[0].authorization).toBe("Bearer initial-token");
    expect(requests[0].isRetry).toBe(false);

    // OAuth refresh request
    expect(requests[1].url).toContain("/oauth/token/");

    // Retry API request with new token
    expect(requests[2].url).toContain("/api/0/organizations");
    expect(requests[2].authorization).toBe("Bearer refreshed-token");
    expect(requests[2].isRetry).toBe(true);
  });

  test("does not retry on non-401 errors", async () => {
    const requests: RequestLog[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push({
        url: req.url,
        method: req.method,
        authorization: req.headers.get("Authorization"),
        isRetry: req.headers.get("x-sentry-cli-retry") === "1",
      });

      // Return 403 (not 401) - this should not trigger our retry logic
      return new Response(JSON.stringify({ detail: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(listOrganizations()).rejects.toThrow();

    // Should only have initial request, no OAuth refresh, no retry
    // (ky may retry on certain errors but 403 is not one of them)
    const apiRequests = requests.filter((r) =>
      r.url.includes("/api/0/organizations")
    );
    expect(apiRequests).toHaveLength(1);
    expect(apiRequests[0].isRetry).toBe(false);

    // No OAuth refresh should have been attempted
    const oauthRequests = requests.filter((r) =>
      r.url.includes("/oauth/token/")
    );
    expect(oauthRequests).toHaveLength(0);
  });

  test("does not retry infinitely on repeated 401s", async () => {
    const requests: RequestLog[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push({
        url: req.url,
        method: req.method,
        authorization: req.headers.get("Authorization"),
        isRetry: req.headers.get("x-sentry-cli-retry") === "1",
      });

      // OAuth refresh - return token but it will still be rejected
      if (req.url.includes("/oauth/token/")) {
        return new Response(
          JSON.stringify({
            access_token: "still-invalid-token",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "new-refresh-token",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Always return 401 for API requests
      return new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(listOrganizations()).rejects.toThrow();

    // Should have exactly 2 API requests (initial + one retry, no infinite loop)
    const apiRequests = requests.filter((r) =>
      r.url.includes("/api/0/organizations")
    );
    expect(apiRequests).toHaveLength(2);
    expect(apiRequests[0].isRetry).toBe(false);
    expect(apiRequests[1].isRetry).toBe(true);

    // OAuth refresh should have been called once (after first 401)
    const oauthRequests = requests.filter((r) =>
      r.url.includes("/oauth/token/")
    );
    expect(oauthRequests).toHaveLength(1);
  });

  test("does not retry for manual API tokens (no refresh token)", async () => {
    // Manual API tokens have no expiry and no refresh token
    // When they get 401, refreshToken() returns { refreshed: false }
    // The handler should NOT retry with the same token
    await setAuthToken("manual-api-token"); // No expiry, no refresh token

    const requests: RequestLog[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push({
        url: req.url,
        method: req.method,
        authorization: req.headers.get("Authorization"),
        isRetry: req.headers.get("x-sentry-cli-retry") === "1",
      });

      // Always return 401
      return new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(listOrganizations()).rejects.toThrow();

    // Should have exactly 1 API request - no retry since token can't be refreshed
    const apiRequests = requests.filter((r) =>
      r.url.includes("/api/0/organizations")
    );
    expect(apiRequests).toHaveLength(1);
    expect(apiRequests[0].isRetry).toBe(false);

    // No OAuth refresh should have been attempted (no refresh token available)
    const oauthRequests = requests.filter((r) =>
      r.url.includes("/oauth/token/")
    );
    expect(oauthRequests).toHaveLength(0);
  });
});

describe("buildSearchParams", () => {
  test("returns undefined for undefined input", () => {
    expect(buildSearchParams(undefined)).toBeUndefined();
  });

  test("returns undefined for empty object", () => {
    expect(buildSearchParams({})).toBeUndefined();
  });

  test("returns undefined when all values are undefined", () => {
    expect(buildSearchParams({ a: undefined, b: undefined })).toBeUndefined();
  });

  test("builds params from simple key-value pairs", () => {
    const result = buildSearchParams({ status: "resolved", limit: 10 });
    expect(result).toBeDefined();
    expect(result?.get("status")).toBe("resolved");
    expect(result?.get("limit")).toBe("10");
  });

  test("skips undefined values", () => {
    const result = buildSearchParams({
      status: "resolved",
      query: undefined,
      limit: 10,
    });
    expect(result).toBeDefined();
    expect(result?.get("status")).toBe("resolved");
    expect(result?.get("limit")).toBe("10");
    expect(result?.has("query")).toBe(false);
  });

  test("handles boolean values", () => {
    const result = buildSearchParams({ active: true, archived: false });
    expect(result).toBeDefined();
    expect(result?.get("active")).toBe("true");
    expect(result?.get("archived")).toBe("false");
  });

  test("handles string arrays as repeated keys", () => {
    const result = buildSearchParams({ tags: ["error", "warning", "info"] });
    expect(result).toBeDefined();
    // URLSearchParams.getAll returns all values for repeated keys
    expect(result?.getAll("tags")).toEqual(["error", "warning", "info"]);
    // toString shows repeated keys
    expect(result?.toString()).toBe("tags=error&tags=warning&tags=info");
  });

  test("handles mixed simple values and arrays", () => {
    const result = buildSearchParams({
      status: "unresolved",
      tags: ["critical", "backend"],
      limit: 25,
    });
    expect(result).toBeDefined();
    expect(result?.get("status")).toBe("unresolved");
    expect(result?.getAll("tags")).toEqual(["critical", "backend"]);
    expect(result?.get("limit")).toBe("25");
  });

  test("handles empty array", () => {
    const result = buildSearchParams({ tags: [] });
    // Empty array produces no entries, so result should be undefined
    expect(result).toBeUndefined();
  });
});

describe("rawApiRequest", () => {
  test("sends GET request without body", async () => {
    const requests: Request[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);

      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await rawApiRequest("organizations/");

    expect(result.status).toBe(200);
    expect(result.body).toEqual([{ id: 1 }]);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
  });

  test("sends POST request with JSON object body", async () => {
    const requests: Request[] = [];
    let capturedBody: string | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);
      capturedBody = await req.text();

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await rawApiRequest("issues/123/", {
      method: "POST",
      body: { status: "resolved" },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true });
    expect(requests[0].method).toBe("POST");
    expect(capturedBody).toBe('{"status":"resolved"}');
  });

  test("sends PUT request with string body", async () => {
    const requests: Request[] = [];
    let capturedBody: string | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);
      capturedBody = await req.text();

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await rawApiRequest("issues/123/", {
      method: "PUT",
      body: '{"status":"resolved"}',
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ updated: true });
    expect(requests[0].method).toBe("PUT");
    // String body should be sent as-is
    expect(capturedBody).toBe('{"status":"resolved"}');
    // No Content-Type header set by default for string bodies
    // (user can provide via custom headers if needed)
    expect(requests[0].headers.get("Content-Type")).toBeNull();
  });

  test("string body with explicit Content-Type header", async () => {
    const requests: Request[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await rawApiRequest("issues/123/", {
      method: "PUT",
      body: "plain text content",
      headers: { "Content-Type": "text/plain" },
    });

    // User-provided Content-Type should be used
    expect(requests[0].headers.get("Content-Type")).toBe("text/plain");
  });

  test("string body with lowercase content-type header (case-insensitive)", async () => {
    const requests: Request[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await rawApiRequest("issues/123/", {
      method: "PUT",
      body: "<xml>content</xml>",
      headers: { "content-type": "text/xml" },
    });

    // Lowercase content-type should be detected and preserved (case-insensitive check)
    expect(requests[0].headers.get("Content-Type")).toBe("text/xml");
  });

  test("string body with mixed case Content-TYPE header", async () => {
    const requests: Request[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await rawApiRequest("issues/123/", {
      method: "PUT",
      body: "some data",
      headers: { "CONTENT-TYPE": "application/octet-stream" },
    });

    // Mixed case Content-TYPE should be detected and preserved
    expect(requests[0].headers.get("Content-Type")).toBe(
      "application/octet-stream"
    );
  });

  test("sends request with query params", async () => {
    const requests: Request[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await rawApiRequest("issues/", {
      params: { status: "resolved", limit: "10" },
    });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("status")).toBe("resolved");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  test("sends request with custom headers", async () => {
    const requests: Request[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await rawApiRequest("issues/", {
      headers: { "X-Custom-Header": "test-value" },
    });

    expect(requests[0].headers.get("X-Custom-Header")).toBe("test-value");
  });

  test("custom headers merged with string body (no default Content-Type)", async () => {
    const requests: Request[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await rawApiRequest("issues/123/", {
      method: "PUT",
      body: '{"status":"resolved"}',
      headers: { "X-Custom": "value" },
    });

    // Custom headers should be present, but no Content-Type for string bodies
    expect(requests[0].headers.get("X-Custom")).toBe("value");
    expect(requests[0].headers.get("Content-Type")).toBeNull();
  });

  test("returns non-JSON response body as string", async () => {
    globalThis.fetch = async () =>
      new Response("Plain text response", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });

    const result = await rawApiRequest("some-endpoint/");

    expect(result.status).toBe(200);
    expect(result.body).toBe("Plain text response");
  });

  test("returns error status without throwing", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });

    const result = await rawApiRequest("nonexistent/");

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ detail: "Not found" });
  });

  test("includes response headers", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "abc123",
        },
      });

    const result = await rawApiRequest("test/");

    expect(result.headers.get("X-Request-Id")).toBe("abc123");
  });
});
