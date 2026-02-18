/**
 * Issue List Command Tests
 *
 * Tests for error propagation and partial failure handling
 * in src/commands/issue/list.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { listCommand } from "../../../src/commands/issue/list.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setDefaults } from "../../../src/lib/db/defaults.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { ApiError } from "../../../src/lib/errors.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

type ListFlags = {
  readonly query?: string;
  readonly limit: number;
  readonly sort: "date" | "new" | "freq" | "user";
  readonly json: boolean;
};

/** Command function type extracted from loader result */
type ListFunc = (
  this: unknown,
  flags: ListFlags,
  target?: string
) => Promise<void>;

const getConfigDir = useTestConfigDir("test-issue-list-", {
  isolateProjectRoot: true,
});

let originalFetch: typeof globalThis.fetch;
let func: ListFunc;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  func = (await listCommand.loader()) as unknown as ListFunc;
  await setAuthToken("test-token");
  await setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  await setDefaults("test-org", "test-project");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Create a minimal context mock for testing */
function createContext() {
  const stdout = {
    output: "",
    write(s: string) {
      stdout.output += s;
    },
  };
  const stderr = {
    output: "",
    write(s: string) {
      stderr.output += s;
    },
  };

  const context = {
    process,
    stdout,
    stderr,
    cwd: getConfigDir(),
    setContext: () => {
      // Intentionally empty — telemetry context not needed in tests
    },
  };

  return { context, stdout, stderr };
}

/** Build a mock issue response */
function mockIssue(overrides?: Record<string, unknown>) {
  return {
    id: "123",
    shortId: "TEST-PROJECT-1",
    title: "Test Error",
    status: "unresolved",
    platform: "javascript",
    type: "error",
    count: "10",
    userCount: 5,
    lastSeen: "2025-01-01T00:00:00Z",
    firstSeen: "2025-01-01T00:00:00Z",
    level: "error",
    ...overrides,
  };
}

describe("issue list: error propagation", () => {
  test("throws ApiError (not plain Error) when all fetches fail with 400", async () => {
    // Uses default org/project from setDefaults("test-org", "test-project")
    // listIssues hits: /api/0/organizations/test-org/issues/?query=project:test-project
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/issues/")) {
        return new Response(
          JSON.stringify({ detail: "Invalid query: unknown field" }),
          { status: 400 }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    });

    const { context } = createContext();

    try {
      await func.call(context, { limit: 10, sort: "date", json: false });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as Error).message).toContain("Failed to fetch issues");
    }
  });

  test("throws ApiError with 404 status when project not found", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/issues/")) {
        return new Response(JSON.stringify({ detail: "Project not found" }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context } = createContext();

    try {
      await func.call(context, { limit: 10, sort: "date", json: false });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
    }
  });

  test("throws ApiError with 429 status on rate limiting", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/issues/")) {
        return new Response(JSON.stringify({ detail: "Too many requests" }), {
          status: 429,
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context } = createContext();

    try {
      await func.call(context, { limit: 10, sort: "date", json: false });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
    }
  });

  test("preserves ApiError detail from original error", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/issues/")) {
        return new Response(
          JSON.stringify({ detail: "Invalid search query: bad syntax" }),
          { status: 400 }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context } = createContext();

    try {
      await func.call(context, { limit: 10, sort: "date", json: false });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiErr = error as ApiError;
      expect(apiErr.detail).toBeDefined();
    }
  });
});

describe("issue list: partial failure handling", () => {
  test("JSON output includes error info on partial failures", async () => {
    await setOrgRegion("multi-org", DEFAULT_SENTRY_URL);

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = req.url;

      // listProjects: /api/0/organizations/multi-org/projects/
      if (url.includes("/organizations/multi-org/projects/")) {
        return new Response(
          JSON.stringify([
            { id: "1", slug: "proj-a", name: "Project A" },
            { id: "2", slug: "proj-b", name: "Project B" },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json", Link: "" },
          }
        );
      }

      // listIssues: /api/0/organizations/multi-org/issues/?query=project:proj-a...
      if (url.includes("/organizations/multi-org/issues/")) {
        const queryParam = new URL(url).searchParams.get("query") ?? "";
        if (queryParam.includes("project:proj-a")) {
          return new Response(JSON.stringify([mockIssue({ id: "1" })]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (queryParam.includes("project:proj-b")) {
          return new Response(
            JSON.stringify({ detail: "Invalid query syntax" }),
            { status: 400 }
          );
        }
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context, stdout } = createContext();

    await func.call(
      context,
      { limit: 10, sort: "date", json: true },
      "multi-org/"
    );

    const output = JSON.parse(stdout.output);
    expect(output).toHaveProperty("issues");
    expect(output).toHaveProperty("errors");
    expect(output.issues.length).toBe(1);
    expect(output.errors.length).toBe(1);
    expect(output.errors[0].status).toBe(400);
  });

  test("stderr warning on partial failures in human output", async () => {
    await setOrgRegion("multi-org", DEFAULT_SENTRY_URL);

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("/organizations/multi-org/projects/")) {
        return new Response(
          JSON.stringify([
            { id: "1", slug: "proj-a", name: "Project A" },
            { id: "2", slug: "proj-b", name: "Project B" },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json", Link: "" },
          }
        );
      }

      if (url.includes("/organizations/multi-org/issues/")) {
        const queryParam = new URL(url).searchParams.get("query") ?? "";
        if (queryParam.includes("project:proj-a")) {
          return new Response(JSON.stringify([mockIssue({ id: "1" })]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (queryParam.includes("project:proj-b")) {
          return new Response(JSON.stringify({ detail: "Permission denied" }), {
            status: 403,
          });
        }
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context, stderr } = createContext();

    await func.call(
      context,
      { limit: 10, sort: "date", json: false },
      "multi-org/"
    );

    expect(stderr.output).toContain("Failed to fetch issues from 1 project(s)");
    expect(stderr.output).toContain("Showing results from 1 project(s)");
  });

  test("JSON output is plain array when no failures", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/issues/")) {
        return new Response(JSON.stringify([mockIssue()]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context, stdout } = createContext();

    await func.call(context, { limit: 10, sort: "date", json: true });

    const output = JSON.parse(stdout.output);
    // Should be a plain array, not an object with issues/errors keys
    expect(Array.isArray(output)).toBe(true);
  });
});
