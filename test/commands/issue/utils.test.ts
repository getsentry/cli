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
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { CONFIG_DIR_ENV_VAR } from "../../../src/lib/db/index.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { cleanupTestDir, createTestConfigDir } from "../../helpers.js";

let testConfigDir: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-issue-utils-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
  originalFetch = globalThis.fetch;
  await setAuthToken("test-token");
  // Pre-populate region cache for orgs used in tests to avoid region resolution API calls
  await setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  await setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  await setOrgRegion("cached-org", DEFAULT_SENTRY_URL);
  await setOrgRegion("org1", DEFAULT_SENTRY_URL);
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await cleanupTestDir(testConfigDir);
});

describe("resolveOrgAndIssueId", () => {
  test("throws for numeric ID (org cannot be resolved)", async () => {
    // @ts-expect-error - partial mock
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

    // Numeric IDs don't have org context, so resolveOrgAndIssueId should throw
    await expect(
      resolveOrgAndIssueId({
        issueArg: "123456789",
        cwd: testConfigDir,
        command: "explain",
      })
    ).rejects.toThrow("Organization");
  });

  test("resolves explicit org prefix (org/ISSUE-ID)", async () => {
    // @ts-expect-error - partial mock
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
      issueArg: "my-org/PROJECT-ABC",
      cwd: testConfigDir,
      command: "explain",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("987654321");
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

    // @ts-expect-error - partial mock
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
      issueArg: "f-g",
      cwd: testConfigDir,
      command: "explain",
    });

    expect(result.org).toBe("cached-org");
    expect(result.issueId).toBe("111222333");
  });

  test("resolves explicit org prefix with project-suffix (e.g., 'org1/dashboard-4y')", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // With explicit org, we try project-suffix format: dashboard-4y -> DASHBOARD-4Y
      if (url.includes("organizations/org1/issues/DASHBOARD-4Y")) {
        return new Response(
          JSON.stringify({
            id: "999888777",
            shortId: "DASHBOARD-4Y",
            title: "Test Issue with explicit org",
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
      issueArg: "org1/dashboard-4y",
      cwd: testConfigDir,
      command: "explain",
    });

    expect(result.org).toBe("org1");
    expect(result.issueId).toBe("999888777");
  });

  test("resolves short suffix format (e.g., 'G') using project context from defaults", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await setDefaults("my-org", "my-project");

    // @ts-expect-error - partial mock
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
      issueArg: "G",
      cwd: testConfigDir,
      command: "explain",
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

    await expect(
      resolveOrgAndIssueId({
        issueArg: "G",
        cwd: testConfigDir,
        command: "explain",
      })
    ).rejects.toThrow("Cannot resolve issue suffix");
  });

  test("searches projects across orgs for project-suffix format", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    await clearProjectAliases();

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // listOrganizations call
      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/")
      ) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "my-org", name: "My Org" }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // listProjects for my-org
      if (url.includes("organizations/my-org/projects/")) {
        return new Response(
          JSON.stringify([
            { id: "123", slug: "craft", name: "Craft", platform: "javascript" },
            {
              id: "456",
              slug: "other-project",
              name: "Other",
              platform: "python",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

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
      issueArg: "craft-g",
      cwd: testConfigDir,
      command: "explain",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("777888999");
  });

  test("throws when project not found in any org", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    await clearProjectAliases();

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // listOrganizations call
      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/")
      ) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "my-org", name: "My Org" }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // listProjects - return projects that don't match "nonexistent"
      if (url.includes("/projects/")) {
        return new Response(
          JSON.stringify([
            {
              id: "123",
              slug: "other-project",
              name: "Other",
              platform: "python",
            },
          ]),
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
        issueArg: "nonexistent-g",
        cwd: testConfigDir,
        command: "explain",
      })
    ).rejects.toThrow("not found");
  });

  test("throws when project found in multiple orgs without explicit org", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    await clearProjectAliases();

    await setOrgRegion("org2", DEFAULT_SENTRY_URL);

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // listOrganizations call
      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/")
      ) {
        return new Response(
          JSON.stringify([
            { id: "1", slug: "org1", name: "Org 1" },
            { id: "2", slug: "org2", name: "Org 2" },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // listProjects for org1 - has "common" project
      if (url.includes("organizations/org1/projects/")) {
        return new Response(
          JSON.stringify([
            {
              id: "123",
              slug: "common",
              name: "Common",
              platform: "javascript",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // listProjects for org2 - also has "common" project
      if (url.includes("organizations/org2/projects/")) {
        return new Response(
          JSON.stringify([
            { id: "456", slug: "common", name: "Common", platform: "python" },
          ]),
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
        issueArg: "common-g",
        cwd: testConfigDir,
        command: "explain",
      })
    ).rejects.toThrow("multiple organizations");
  });

  test("short suffix auth error (401) propagates", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await setDefaults("my-org", "my-project");

    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
      });

    // Auth errors should propagate
    await expect(
      resolveOrgAndIssueId({
        issueArg: "G",
        cwd: testConfigDir,
        command: "explain",
      })
    ).rejects.toThrow();
  });

  test("short suffix server error (500) propagates", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await setDefaults("my-org", "my-project");

    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Internal Server Error" }), {
        status: 500,
      });

    // Server errors should propagate
    await expect(
      resolveOrgAndIssueId({
        issueArg: "G",
        cwd: testConfigDir,
        command: "explain",
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

    // @ts-expect-error - partial mock
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
    // @ts-expect-error - partial mock
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
    // @ts-expect-error - partial mock
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

    // @ts-expect-error - partial mock
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
    // @ts-expect-error - partial mock
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
    // @ts-expect-error - partial mock
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

    // @ts-expect-error - partial mock
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
