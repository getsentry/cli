/**
 * API Client Tests
 *
 * Tests for the Sentry API client 401 retry behavior.
 * Uses manual fetch mocking to avoid polluting the module cache.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { listOrganizations } from "../../src/lib/api-client.js";
import { CONFIG_DIR_ENV_VAR, setAuthToken } from "../../src/lib/config.js";

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
  testConfigDir = join(
    process.env[CONFIG_DIR_ENV_VAR] ?? "/tmp",
    `test-api-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;

  // Set required env var for OAuth refresh
  process.env.SENTRY_CLIENT_ID = "test-client-id";

  // Save original fetch
  originalFetch = globalThis.fetch;

  // Set up initial auth token with a refresh token so 401 retry can get a new token
  await setAuthToken("initial-token", 3600, "test-refresh-token");
});

afterEach(() => {
  // Restore original fetch
  globalThis.fetch = originalFetch;

  try {
    rmSync(testConfigDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
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
