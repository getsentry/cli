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
  // Partial failure handling applies to the per-project fetch path (auto-detect,
  // explicit, and project-search modes). The org-all mode (e.g. "multi-org/")
  // uses a single paginated API call and does not do per-project fetching.
  //
  // To trigger partial failures, we use project-search (bare slug) which fans
  // out across orgs via findProjectsBySlug → getProject per org, creating
  // multiple per-project fetch targets where some can fail independently.
  //
  // findProjectsBySlug flow:
  //   1. listOrganizations() → GET /api/0/organizations/
  //   2. getProject(org, slug) → GET /api/0/projects/{org}/{slug}/  (per org)
  //   3. listIssues(org, slug) → GET /api/0/organizations/{org}/issues/?query=project:{slug}

  test("JSON output includes error info on partial failures", async () => {
    await setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    await setOrgRegion("org-two", DEFAULT_SENTRY_URL);

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = req.url;

      // listOrganizations → returns org-one and org-two
      if (
        url.includes("/api/0/organizations/") &&
        !url.includes("/organizations/org-")
      ) {
        return new Response(
          JSON.stringify([
            { slug: "org-one", name: "Org One" },
            { slug: "org-two", name: "Org Two" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // getProject for each org (findProjectsBySlug)
      if (url.includes("/projects/org-one/myproj/")) {
        return new Response(
          JSON.stringify({ id: "1", slug: "myproj", name: "My Project" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/projects/org-two/myproj/")) {
        return new Response(
          JSON.stringify({ id: "2", slug: "myproj", name: "My Project" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // listIssues: org-one succeeds, org-two fails with 400
      if (url.includes("/organizations/org-one/issues/")) {
        return new Response(JSON.stringify([mockIssue({ id: "1" })]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/organizations/org-two/issues/")) {
        return new Response(
          JSON.stringify({ detail: "Invalid query syntax" }),
          { status: 400 }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context, stdout } = createContext();

    // project-search for "myproj" — finds it in org-one and org-two, creating
    // two per-project targets; org-one succeeds, org-two fails → partial failure
    await func.call(context, { limit: 10, sort: "date", json: true }, "myproj");

    const output = JSON.parse(stdout.output);
    expect(output).toHaveProperty("issues");
    expect(output).toHaveProperty("errors");
    expect(output.issues.length).toBe(1);
    expect(output.errors.length).toBe(1);
    expect(output.errors[0].status).toBe(400);
  });

  test("stderr warning on partial failures in human output", async () => {
    await setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    await setOrgRegion("org-two", DEFAULT_SENTRY_URL);

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = req.url;

      // listOrganizations → returns org-one and org-two
      if (
        url.includes("/api/0/organizations/") &&
        !url.includes("/organizations/org-")
      ) {
        return new Response(
          JSON.stringify([
            { slug: "org-one", name: "Org One" },
            { slug: "org-two", name: "Org Two" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // getProject for each org (findProjectsBySlug)
      if (url.includes("/projects/org-one/myproj/")) {
        return new Response(
          JSON.stringify({ id: "1", slug: "myproj", name: "My Project" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/projects/org-two/myproj/")) {
        return new Response(
          JSON.stringify({ id: "2", slug: "myproj", name: "My Project" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // listIssues: org-one succeeds, org-two fails with 403
      if (url.includes("/organizations/org-one/issues/")) {
        return new Response(JSON.stringify([mockIssue({ id: "1" })]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/organizations/org-two/issues/")) {
        return new Response(JSON.stringify({ detail: "Permission denied" }), {
          status: 403,
        });
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context, stderr } = createContext();

    // project-search for "myproj" — org-one succeeds, org-two gets 403 → partial failure
    await func.call(
      context,
      { limit: 10, sort: "date", json: false },
      "myproj"
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
