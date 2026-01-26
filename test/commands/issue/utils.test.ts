/**
 * Issue Command Utilities Tests
 *
 * Tests for shared utilities in src/commands/issue/utils.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  pollAutofixState,
  resolveOrgAndIssueId,
} from "../../../src/commands/issue/utils.js";
import { CONFIG_DIR_ENV_VAR, setAuthToken } from "../../../src/lib/config.js";
import { cleanupTestDir, createTestConfigDir } from "../../helpers.js";

let testConfigDir: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-issue-utils-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
  originalFetch = globalThis.fetch;
  await setAuthToken("test-token");
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await cleanupTestDir(testConfigDir);
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

  test("resolves alias-suffix format (e.g., 'f-g') using cached aliases", async () => {
    // Empty fingerprint matches detectAllDsns on empty dir
    const { setProjectAliases } = await import("../../../src/lib/config.js");
    await setProjectAliases(
      {
        f: { orgSlug: "cached-org", projectSlug: "frontend" },
        b: { orgSlug: "cached-org", projectSlug: "backend" },
      },
      ""
    );

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("organizations/cached-org/issues/FRONTEND-G")) {
        return new Response(
          JSON.stringify({
            id: "111222333",
            shortId: "FRONTEND-G",
            title: "Test Issue from alias",
            status: "unresolved",
            platform: "javascript",
            type: "error",
            count: "5",
            userCount: 2,
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
      "f-g",
      undefined,
      testConfigDir,
      "sentry issue explain f-g --org <org>"
    );

    expect(result.org).toBe("cached-org");
    expect(result.issueId).toBe("111222333");
  });

  test("resolves org-aware alias format (e.g., 'o1:d-4y') for cross-org collisions", async () => {
    const { setProjectAliases } = await import("../../../src/lib/config.js");
    await setProjectAliases(
      {
        "o1:d": { orgSlug: "org1", projectSlug: "dashboard" },
        "o2:d": { orgSlug: "org2", projectSlug: "dashboard" },
      },
      ""
    );

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("organizations/org1/issues/DASHBOARD-4Y")) {
        return new Response(
          JSON.stringify({
            id: "999888777",
            shortId: "DASHBOARD-4Y",
            title: "Test Issue from org-aware alias",
            status: "unresolved",
            platform: "javascript",
            type: "error",
            count: "1",
            userCount: 1,
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
      "o1:d-4y",
      undefined,
      testConfigDir,
      "sentry issue explain o1:d-4y"
    );

    expect(result.org).toBe("org1");
    expect(result.issueId).toBe("999888777");
  });

  test("resolves short suffix format (e.g., 'G') using project context", async () => {
    const { setDefaults } = await import("../../../src/lib/config.js");
    await setDefaults("my-org", "my-project");

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("organizations/my-org/issues/MY-PROJECT-G")) {
        return new Response(
          JSON.stringify({
            id: "444555666",
            shortId: "MY-PROJECT-G",
            title: "Test Issue from short suffix",
            status: "unresolved",
            platform: "python",
            type: "error",
            count: "3",
            userCount: 1,
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
      "G",
      undefined,
      testConfigDir,
      "sentry issue explain G --org <org>"
    );

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("444555666");
  });

  test("falls back to full short ID when alias is not found in cache", async () => {
    const { clearProjectAliases } = await import("../../../src/lib/config.js");
    await clearProjectAliases();

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("organizations/my-org/issues/CRAFT-G")) {
        return new Response(
          JSON.stringify({
            id: "777888999",
            shortId: "CRAFT-G",
            title: "Test Issue fallback",
            status: "unresolved",
            platform: "javascript",
            type: "error",
            count: "1",
            userCount: 1,
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
      "craft-g",
      "my-org",
      testConfigDir,
      "sentry issue explain craft-g --org <org>"
    );

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("777888999");
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
    let fetchCount = 0;

    // Return PROCESSING first to allow animation interval to fire,
    // then COMPLETED on second call
    globalThis.fetch = async () => {
      fetchCount += 1;

      if (fetchCount === 1) {
        return new Response(
          JSON.stringify({
            autofix: {
              run_id: 12_345,
              status: "PROCESSING",
              steps: [
                {
                  id: "step-1",
                  key: "analysis",
                  status: "PROCESSING",
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
      pollIntervalMs: 100, // Allow animation interval (80ms) to fire
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
