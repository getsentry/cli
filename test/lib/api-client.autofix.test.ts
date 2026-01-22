/**
 * Autofix API Client Tests
 *
 * Tests for the autofix-related API functions by mocking fetch.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  getAutofixState,
  triggerAutofix,
  updateAutofix,
} from "../../src/lib/api-client.js";
import { setAuthToken } from "../../src/lib/config.js";

// Test config directory
let testConfigDir: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  testConfigDir = join(
    process.env.SENTRY_CLI_CONFIG_DIR ?? "/tmp",
    `test-autofix-api-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env.SENTRY_CLI_CONFIG_DIR = testConfigDir;

  // Save original fetch
  originalFetch = globalThis.fetch;

  // Set up auth token (manual token, no refresh)
  await setAuthToken("test-token");
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

describe("triggerAutofix", () => {
  test("sends POST request to autofix endpoint", async () => {
    let capturedRequest: Request | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);

      return new Response(JSON.stringify({ run_id: 12_345 }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await triggerAutofix("123456789");

    expect(result.run_id).toBe(12_345);
    expect(capturedRequest?.method).toBe("POST");
    expect(capturedRequest?.url).toContain("/issues/123456789/autofix/");
  });

  test("includes stoppingPoint in request body", async () => {
    let capturedBody: unknown;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      capturedBody = await req.json();

      return new Response(JSON.stringify({ run_id: 12_345 }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };

    await triggerAutofix("123456789", { stoppingPoint: "root_cause" });

    expect(capturedBody).toEqual({ stoppingPoint: "root_cause" });
  });

  test("includes optional parameters when provided", async () => {
    let capturedBody: unknown;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      capturedBody = await req.json();

      return new Response(JSON.stringify({ run_id: 12_345 }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };

    await triggerAutofix("123456789", {
      stoppingPoint: "open_pr",
      eventId: "event-abc",
      instruction: "Focus on database issues",
    });

    expect(capturedBody).toEqual({
      stoppingPoint: "open_pr",
      eventId: "event-abc",
      instruction: "Focus on database issues",
    });
  });

  test("throws ApiError on 402 response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "No budget for Seer Autofix" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      });

    await expect(triggerAutofix("123456789")).rejects.toThrow();
  });

  test("throws ApiError on 403 response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "AI Autofix is not enabled" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });

    await expect(triggerAutofix("123456789")).rejects.toThrow();
  });
});

describe("getAutofixState", () => {
  test("sends GET request to autofix endpoint", async () => {
    let capturedRequest: Request | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);

      return new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "PROCESSING",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await getAutofixState("123456789");

    expect(result?.run_id).toBe(12_345);
    expect(result?.status).toBe("PROCESSING");
    expect(capturedRequest?.method).toBe("GET");
    expect(capturedRequest?.url).toContain("/issues/123456789/autofix/");
  });

  test("returns null when autofix is null", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ autofix: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const result = await getAutofixState("123456789");
    expect(result).toBeNull();
  });

  test("returns completed state with steps", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "COMPLETED",
            steps: [
              {
                id: "step-1",
                key: "root_cause_analysis",
                status: "COMPLETED",
                title: "Root Cause Analysis",
                causes: [
                  {
                    id: 0,
                    description: "Test cause",
                  },
                ],
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const result = await getAutofixState("123456789");
    expect(result?.status).toBe("COMPLETED");
    expect(result?.steps).toHaveLength(1);
    expect(result?.steps?.[0]?.causes).toHaveLength(1);
  });
});

describe("updateAutofix", () => {
  test("sends POST request to autofix update endpoint", async () => {
    let capturedRequest: Request | undefined;
    let capturedBody: unknown;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      capturedBody = await new Request(input, init).json();

      return new Response(JSON.stringify({}), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };

    await updateAutofix("123456789", 12_345, {
      type: "select_root_cause",
      cause_id: 0,
      stopping_point: "open_pr",
    });

    expect(capturedRequest?.method).toBe("POST");
    expect(capturedRequest?.url).toContain("/issues/123456789/autofix/update/");
    expect(capturedBody).toEqual({
      run_id: 12_345,
      payload: {
        type: "select_root_cause",
        cause_id: 0,
        stopping_point: "open_pr",
      },
    });
  });

  test("sends select_solution payload", async () => {
    let capturedBody: unknown;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = await new Request(input, init).json();

      return new Response(JSON.stringify({}), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };

    await updateAutofix("123456789", 12_345, {
      type: "select_solution",
    });

    expect(capturedBody).toEqual({
      run_id: 12_345,
      payload: {
        type: "select_solution",
      },
    });
  });

  test("sends create_pr payload", async () => {
    let capturedBody: unknown;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = await new Request(input, init).json();

      return new Response(JSON.stringify({}), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };

    await updateAutofix("123456789", 12_345, {
      type: "create_pr",
    });

    expect(capturedBody).toEqual({
      run_id: 12_345,
      payload: {
        type: "create_pr",
      },
    });
  });
});
