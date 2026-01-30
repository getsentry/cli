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
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { CONFIG_DIR_ENV_VAR } from "../../../src/lib/db/index.js";
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
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // Numeric ID is fetched directly
      if (url.includes("/issues/123456789/")) {
        return new Response(
          JSON.stringify({
            id: "123456789",
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

    const result = await resolveOrgAndIssueId({
      issueId: "123456789",
      org: "my-org",
      cwd: testConfigDir,
      commandHint: "sentry issue explain 123456789 --org <org-slug>",
    });

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

    const result = await resolveOrgAndIssueId({
      issueId: "PROJECT-ABC",
      org: "my-org",
      cwd: testConfigDir,
      commandHint: "sentry issue explain PROJECT-ABC --org <org-slug>",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("987654321");
  });

  test("throws ContextError when org cannot be resolved", async () => {
    delete process.env.SENTRY_DSN;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // Numeric ID is fetched directly - this succeeds
      if (url.includes("/issues/123456789/")) {
        return new Response(
          JSON.stringify({
            id: "123456789",
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

    await expect(
      resolveOrgAndIssueId({
        issueId: "123456789",
        cwd: "/nonexistent/path",
        commandHint: "sentry issue explain 123456789 --org <org-slug>",
      })
    ).rejects.toThrow("Organization");
  });

  test("resolves alias-suffix format (e.g., 'f-g') using cached aliases", async () => {
    // Empty fingerprint matches detectAllDsns on empty dir
    const { setProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
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

    const result = await resolveOrgAndIssueId({
      issueId: "f-g",
      cwd: testConfigDir,
      commandHint: "sentry issue explain f-g --org <org-slug>",
    });

    expect(result.org).toBe("cached-org");
    expect(result.issueId).toBe("111222333");
  });

  test("resolves org-aware alias format (e.g., 'o1:d-4y') for cross-org collisions", async () => {
    const { setProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
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

    const result = await resolveOrgAndIssueId({
      issueId: "o1:d-4y",
      cwd: testConfigDir,
      commandHint: "sentry issue explain o1:d-4y",
    });

    expect(result.org).toBe("org1");
    expect(result.issueId).toBe("999888777");
  });

  test("resolves short suffix format (e.g., 'G') using project context", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
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

    const result = await resolveOrgAndIssueId({
      issueId: "G",
      cwd: testConfigDir,
      commandHint: "sentry issue explain G --org <org-slug>",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("444555666");
  });

  test("throws ContextError for short suffix without project context", async () => {
    // Clear any defaults to ensure no project context
    const { clearAuth } = await import("../../../src/lib/db/auth.js");
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await clearAuth();
    await setDefaults(undefined, undefined);

    // Short suffix "G" first tries to expand with project context (fails with ContextError),
    // then falls through to full short ID resolution (requires org), which also fails.
    // The final error is "Organization is required" since the fallthrough logic allows trying
    // it as a full short ID, and that's where it ultimately fails.
    await expect(
      resolveOrgAndIssueId({
        issueId: "G",
        cwd: testConfigDir,
        commandHint: "sentry issue explain G --org <org-slug>",
      })
    ).rejects.toThrow("Organization is required");
  });

  test("resolves short suffix with explicit --org and --project flags", async () => {
    // Clear defaults but keep auth token to ensure we're testing explicit flags
    const { clearAuth, setAuthToken: setToken } = await import(
      "../../../src/lib/db/auth.js"
    );
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await clearAuth();
    await setDefaults(undefined, undefined);
    await setToken("test-token");

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("organizations/my-org/issues/MY-PROJECT-G")) {
        return new Response(
          JSON.stringify({
            id: "555666777",
            shortId: "MY-PROJECT-G",
            title: "Test Issue with explicit flags",
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

    const result = await resolveOrgAndIssueId({
      issueId: "G",
      org: "my-org",
      project: "my-project",
      cwd: testConfigDir,
      commandHint:
        "sentry issue explain G --org <org-slug> --project <project-slug>",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("555666777");
  });

  test("falls back to full short ID when alias is not found in cache", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
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

    const result = await resolveOrgAndIssueId({
      issueId: "craft-g",
      org: "my-org",
      cwd: testConfigDir,
      commandHint: "sentry issue explain craft-g --org <org-slug>",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("777888999");
  });

  test("short suffix 404 falls through to full short ID resolution", async () => {
    // Setup: project context exists, but short suffix lookup returns 404
    // Should fall through and try as full short ID
    const { setAuthToken: setToken } = await import(
      "../../../src/lib/db/auth.js"
    );
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await setToken("test-token");
    await setDefaults("my-org", "my-project");

    let shortSuffixAttempted = false;
    let fullShortIdAttempted = false;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // First attempt: short suffix expansion (MY-PROJECT-15) returns 404
      if (url.includes("organizations/my-org/issues/MY-PROJECT-15")) {
        shortSuffixAttempted = true;
        return new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
        });
      }

      // Fallthrough: try as full short ID (15 contains no letters, so goes to numeric)
      // Actually "15" will be treated as numeric ID after fallthrough
      if (url.includes("issues/15/")) {
        fullShortIdAttempted = true;
        return new Response(
          JSON.stringify({
            id: "15",
            shortId: "ACTUAL-PROJECT-X",
            title: "Found via numeric fallback",
            status: "unresolved",
            platform: "python",
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

    const result = await resolveOrgAndIssueId({
      issueId: "15",
      cwd: testConfigDir,
      commandHint: "sentry issue explain 15",
    });

    expect(shortSuffixAttempted).toBe(true);
    expect(fullShortIdAttempted).toBe(true);
    expect(result.issueId).toBe("15");
  });

  test("short suffix auth error (401) propagates without fallthrough", async () => {
    const { setAuthToken: setToken } = await import(
      "../../../src/lib/db/auth.js"
    );
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await setToken("test-token");
    await setDefaults("my-org", "my-project");

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
      });

    // Auth errors should propagate, not fall through
    await expect(
      resolveOrgAndIssueId({
        issueId: "G",
        cwd: testConfigDir,
        commandHint: "sentry issue explain G",
      })
    ).rejects.toThrow();
  });

  test("short suffix server error (500) propagates without fallthrough", async () => {
    const { setAuthToken: setToken } = await import(
      "../../../src/lib/db/auth.js"
    );
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await setToken("test-token");
    await setDefaults("my-org", "my-project");

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Internal Server Error" }), {
        status: 500,
      });

    // Server errors should propagate, not fall through
    await expect(
      resolveOrgAndIssueId({
        issueId: "G",
        cwd: testConfigDir,
        commandHint: "sentry issue explain G",
      })
    ).rejects.toThrow("500");
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
