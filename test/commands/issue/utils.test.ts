/**
 * Issue Command Utilities Tests
 *
 * Tests for shared utilities in src/commands/issue/utils.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildCommandHint,
  ensureRootCauseAnalysis,
  pollAutofixState,
  resolveOrgAndIssueId,
} from "../../../src/commands/issue/utils.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { useTestConfigDir } from "../../helpers.js";

describe("buildCommandHint", () => {
  test("suggests <org>/ID for numeric IDs", () => {
    expect(buildCommandHint("view", "123456789")).toBe(
      "sentry issue view <org>/123456789"
    );
    expect(buildCommandHint("explain", "0")).toBe(
      "sentry issue explain <org>/0"
    );
  });

  test("suggests <project>-suffix for short suffixes", () => {
    expect(buildCommandHint("view", "G")).toBe("sentry issue view <project>-G");
    expect(buildCommandHint("explain", "4Y")).toBe(
      "sentry issue explain <project>-4Y"
    );
    expect(buildCommandHint("plan", "ABC")).toBe(
      "sentry issue plan <project>-ABC"
    );
  });

  test("suggests <org>/ID for IDs with dashes", () => {
    expect(buildCommandHint("view", "cli-G")).toBe(
      "sentry issue view <org>/cli-G"
    );
    expect(buildCommandHint("explain", "PROJECT-ABC")).toBe(
      "sentry issue explain <org>/PROJECT-ABC"
    );
  });
});

const getConfigDir = useTestConfigDir("test-issue-utils-", {
  isolateProjectRoot: true,
});

let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  await setAuthToken("test-token");
  // Pre-populate region cache for orgs used in tests to avoid region resolution API calls
  await setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  await setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  await setOrgRegion("cached-org", DEFAULT_SENTRY_URL);
  await setOrgRegion("org1", DEFAULT_SENTRY_URL);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
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
        cwd: getConfigDir(),
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
      cwd: getConfigDir(),
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
      cwd: getConfigDir(),
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
      cwd: getConfigDir(),
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
      cwd: getConfigDir(),
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
        cwd: getConfigDir(),
        command: "explain",
      })
    ).rejects.toThrow("Cannot resolve issue suffix");
  });

  test("searches projects across orgs for project-suffix format", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    await clearProjectAliases();

    const fetchLog: string[] = [];

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;
      fetchLog.push(`FETCH: ${req.method} ${url}`);

      // getUserRegions - return empty regions to use fallback path
      if (url.includes("/users/me/regions/")) {
        fetchLog.push("  → matched: /users/me/regions/");
        return new Response(JSON.stringify({ regions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // listOrganizations call
      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/")
      ) {
        fetchLog.push("  → matched: listOrganizations");
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
        fetchLog.push("  → matched: listProjects for my-org");
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
        fetchLog.push("  → matched: issue CRAFT-G");
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

      fetchLog.push("  → NO MATCH (returning 404)");
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    // Debug: Check DB state before calling
    const { getDatabase: getDb } = await import("../../../src/lib/db/index.js");
    const testDb = getDb();
    const authRow = testDb
      .query("SELECT * FROM auth WHERE id = 1")
      .get() as Record<string, unknown> | null;
    const aliasRows = testDb
      .query("SELECT * FROM project_aliases")
      .all() as Record<string, unknown>[];
    const regionRows = testDb
      .query("SELECT * FROM org_regions")
      .all() as Record<string, unknown>[];
    console.error("DEBUG: auth =", JSON.stringify(authRow));
    console.error("DEBUG: aliases =", JSON.stringify(aliasRows));
    console.error("DEBUG: regions =", JSON.stringify(regionRows));
    console.error("DEBUG: SENTRY_CONFIG_DIR =", process.env.SENTRY_CONFIG_DIR);
    console.error("DEBUG: cwd =", getConfigDir());

    try {
      const result = await resolveOrgAndIssueId({
        issueArg: "craft-g",
        cwd: getConfigDir(),
        command: "explain",
      });

      expect(result.org).toBe("my-org");
      expect(result.issueId).toBe("777888999");
    } catch (error) {
      console.error("FETCH LOG:", fetchLog.join("\n"));
      throw error;
    }
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

      // getUserRegions - return empty regions to use fallback path
      if (url.includes("/users/me/regions/")) {
        return new Response(JSON.stringify({ regions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

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
        cwd: getConfigDir(),
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

    const fetchLog: string[] = [];

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;
      fetchLog.push(`FETCH: ${req.method} ${url}`);

      // getUserRegions - return empty regions to use fallback path
      if (url.includes("/users/me/regions/")) {
        fetchLog.push("  → matched: /users/me/regions/");
        return new Response(JSON.stringify({ regions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // listOrganizations call
      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/")
      ) {
        fetchLog.push("  → matched: listOrganizations");
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
        fetchLog.push("  → matched: listProjects for org1");
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
        fetchLog.push("  → matched: listProjects for org2");
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

      fetchLog.push("  → NO MATCH (returning 404)");
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    try {
      await resolveOrgAndIssueId({
        issueArg: "common-g",
        cwd: getConfigDir(),
        command: "explain",
      });
      // If we get here, the function didn't throw — log and fail
      console.error("FETCH LOG (no throw):", fetchLog.join("\n"));
      throw new Error("Expected resolveOrgAndIssueId to throw but it resolved");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes("multiple organizations")) {
        console.error("FETCH LOG (wrong error):", fetchLog.join("\n"));
        console.error("Actual error:", msg);
      }
      expect(msg).toContain("multiple organizations");
    }
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
        cwd: getConfigDir(),
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
        cwd: getConfigDir(),
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

describe("ensureRootCauseAnalysis", () => {
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

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBe(1); // Only one fetch to check state
  });

  test("returns immediately when state is WAITING_FOR_USER_RESPONSE", async () => {
    let fetchCount = 0;

    // @ts-expect-error - partial mock
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response(
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
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
    });

    expect(result.status).toBe("WAITING_FOR_USER_RESPONSE");
    expect(fetchCount).toBe(1);
  });

  test("triggers new analysis when no state exists", async () => {
    let triggerCalled = false;

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // First call: getAutofixState returns null
      if (url.includes("/autofix/") && req.method === "GET") {
        // After trigger, return COMPLETED
        if (triggerCalled) {
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
        }
        // Before trigger, return null
        return new Response(JSON.stringify({ autofix: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Trigger RCA endpoint
      if (url.includes("/autofix/") && req.method === "POST") {
        triggerCalled = true;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(triggerCalled).toBe(true);
  });

  test("retries when existing analysis has ERROR status", async () => {
    let triggerCalled = false;

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // getAutofixState
      if (url.includes("/autofix/") && req.method === "GET") {
        // First call returns ERROR, subsequent calls return COMPLETED
        if (!triggerCalled) {
          return new Response(
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
        }
        return new Response(
          JSON.stringify({
            autofix: {
              run_id: 12_346,
              status: "COMPLETED",
              steps: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Trigger RCA endpoint
      if (url.includes("/autofix/") && req.method === "POST") {
        triggerCalled = true;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(triggerCalled).toBe(true); // Should have retried
  });

  test("polls until complete when state is PROCESSING", async () => {
    let fetchCount = 0;

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);

      if (req.method === "GET") {
        fetchCount += 1;

        // First call returns PROCESSING, second returns COMPLETED
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
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBeGreaterThan(1); // Polled multiple times
  });

  test("forces new analysis when force flag is true", async () => {
    let triggerCalled = false;

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // getAutofixState - would return COMPLETED, but force should skip this
      if (url.includes("/autofix/") && req.method === "GET") {
        // After trigger, return new COMPLETED state
        return new Response(
          JSON.stringify({
            autofix: {
              run_id: triggerCalled ? 99_999 : 12_345,
              status: "COMPLETED",
              steps: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Trigger RCA endpoint
      if (url.includes("/autofix/") && req.method === "POST") {
        triggerCalled = true;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",
      stderr: mockStderr,
      json: true,
      force: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(triggerCalled).toBe(true); // Should trigger even though state exists
  });

  test("writes progress messages to stderr when not in JSON mode", async () => {
    let stderrOutput = "";
    let triggerCalled = false;

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("/autofix/") && req.method === "GET") {
        if (triggerCalled) {
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
        }
        return new Response(JSON.stringify({ autofix: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/autofix/") && req.method === "POST") {
        triggerCalled = true;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const stderrMock = {
      write: (s: string) => {
        stderrOutput += s;
      },
    };

    await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",
      stderr: stderrMock,
      json: false, // Not JSON mode, should output progress
    });

    expect(stderrOutput).toContain("root cause analysis");
  });
});
