/**
 * Issue List Command Tests
 *
 * Tests for error propagation and partial failure handling
 * in src/commands/issue/list.ts
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { listCommand } from "../../../src/commands/issue/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setDefaults } from "../../../src/lib/db/defaults.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as paginationDb from "../../../src/lib/db/pagination.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { ApiError, ValidationError } from "../../../src/lib/errors.js";
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
    expect(output).toHaveProperty("data");
    expect(output).toHaveProperty("errors");
    expect(output.data.length).toBe(1);
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

  test("JSON output wraps in {data, hasMore} object", async () => {
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
    // Multi-target mode always wraps in {data, hasMore} for consistency with org-all mode
    expect(output).toHaveProperty("data");
    expect(output).toHaveProperty("hasMore");
    expect(Array.isArray(output.data)).toBe(true);
  });
});

describe("issue list: org-all mode (cursor pagination)", () => {
  let listIssuesPaginatedSpy: ReturnType<typeof spyOn>;
  let getPaginationCursorSpy: ReturnType<typeof spyOn>;
  let setPaginationCursorSpy: ReturnType<typeof spyOn>;
  let clearPaginationCursorSpy: ReturnType<typeof spyOn>;

  function createOrgAllContext() {
    const stdoutWrite = mock(() => true);
    const stderrWrite = mock(() => true);
    return {
      context: {
        stdout: { write: stdoutWrite },
        stderr: { write: stderrWrite },
        cwd: "/tmp",
        setContext: mock(() => {
          // no-op for test
        }),
      },
      stdoutWrite,
      stderrWrite,
    };
  }

  const sampleIssue = {
    id: "1",
    shortId: "PROJ-1",
    title: "Test Error",
    status: "unresolved",
    platform: "javascript",
    type: "error",
    count: "5",
    userCount: 2,
    lastSeen: "2025-01-01T00:00:00Z",
    firstSeen: "2025-01-01T00:00:00Z",
    level: "error",
    project: { slug: "test-proj" },
  };

  beforeEach(() => {
    listIssuesPaginatedSpy = spyOn(apiClient, "listIssuesPaginated");
    getPaginationCursorSpy = spyOn(paginationDb, "getPaginationCursor");
    setPaginationCursorSpy = spyOn(paginationDb, "setPaginationCursor");
    clearPaginationCursorSpy = spyOn(paginationDb, "clearPaginationCursor");

    setPaginationCursorSpy.mockReturnValue(undefined);
    clearPaginationCursorSpy.mockReturnValue(undefined);
  });

  afterEach(() => {
    listIssuesPaginatedSpy.mockRestore();
    getPaginationCursorSpy.mockRestore();
    setPaginationCursorSpy.mockRestore();
    clearPaginationCursorSpy.mockRestore();
  });

  test("throws ValidationError when --cursor used outside org-all mode", async () => {
    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    const { context } = createOrgAllContext();

    await expect(
      orgAllFunc.call(
        context,
        { limit: 10, sort: "date", json: false, cursor: "some-cursor" },
        "my-org/my-project"
      )
    ).rejects.toThrow(ValidationError);
  });

  test("returns paginated JSON with hasMore=false when no nextCursor", async () => {
    listIssuesPaginatedSpy.mockResolvedValue({
      data: [sampleIssue],
      nextCursor: undefined,
    });

    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    const { context, stdoutWrite } = createOrgAllContext();
    await orgAllFunc.call(
      context,
      { limit: 10, sort: "date", json: true },
      "my-org/"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("hasMore", false);
    expect(clearPaginationCursorSpy).toHaveBeenCalled();
  });

  test("returns paginated JSON with hasMore=true when nextCursor present", async () => {
    listIssuesPaginatedSpy.mockResolvedValue({
      data: [sampleIssue],
      nextCursor: "cursor:xyz:1",
    });

    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    const { context, stdoutWrite } = createOrgAllContext();
    await orgAllFunc.call(
      context,
      { limit: 10, sort: "date", json: true },
      "my-org/"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("hasMore", true);
    expect(parsed).toHaveProperty("nextCursor", "cursor:xyz:1");
    expect(setPaginationCursorSpy).toHaveBeenCalled();
  });

  test("human output shows next page hint when hasMore", async () => {
    listIssuesPaginatedSpy.mockResolvedValue({
      data: [sampleIssue],
      nextCursor: "cursor:xyz:1",
    });

    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    const { context, stdoutWrite } = createOrgAllContext();
    await orgAllFunc.call(
      context,
      { limit: 10, sort: "date", json: false },
      "my-org/"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("more available");
    expect(output).toContain("Next page:");
    expect(output).toContain("-c last");
  });

  test("human output 'No issues found' when empty org-all", async () => {
    listIssuesPaginatedSpy.mockResolvedValue({
      data: [],
      nextCursor: undefined,
    });

    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    const { context, stdoutWrite } = createOrgAllContext();
    await orgAllFunc.call(
      context,
      { limit: 10, sort: "date", json: false },
      "my-org/"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No issues found in organization 'my-org'.");
  });

  test("resolves 'last' cursor from cache in org-all mode", async () => {
    getPaginationCursorSpy.mockReturnValue("cached:cursor:789");
    listIssuesPaginatedSpy.mockResolvedValue({
      data: [sampleIssue],
      nextCursor: undefined,
    });

    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    const { context } = createOrgAllContext();
    await orgAllFunc.call(
      context,
      { limit: 10, sort: "date", json: false, cursor: "last" },
      "my-org/"
    );

    expect(listIssuesPaginatedSpy).toHaveBeenCalledWith(
      "my-org",
      "",
      expect.objectContaining({ cursor: "cached:cursor:789" })
    );
  });

  test("throws ContextError when 'last' cursor not in cache", async () => {
    getPaginationCursorSpy.mockReturnValue(null);

    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    const { context } = createOrgAllContext();

    await expect(
      orgAllFunc.call(
        context,
        { limit: 10, sort: "date", json: false, cursor: "last" },
        "my-org/"
      )
    ).rejects.toThrow("No saved cursor");
  });

  test("uses explicit cursor string in org-all mode", async () => {
    listIssuesPaginatedSpy.mockResolvedValue({
      data: [sampleIssue],
      nextCursor: undefined,
    });

    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    const { context } = createOrgAllContext();
    await orgAllFunc.call(
      context,
      { limit: 10, sort: "date", json: false, cursor: "explicit:cursor:val" },
      "my-org/"
    );

    expect(listIssuesPaginatedSpy).toHaveBeenCalledWith(
      "my-org",
      "",
      expect.objectContaining({ cursor: "explicit:cursor:val" })
    );
  });
});

describe("issue list: cursor flag parse validation", () => {
  // Access the parse function directly from the command's flag definition.
  // This tests the validation without needing a full command invocation.
  const parseCursor = (
    listCommand.parameters.flags!.cursor as { parse: (v: string) => string }
  ).parse;

  test('accepts "last" keyword', () => {
    expect(parseCursor("last")).toBe("last");
  });

  test("accepts valid opaque cursor strings", () => {
    expect(parseCursor("1735689600:0:0")).toBe("1735689600:0:0");
    expect(parseCursor("1735689600:0:1")).toBe("1735689600:0:1");
    expect(parseCursor("abc:def:ghi")).toBe("abc:def:ghi");
  });

  test("rejects plain integer cursors with descriptive error", () => {
    expect(() => parseCursor("100")).toThrow("not a valid cursor");
    expect(() => parseCursor("100")).toThrow("1735689600:0:0");
  });

  test("error message includes the invalid value passed", () => {
    expect(() => parseCursor("5000")).toThrow("'5000'");
  });
});
