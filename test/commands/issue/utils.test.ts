/**
 * Issue Command Utilities Tests
 *
 * Tests for shared utilities in src/commands/issue/utils.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  pollAutofixState,
  resolveIssueId,
  resolveOrgAndIssueId,
} from "../../../src/commands/issue/utils.js";
import { setAuthToken } from "../../../src/lib/config.js";

// Test config directory
let testConfigDir: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  testConfigDir = join(
    process.env.SENTRY_CLI_CONFIG_DIR ?? "/tmp",
    `test-issue-utils-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env.SENTRY_CLI_CONFIG_DIR = testConfigDir;

  // Save original fetch
  originalFetch = globalThis.fetch;

  // Set up auth token
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

describe("resolveIssueId", () => {
  test("returns numeric ID unchanged", async () => {
    // No API call needed for numeric IDs
    const result = await resolveIssueId(
      "123456789",
      undefined,
      "/tmp",
      "sentry issue explain 123456789 --org <org>"
    );

    expect(result).toBe("123456789");
  });

  test("returns numeric-looking ID unchanged", async () => {
    const result = await resolveIssueId(
      "9999999999",
      undefined,
      "/tmp",
      "sentry issue explain 9999999999 --org <org>"
    );

    expect(result).toBe("9999999999");
  });

  test("resolves short ID when org is provided", async () => {
    // Mock the API calls for short ID resolution
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      // Handle both string URLs and Request objects
      const req = new Request(input, init);
      const url = req.url;

      // Mock issue lookup by short ID (URL includes /api/0/)
      if (url.includes("organizations/my-org/issues/PROJECT-ABC")) {
        return new Response(
          JSON.stringify({
            id: "987654321",
            shortId: "PROJECT-ABC",
            title: "Test Issue",
            status: "unresolved",
            platform: "javascript",
            type: "error",
            count: "10",
            userCount: 5,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveIssueId(
      "PROJECT-ABC",
      "my-org",
      "/tmp",
      "sentry issue explain PROJECT-ABC --org <org>"
    );

    expect(result).toBe("987654321");
  });

  test("throws ContextError when short ID provided without org", async () => {
    // Clear any DSN/config that might provide org context
    delete process.env.SENTRY_DSN;

    await expect(
      resolveIssueId(
        "PROJECT-ABC",
        undefined,
        "/nonexistent/path",
        "sentry issue explain PROJECT-ABC --org <org>"
      )
    ).rejects.toThrow("Organization");
  });
});

describe("resolveOrgAndIssueId", () => {
  test("returns org and numeric issue ID when org is provided", async () => {
    const result = await resolveOrgAndIssueId(
      "123456789",
      "my-org",
      "/tmp",
      "sentry issue explain 123456789 --org <org>"
    );

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("123456789");
  });

  test("resolves short ID to numeric ID", async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("organizations/my-org/issues/PROJECT-ABC")) {
        return new Response(
          JSON.stringify({
            id: "987654321",
            shortId: "PROJECT-ABC",
            title: "Test Issue",
            status: "unresolved",
            platform: "javascript",
            type: "error",
            count: "10",
            userCount: 5,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId(
      "PROJECT-ABC",
      "my-org",
      "/tmp",
      "sentry issue explain PROJECT-ABC --org <org>"
    );

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("987654321");
  });

  test("throws ContextError when org cannot be resolved", async () => {
    delete process.env.SENTRY_DSN;

    await expect(
      resolveOrgAndIssueId(
        "123456789",
        undefined,
        "/nonexistent/path",
        "sentry issue explain 123456789 --org <org>"
      )
    ).rejects.toThrow("Organization");
  });
});

describe("pollAutofixState", () => {
  const mockStderr = {
    write: () => {
      // Intentionally empty - suppress output in tests
    },
  };

  test("returns immediately when state is COMPLETED", async () => {
    let fetchCount = 0;

    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "COMPLETED",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBe(1);
  });

  test("returns immediately when state is ERROR", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "ERROR",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
    });

    expect(result.status).toBe("ERROR");
  });

  test("stops at WAITING_FOR_USER_RESPONSE when stopOnWaitingForUser is true", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "WAITING_FOR_USER_RESPONSE",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
      stopOnWaitingForUser: true,
    });

    expect(result.status).toBe("WAITING_FOR_USER_RESPONSE");
  });

  test("continues polling when PROCESSING", async () => {
    let fetchCount = 0;

    globalThis.fetch = async () => {
      fetchCount += 1;

      // Return PROCESSING for first call, COMPLETED for second
      if (fetchCount === 1) {
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
      }

      return new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "COMPLETED",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
      pollIntervalMs: 10, // Short interval for test
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBe(2);
  });

  test("writes progress to stderr when not in JSON mode", async () => {
    let stderrOutput = "";

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "COMPLETED",
            steps: [
              {
                id: "step-1",
                key: "analysis",
                status: "COMPLETED",
                title: "Analysis",
                progress: [
                  {
                    message: "Analyzing...",
                    timestamp: "2025-01-01T00:00:00Z",
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

    const stderrMock = {
      write: (s: string) => {
        stderrOutput += s;
      },
    };

    await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",
      stderr: stderrMock,
      json: false,
    });

    expect(stderrOutput).toContain("Analyzing");
  });

  test("throws timeout error when exceeding timeoutMs", async () => {
    globalThis.fetch = async () =>
      new Response(
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

    await expect(
      pollAutofixState({
        orgSlug: "test-org",
        issueId: "123456789",
        stderr: mockStderr,
        json: true,
        timeoutMs: 50,
        pollIntervalMs: 20,
        timeoutMessage: "Custom timeout message",
      })
    ).rejects.toThrow("Custom timeout message");
  });

  test("continues polling when autofix is null", async () => {
    let fetchCount = 0;

    globalThis.fetch = async () => {
      fetchCount += 1;

      // Return null for first call, state for second
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ autofix: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "COMPLETED",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
      pollIntervalMs: 10,
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBe(2);
  });
});
