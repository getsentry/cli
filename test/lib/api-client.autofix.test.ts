/**
 * Autofix and Summary API Client Tests
 *
 * Tests for the autofix-related and summary API functions by mocking fetch.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  getAutofixState,
  getIssueSummary,
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

    await triggerAutofix("test-org", "123456789");

    expect(capturedRequest?.method).toBe("POST");
    expect(capturedRequest?.url).toContain(
      "/organizations/test-org/issues/123456789/autofix/"
    );
  });

  test("includes step in request body", async () => {
    let capturedBody: unknown;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      capturedBody = await req.json();

      return new Response(JSON.stringify({ run_id: 12_345 }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };

    await triggerAutofix("test-org", "123456789");

    expect(capturedBody).toEqual({ step: "root_cause" });
  });

  test("throws ApiError on 402 response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "No budget for Seer Autofix" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      });

    await expect(triggerAutofix("test-org", "123456789")).rejects.toThrow();
  });

  test("throws ApiError on 403 response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "AI Autofix is not enabled" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });

    await expect(triggerAutofix("test-org", "123456789")).rejects.toThrow();
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

    const result = await getAutofixState("test-org", "123456789");

    expect(result?.run_id).toBe(12_345);
    expect(result?.status).toBe("PROCESSING");
    expect(capturedRequest?.method).toBe("GET");
    expect(capturedRequest?.url).toContain(
      "/organizations/test-org/issues/123456789/autofix/"
    );
  });

  test("returns null when autofix is null", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ autofix: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const result = await getAutofixState("test-org", "123456789");
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

    const result = await getAutofixState("test-org", "123456789");
    expect(result?.status).toBe("COMPLETED");
    expect(result?.steps).toHaveLength(1);
    expect(result?.steps?.[0]?.causes).toHaveLength(1);
  });
});

describe("updateAutofix", () => {
  test("sends POST request to autofix endpoint", async () => {
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

    await updateAutofix("test-org", "123456789", 12_345);

    expect(capturedRequest?.method).toBe("POST");
    expect(capturedRequest?.url).toContain(
      "/organizations/test-org/issues/123456789/autofix/"
    );
    expect(capturedBody).toEqual({
      run_id: 12_345,
      step: "solution",
    });
  });
});

describe("getIssueSummary", () => {
  test("sends POST request to summarize endpoint", async () => {
    let capturedRequest: Request | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);

      return new Response(
        JSON.stringify({
          groupId: "123456789",
          headline: "Test Issue Summary",
          whatsWrong: "Something went wrong",
          trace: "Error in function X",
          possibleCause: "Missing null check",
          scores: {
            possibleCauseConfidence: 0.85,
            possibleCauseNovelty: 0.6,
            isFixable: true,
            fixabilityScore: 0.7,
            fixabilityScoreVersion: "1.0",
          },
          eventId: "abc123",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await getIssueSummary("test-org", "123456789");

    expect(result.groupId).toBe("123456789");
    expect(result.headline).toBe("Test Issue Summary");
    expect(result.whatsWrong).toBe("Something went wrong");
    expect(result.possibleCause).toBe("Missing null check");
    expect(result.scores?.possibleCauseConfidence).toBe(0.85);
    expect(capturedRequest?.method).toBe("POST");
    expect(capturedRequest?.url).toContain(
      "/organizations/test-org/issues/123456789/summarize/"
    );
  });

  test("returns summary with minimal fields", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          groupId: "123456789",
          headline: "Simple Error",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const result = await getIssueSummary("test-org", "123456789");

    expect(result.groupId).toBe("123456789");
    expect(result.headline).toBe("Simple Error");
    expect(result.whatsWrong).toBeUndefined();
    expect(result.scores).toBeUndefined();
  });

  test("throws ApiError on 404 response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Issue not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });

    await expect(getIssueSummary("test-org", "123456789")).rejects.toThrow();
  });

  test("throws ApiError on 403 response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "AI features not enabled" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });

    await expect(getIssueSummary("test-org", "123456789")).rejects.toThrow();
  });
});
