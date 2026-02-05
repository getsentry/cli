/**
 * API Client Tests
 *
 * Tests for the Sentry API client 401 retry behavior and utility functions.
 * Uses manual fetch mocking to avoid polluting the module cache.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildSearchParams,
  escapeRegex,
  matchesWordBoundary,
  rawApiRequest,
} from "../../src/lib/api-client.js";
import { setAuthToken } from "../../src/lib/db/auth.js";
import { CONFIG_DIR_ENV_VAR } from "../../src/lib/db/index.js";
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

/**
 * Creates a mock fetch that handles API requests.
 * Uses rawApiRequest which goes to control silo (no region resolution needed).
 *
 * The `apiRequestHandler` is called for each API request.
 */
function createMockFetch(
  requests: RequestLog[],
  apiRequestHandler: (
    req: Request,
    requestCount: number
  ) => Response | Promise<Response>,
  options: {
    oauthHandler?: (req: Request) => Response | Promise<Response>;
  } = {}
): typeof globalThis.fetch {
  let apiRequestCount = 0;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    requests.push({
      url: req.url,
      method: req.method,
      authorization: req.headers.get("Authorization"),
      isRetry: req.headers.get("x-sentry-cli-retry") === "1",
    });

    // OAuth token refresh endpoint
    if (req.url.includes("/oauth/token/")) {
      if (options.oauthHandler) {
        return options.oauthHandler(req);
      }
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

    // API requests - delegate to handler
    apiRequestCount += 1;
    return apiRequestHandler(req, apiRequestCount);
  };
}

describe("401 retry behavior", () => {
  // Note: These tests use rawApiRequest which goes to control silo (sentry.io)
  // and supports 401 retry with token refresh.

  test("retries request with new token on 401 response", async () => {
    const requests: RequestLog[] = [];

    globalThis.fetch = createMockFetch(requests, (_req, requestCount) => {
      // First request: return 401
      if (requestCount === 1) {
        return new Response(JSON.stringify({ detail: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Retry request: return success
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await rawApiRequest("/test-endpoint/");

    // Verify successful result from retry
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });

    // Verify request sequence:
    // 1. Initial API request with initial-token -> 401
    // 2. OAuth refresh request
    // 3. Retry API request with refreshed-token -> 200
    const apiRequests = requests.filter((r) =>
      r.url.includes("/test-endpoint")
    );
    const oauthRequests = requests.filter((r) =>
      r.url.includes("/oauth/token/")
    );

    expect(apiRequests).toHaveLength(2);
    expect(oauthRequests).toHaveLength(1);

    // First request with initial token
    expect(apiRequests[0].authorization).toBe("Bearer initial-token");
    expect(apiRequests[0].isRetry).toBe(false);

    // Retry request with new token
    expect(apiRequests[1].authorization).toBe("Bearer refreshed-token");
    expect(apiRequests[1].isRetry).toBe(true);
  });

  test("does not retry on non-401 errors", async () => {
    const requests: RequestLog[] = [];

    globalThis.fetch = createMockFetch(requests, () => {
      // Return 403 (not 401) - this should not trigger retry
      return new Response(JSON.stringify({ detail: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    });

    // rawApiRequest doesn't throw on error responses, it returns the status
    const result = await rawApiRequest("/test-endpoint/");
    expect(result.status).toBe(403);

    // Should only have initial API request, no retry
    const apiRequests = requests.filter((r) =>
      r.url.includes("/test-endpoint")
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

    globalThis.fetch = createMockFetch(requests, () => {
      // Always return 401 for API requests
      return new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    });

    // rawApiRequest doesn't throw, returns status
    const result = await rawApiRequest("/test-endpoint/");
    expect(result.status).toBe(401);

    // Should have exactly 2 API requests (initial + one retry, no infinite loop)
    const apiRequests = requests.filter((r) =>
      r.url.includes("/test-endpoint")
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
    await setAuthToken("manual-api-token"); // No expiry, no refresh token

    const requests: RequestLog[] = [];

    globalThis.fetch = createMockFetch(requests, () => {
      // Always return 401
      return new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    });

    // rawApiRequest doesn't throw, returns status
    const result = await rawApiRequest("/test-endpoint/");
    expect(result.status).toBe(401);

    // Should have exactly 1 API request - no retry since token can't be refreshed
    const apiRequests = requests.filter((r) =>
      r.url.includes("/test-endpoint")
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

describe("escapeRegex", () => {
  test("escapes special regex characters", () => {
    expect(escapeRegex("a.b")).toBe("a\\.b");
    expect(escapeRegex("a*b")).toBe("a\\*b");
    expect(escapeRegex("a+b")).toBe("a\\+b");
    expect(escapeRegex("a?b")).toBe("a\\?b");
    expect(escapeRegex("a^b")).toBe("a\\^b");
    expect(escapeRegex("a$b")).toBe("a\\$b");
    expect(escapeRegex("a{b}")).toBe("a\\{b\\}");
    expect(escapeRegex("a(b)")).toBe("a\\(b\\)");
    expect(escapeRegex("a|b")).toBe("a\\|b");
    expect(escapeRegex("a[b]")).toBe("a\\[b\\]");
    expect(escapeRegex("a\\b")).toBe("a\\\\b");
  });

  test("leaves normal characters unchanged", () => {
    expect(escapeRegex("hello")).toBe("hello");
    expect(escapeRegex("hello-world")).toBe("hello-world");
    expect(escapeRegex("hello_world")).toBe("hello_world");
    expect(escapeRegex("hello123")).toBe("hello123");
  });

  test("handles empty string", () => {
    expect(escapeRegex("")).toBe("");
  });
});

describe("matchesWordBoundary", () => {
  test("exact match returns true", () => {
    expect(matchesWordBoundary("cli", "cli")).toBe(true);
    expect(matchesWordBoundary("docs", "docs")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(matchesWordBoundary("CLI", "cli")).toBe(true);
    expect(matchesWordBoundary("cli", "CLI")).toBe(true);
    expect(matchesWordBoundary("MyProject", "myproject")).toBe(true);
  });

  test("matches at hyphen boundaries (start)", () => {
    expect(matchesWordBoundary("cli", "cli-website")).toBe(true);
    expect(matchesWordBoundary("docs", "docs-site")).toBe(true);
  });

  test("matches at hyphen boundaries (end)", () => {
    expect(matchesWordBoundary("cli", "sentry-cli")).toBe(true);
    expect(matchesWordBoundary("docs", "my-docs")).toBe(true);
  });

  test("matches at hyphen boundaries (middle)", () => {
    expect(matchesWordBoundary("cli", "my-cli-app")).toBe(true);
    expect(matchesWordBoundary("docs", "my-docs-site")).toBe(true);
  });

  test("bidirectional: project slug in directory name", () => {
    // Directory "sentry-docs" contains project "docs" at word boundary
    expect(matchesWordBoundary("sentry-docs", "docs")).toBe(true);
    // Directory "my-cli-project" contains project "cli" at word boundary
    expect(matchesWordBoundary("my-cli-project", "cli")).toBe(true);
  });

  test("does NOT match with underscore (underscore is a word char)", () => {
    // In regex \b, underscore is part of \w (word characters)
    expect(matchesWordBoundary("cli", "cli_utils")).toBe(false);
    expect(matchesWordBoundary("cli", "my_cli")).toBe(false);
    expect(matchesWordBoundary("cli", "my_cli_app")).toBe(false);
  });

  test("does NOT match partial words without boundary", () => {
    expect(matchesWordBoundary("cli", "eclipse")).toBe(false);
    expect(matchesWordBoundary("cli", "clipping")).toBe(false);
    expect(matchesWordBoundary("cli", "publicist")).toBe(false);
    expect(matchesWordBoundary("docs", "documentary")).toBe(false);
  });

  test("handles special regex characters safely", () => {
    // These should not throw and should return correct results
    expect(matchesWordBoundary("a.b", "a.b")).toBe(true);
    expect(matchesWordBoundary("a.b", "axb")).toBe(false); // dot is escaped
    expect(matchesWordBoundary("a*b", "aaaaab")).toBe(false); // asterisk is escaped
    expect(() => matchesWordBoundary("(test)", "(test)")).not.toThrow();
    expect(() => matchesWordBoundary("[test]", "[test]")).not.toThrow();
  });
});

describe("findProjectsBySlug", () => {
  test("returns matching projects from multiple orgs", async () => {
    // Import dynamically inside test to allow mocking
    const { findProjectsBySlug } = await import("../../src/lib/api-client.js");
    const requests: Request[] = [];

    // Mock the regions endpoint first, then org/project requests
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      requests.push(req);
      const url = req.url;

      // Regions endpoint - return single region to simplify test
      if (url.includes("/users/me/regions/")) {
        return new Response(
          JSON.stringify({
            regions: [{ name: "us", url: "https://us.sentry.io" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Organizations list
      if (url.includes("/organizations/") && !url.includes("/projects/")) {
        return new Response(
          JSON.stringify([
            { id: "1", slug: "acme", name: "Acme Corp" },
            { id: "2", slug: "beta", name: "Beta Inc" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Projects for acme org - has matching project
      if (url.includes("/organizations/acme/projects/")) {
        return new Response(
          JSON.stringify([
            { id: "101", slug: "frontend", name: "Frontend" },
            { id: "102", slug: "backend", name: "Backend" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Projects for beta org - also has matching project
      if (url.includes("/organizations/beta/projects/")) {
        return new Response(
          JSON.stringify([
            { id: "201", slug: "frontend", name: "Beta Frontend" },
            { id: "202", slug: "api", name: "API" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Default response
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const results = await findProjectsBySlug("frontend");

    expect(results).toHaveLength(2);
    expect(results[0].slug).toBe("frontend");
    expect(results[0].orgSlug).toBe("acme");
    expect(results[1].slug).toBe("frontend");
    expect(results[1].orgSlug).toBe("beta");
  });

  test("returns empty array when no projects match", async () => {
    const { findProjectsBySlug } = await import("../../src/lib/api-client.js");

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // Regions endpoint
      if (url.includes("/users/me/regions/")) {
        return new Response(
          JSON.stringify({
            regions: [{ name: "us", url: "https://us.sentry.io" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Organizations list
      if (url.includes("/organizations/") && !url.includes("/projects/")) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "acme", name: "Acme Corp" }]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Projects - no match
      if (url.includes("/organizations/acme/projects/")) {
        return new Response(
          JSON.stringify([{ id: "101", slug: "backend", name: "Backend" }]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const results = await findProjectsBySlug("nonexistent");

    expect(results).toHaveLength(0);
  });

  test("skips orgs where user lacks access (403)", async () => {
    const { findProjectsBySlug } = await import("../../src/lib/api-client.js");

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // Regions endpoint
      if (url.includes("/users/me/regions/")) {
        return new Response(
          JSON.stringify({
            regions: [{ name: "us", url: "https://us.sentry.io" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Organizations list
      if (url.includes("/organizations/") && !url.includes("/projects/")) {
        return new Response(
          JSON.stringify([
            { id: "1", slug: "acme", name: "Acme Corp" },
            { id: "2", slug: "restricted", name: "Restricted Org" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Projects for acme - success
      if (url.includes("/organizations/acme/projects/")) {
        return new Response(
          JSON.stringify([{ id: "101", slug: "frontend", name: "Frontend" }]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Projects for restricted org - 403 forbidden
      if (url.includes("/organizations/restricted/projects/")) {
        return new Response(JSON.stringify({ detail: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    // Should not throw, should just skip the restricted org
    const results = await findProjectsBySlug("frontend");

    expect(results).toHaveLength(1);
    expect(results[0].orgSlug).toBe("acme");
  });
});
