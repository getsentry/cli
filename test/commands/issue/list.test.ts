/**
 * Issue List Command Tests
 *
 * Tests for error propagation and partial failure handling
 * in src/commands/issue/list.ts
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listCommand } from "../../../src/commands/issue/list.js";

vi.mock("../../../src/lib/api/issues.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/api/issues.js")>();
  return {
    ...actual,
    listIssuesPaginated: vi.fn(actual.listIssuesPaginated),
    listIssuesAllPages: vi.fn(actual.listIssuesAllPages),
  };
});
vi.mock("../../../src/lib/api/projects.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/api/projects.js")>();
  return {
    ...actual,
    getProject: vi.fn(actual.getProject),
    findProjectsBySlug: vi.fn(actual.findProjectsBySlug),
    listProjects: vi.fn(actual.listProjects),
  };
});
vi.mock("../../../src/lib/db/pagination.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/db/pagination.js")>();
  return {
    ...actual,
    resolveCursor: vi.fn(actual.resolveCursor),
    advancePaginationState: vi.fn(actual.advancePaginationState),
  };
});

// biome-ignore lint/performance/noNamespaceImport: namespace needed for vi.spyOn on mocked module
import * as issuesApi from "../../../src/lib/api/issues.js";
// biome-ignore lint/performance/noNamespaceImport: namespace needed for vi.spyOn on mocked module
import * as projectsApi from "../../../src/lib/api/projects.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import {
  setDefaultOrganization,
  setDefaultProject,
} from "../../../src/lib/db/defaults.js";
// biome-ignore lint/performance/noNamespaceImport: namespace needed for vi.spyOn on mocked module
import * as paginationDb from "../../../src/lib/db/pagination.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import {
  ApiError,
  ResolutionError,
  ValidationError,
} from "../../../src/lib/errors.js";
import type { TimeRange } from "../../../src/lib/time-range.js";
import { parsePeriod } from "../../../src/lib/time-range.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

type ListFlags = {
  readonly query?: string;
  readonly limit: number;
  readonly sort: "date" | "new" | "freq" | "user";
  readonly period: TimeRange;
  readonly json: boolean;
  readonly cursor?: string;
  readonly fields?: string[];
  readonly fresh?: boolean;
  readonly compact?: boolean;
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
  setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  setDefaultOrganization("test-org");
  setDefaultProject("test-project");
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
  };

  return { context, stdout, stderr };
}

/** Return a mock project response if the URL matches the default test project endpoint, or null. */
function mockDefaultProject(url: string): Response | null {
  if (url.includes("/api/0/projects/test-org/test-project/")) {
    return Response.json({
      id: "789",
      slug: "test-project",
      name: "Test Project",
    });
  }
  return null;
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
    // Uses default org/project from setDefaultOrganization/setDefaultProject
    // listIssues hits: /api/0/organizations/test-org/issues/?query=project:test-project
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const projectResp = mockDefaultProject(req.url);
      if (projectResp) return projectResp;
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
      await func.call(context, {
        limit: 10,
        sort: "date",
        period: parsePeriod("90d"),
        json: false,
      });
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
      const projectResp = mockDefaultProject(req.url);
      if (projectResp) return projectResp;
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
      await func.call(context, {
        limit: 10,
        sort: "date",
        period: parsePeriod("90d"),
        json: false,
      });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
    }
  });

  test("throws ApiError with 429 status on rate limiting", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const projectResp = mockDefaultProject(req.url);
      if (projectResp) return projectResp;
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
      await func.call(context, {
        limit: 10,
        sort: "date",
        period: parsePeriod("90d"),
        json: false,
      });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
    }
  });

  test("preserves ApiError detail from original error", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const projectResp = mockDefaultProject(req.url);
      if (projectResp) return projectResp;
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
      await func.call(context, {
        limit: 10,
        sort: "date",
        period: parsePeriod("90d"),
        json: false,
      });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiErr = error as ApiError;
      expect(apiErr.detail).toBeDefined();
    }
  });
});

describe("issue list: org-as-project detection", () => {
  test("throws ResolutionError when bare slug matches an organization", async () => {
    // Two orgs returned from /organizations/, but getProject returns 404 for both
    // The slug "acme-corp" matches one of the org slugs
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);

      // listOrganizations — return two orgs, one matching the slug
      if (
        req.url.includes("/organizations/") &&
        !req.url.includes("/projects/")
      ) {
        return Response.json([
          { slug: "acme-corp", name: "Acme Corp" },
          { slug: "other-org", name: "Other Org" },
        ]);
      }

      // getProject: no project found for either org
      if (req.url.includes("/projects/")) {
        return new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
        });
      }

      // region resolution
      if (req.url.includes("/region/")) {
        return Response.json([{ name: "default", url: DEFAULT_SENTRY_URL }]);
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    });

    const { context } = createContext();

    try {
      // Bare slug "acme-corp" triggers project-search mode
      await func.call(
        context,
        { limit: 10, sort: "date", period: parsePeriod("90d"), json: false },
        "acme-corp"
      );
      expect.unreachable("Should have thrown ResolutionError");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      const msg = (error as ResolutionError).message;
      expect(msg).toContain("is an organization, not a project");
      expect(msg).toContain("acme-corp/");
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
    setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    setOrgRegion("org-two", DEFAULT_SENTRY_URL);

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
    await func.call(
      context,
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: true },
      "myproj"
    );

    const output = JSON.parse(stdout.output);
    expect(output).toHaveProperty("data");
    expect(output).toHaveProperty("errors");
    expect(output.data.length).toBe(1);
    expect(output.errors.length).toBe(1);
    expect(output.errors[0].status).toBe(400);
    expect(output.errors[0].project).toBe("org-two/myproj");
  });

  test("stderr warning on partial failures in human output", async () => {
    setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    setOrgRegion("org-two", DEFAULT_SENTRY_URL);

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

    const stderrSpy = vi.spyOn(process.stderr, "write");
    try {
      const { context } = createContext();

      // project-search for "myproj" — org-one succeeds, org-two gets 403 → partial failure
      await func.call(
        context,
        { limit: 10, sort: "date", period: parsePeriod("90d"), json: false },
        "myproj"
      );

      // Partial failures are logged as warnings via logger (→ process.stderr)
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("Failed to fetch issues from org-two/myproj");
      expect(output).toContain("Showing results from 1 project(s)");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test("JSON output wraps in {data, hasMore} object", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const projectResp = mockDefaultProject(req.url);
      if (projectResp) return projectResp;
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

    await func.call(context, {
      limit: 10,
      sort: "date",
      period: parsePeriod("90d"),
      json: true,
    });

    const output = JSON.parse(stdout.output);
    // Multi-target mode always wraps in {data, hasMore} for consistency with org-all mode
    expect(output).toHaveProperty("data");
    expect(output).toHaveProperty("hasMore");
    expect(Array.isArray(output.data)).toBe(true);
  });
});

/** Shared mock references — vi.mocked() returns the same mock object each time */
const listIssuesPaginatedMock = vi.mocked(issuesApi.listIssuesPaginated);
const listIssuesAllPagesMock = vi.mocked(issuesApi.listIssuesAllPages);
const resolveCursorMock = vi.mocked(paginationDb.resolveCursor);
const advancePaginationStateMock = vi.mocked(
  paginationDb.advancePaginationState
);

describe("issue list: org-all mode (cursor pagination)", () => {
  function createOrgAllContext() {
    const stdoutWrite = vi.fn(() => true);
    const stderrWrite = vi.fn(() => true);
    return {
      context: {
        stdout: { write: stdoutWrite },
        stderr: { write: stderrWrite },
        cwd: "/tmp",
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

  beforeEach(async () => {
    // mockReset clears call data AND removes override implementations set by
    // mockResolvedValue/mockReturnValue from previous tests, falling back to
    // the vi.fn(realImpl) default set during vi.mock().
    listIssuesPaginatedMock.mockReset();
    listIssuesAllPagesMock.mockReset();
    resolveCursorMock.mockReset();
    advancePaginationStateMock.mockReset();

    // Pre-populate org cache so resolveEffectiveOrg hits the fast path
    setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  });

  test("--cursor is accepted in multi-target (explicit) mode", async () => {
    // Previously, --cursor threw ValidationError for non-org-all modes.
    // Now multi-target modes support compound cursor pagination, so --cursor
    // is accepted in auto-detect, explicit, and project-search modes.
    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    listIssuesAllPagesMock.mockResolvedValue({
      issues: [],
      nextCursor: undefined,
    });

    // Raw cursor passthrough: resolveCursor returns the cursor string as-is
    resolveCursorMock.mockReturnValue({
      cursor: "1735689600:0:0",
      direction: "next",
    });

    // The explicit target path calls fetchProjectId → getProject before listing.
    // Mock getProject so we don't hit the network.
    vi.mocked(projectsApi.getProject).mockResolvedValue({
      id: "1",
      slug: "test-project",
      name: "Test Project",
    } as Awaited<ReturnType<typeof projectsApi.getProject>>);

    const { context } = createOrgAllContext();

    // Using a real-looking cursor value (not "last") bypasses DB lookup.
    // The command should resolve, fetch, and complete without throwing.
    await expect(
      orgAllFunc.call(
        context,
        {
          limit: 10,
          sort: "date",
          period: parsePeriod("90d"),
          json: false,
          cursor: "1735689600:0:0",
        },
        "test-org/test-project"
      )
    ).resolves.toBeUndefined();
  });

  test("returns paginated JSON with hasMore=false when no nextCursor", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: true },
      "my-org/"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("hasMore", false);
    expect(advancePaginationStateMock).toHaveBeenCalled();
  });

  test("returns paginated JSON with hasMore=true when nextCursor present", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: true },
      "my-org/"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("hasMore", true);
    expect(parsed).toHaveProperty("nextCursor", "cursor:xyz:1");
    expect(advancePaginationStateMock).toHaveBeenCalled();
  });

  test("human output shows next page hint when hasMore", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: false },
      "my-org/"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("more available");
    expect(output).toContain("Next:");
    expect(output).toContain("-c next");
  });

  test("human output 'No issues found' when empty org-all", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [],
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
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: false },
      "my-org/"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No issues found in organization 'my-org'.");
  });

  test("resolves 'last' cursor from cache in org-all mode", async () => {
    // "last" (alias for "next") resolves to the cached cursor via resolveCursor.
    resolveCursorMock.mockReturnValue({
      cursor: "cached:cursor:789",
      direction: "next",
    });
    listIssuesPaginatedMock.mockResolvedValue({
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
      {
        limit: 10,
        sort: "date",
        period: parsePeriod("90d"),
        json: false,
        cursor: "last",
      },
      "my-org/"
    );

    expect(listIssuesPaginatedMock).toHaveBeenCalledWith(
      "my-org",
      "",
      expect.objectContaining({ cursor: "cached:cursor:789" })
    );
  });

  test("throws ValidationError when 'last' cursor not in cache", async () => {
    resolveCursorMock.mockImplementation(() => {
      throw new ValidationError(
        "No next page saved for this query. Run without --cursor first.",
        "cursor"
      );
    });

    const orgAllFunc = (await listCommand.loader()) as unknown as (
      this: unknown,
      flags: Record<string, unknown>,
      target?: string
    ) => Promise<void>;

    const { context } = createOrgAllContext();

    await expect(
      orgAllFunc.call(
        context,
        {
          limit: 10,
          sort: "date",
          period: parsePeriod("90d"),
          json: false,
          cursor: "last",
        },
        "my-org/"
      )
    ).rejects.toThrow("No next page saved");
  });

  test("uses explicit cursor string in org-all mode", async () => {
    // Raw cursor passthrough: resolveCursor returns the cursor string as-is
    resolveCursorMock.mockReturnValue({
      cursor: "explicit:cursor:val",
      direction: "next",
    });
    listIssuesPaginatedMock.mockResolvedValue({
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
      {
        limit: 10,
        sort: "date",
        period: parsePeriod("90d"),
        json: false,
        cursor: "explicit:cursor:val",
      },
      "my-org/"
    );

    expect(listIssuesPaginatedMock).toHaveBeenCalledWith(
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

describe("issue list: Phase 2 budget redistribution", () => {
  // Phase 2 triggers when: totalFetched < limit AND some targets hit their
  // quota but have more (nextCursor). The surplus budget redistributes.
  //
  // Setup: two orgs with same project slug (project-search), limit=6.
  //   Phase 1: quota=3 per target.
  //     org-one: returns 3 issues + nextCursor (can expand)
  //     org-two: returns 1 issue, no cursor (exhausted)
  //   Surplus: 6 - 4 = 2, expandable = [org-one]
  //   Phase 2: fetch 2 more from org-one via cursor resume.

  test("redistributes surplus to expandable targets", async () => {
    setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    setOrgRegion("org-two", DEFAULT_SENTRY_URL);

    const issue = (id: string) => ({
      id,
      shortId: `PROJ-${id}`,
      title: `Issue ${id}`,
      status: "unresolved",
      type: "error",
      count: "1",
      userCount: 1,
      lastSeen: `2025-01-0${id}T00:00:00Z`,
      firstSeen: "2025-01-01T00:00:00Z",
      level: "error",
      platform: "javascript",
      project: { slug: "myproj" },
    });

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = req.url;

      // listOrganizations
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

      // getProject for each org
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

      // listIssues for org-one: Phase 1 returns 3 issues + cursor, Phase 2 returns 2 more
      if (url.includes("/organizations/org-one/issues/")) {
        const cursor = new URL(url).searchParams.get("cursor");
        if (cursor === "phase2-cursor:0:0") {
          // Phase 2 response
          return new Response(JSON.stringify([issue("4"), issue("5")]), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: '<https://sentry.io/api/0/>; rel="next"; results="false"; cursor="end:0:0"',
            },
          });
        }
        // Phase 1 response: 3 issues with next cursor
        return new Response(
          JSON.stringify([issue("1"), issue("2"), issue("3")]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: '<https://sentry.io/api/0/>; rel="next"; results="true"; cursor="phase2-cursor:0:0"',
            },
          }
        );
      }

      // listIssues for org-two: returns 1 issue, no more
      if (url.includes("/organizations/org-two/issues/")) {
        return new Response(JSON.stringify([issue("6")]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://sentry.io/api/0/>; rel="next"; results="false"; cursor="end:0:0"',
          },
        });
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context, stdout } = createContext();

    // project-search: finds "myproj" in both orgs, limit=6 triggers Phase 2
    await func.call(
      context,
      { limit: 6, sort: "date", period: parsePeriod("90d"), json: true },
      "myproj"
    );

    const output = JSON.parse(stdout.output);
    expect(output).toHaveProperty("data");
    expect(output).toHaveProperty("hasMore");

    // Should have issues from both orgs: 3 (Phase 1) + 2 (Phase 2) from org-one, 1 from org-two = 6
    expect(output.data.length).toBe(6);
    // hasMore should be false since we got exactly the limit
    expect(output.hasMore).toBe(false);
  });
});

describe("issue list: compound cursor resume", () => {
  // Tests the --cursor path in multi-target mode: resolves cursor from DB,
  // decodes compound cursor, skips exhausted targets, fetches from active ones.

  test("resumes from compound cursor, skipping exhausted targets", async () => {
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);

    // Mock resolveCursor to return the compound cursor that would have been
    // stored by a previous pagination run. The multi-target path uses this
    // cursor to resume fetching from the correct position.
    resolveCursorMock.mockReturnValue({
      cursor: "resume-cursor:0:0",
      direction: "next",
    });

    const issue = (id: string, proj: string) => ({
      id,
      shortId: `${proj.toUpperCase()}-${id}`,
      title: `Issue ${id}`,
      status: "unresolved",
      type: "error",
      count: "1",
      userCount: 1,
      lastSeen: "2025-01-01T00:00:00Z",
      firstSeen: "2025-01-01T00:00:00Z",
      level: "error",
      platform: "javascript",
      project: { slug: proj },
    });

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = req.url;

      // fetchProjectId enrichment for explicit target
      if (url.includes("/api/0/projects/test-org/proj-a/")) {
        return Response.json({
          id: "100",
          slug: "proj-a",
          name: "Proj A",
        });
      }

      // listIssues for proj-a: resumed from cursor
      if (url.includes("/organizations/test-org/issues/")) {
        const cursor = new URL(url).searchParams.get("cursor");
        expect(cursor).toBe("resume-cursor:0:0");
        return new Response(JSON.stringify([issue("10", "proj-a")]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://sentry.io/api/0/>; rel="next"; results="false"; cursor="end:0:0"',
          },
        });
      }

      // proj-b should NOT be fetched (exhausted)

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { context, stdout } = createContext();

    // Explicit mode with cursor="last" → resolves compound cursor from DB
    await func.call(
      context,
      {
        limit: 10,
        sort: "date",
        period: parsePeriod("90d"),
        json: true,
        cursor: "last",
      },
      "test-org/proj-a"
    );

    const output = JSON.parse(stdout.output);
    expect(output).toHaveProperty("data");
    // Should only have issues from proj-a (proj-b was exhausted)
    expect(output.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Collapse parameter optimization tests
// ---------------------------------------------------------------------------

describe("issue list: collapse parameter optimization", () => {
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

  function createOrgAllContext() {
    const stdoutWrite = vi.fn(() => true);
    const stderrWrite = vi.fn(() => true);
    return {
      context: {
        stdout: { write: stdoutWrite },
        stderr: { write: stderrWrite },
        cwd: "/tmp",
      },
      stdoutWrite,
    };
  }

  beforeEach(async () => {
    listIssuesAllPagesMock.mockReset();
    resolveCursorMock.mockReset();
    advancePaginationStateMock.mockReset();

    await setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  });

  test("always collapses filtered and unhandled in org-all mode", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: false },
      "my-org/"
    );

    expect(listIssuesAllPagesMock).toHaveBeenCalled();
    const callArgs = listIssuesAllPagesMock.mock.calls[0];
    const options = callArgs?.[2] as Record<string, unknown> | undefined;
    const collapse = options?.collapse as string[];
    expect(collapse).toContain("filtered");
    expect(collapse).toContain("unhandled");
  });

  test("does not collapse lifetime in human mode (needed for EVENTS/USERS/SEEN/AGE)", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: false },
      "my-org/"
    );

    expect(listIssuesAllPagesMock).toHaveBeenCalled();
    const callArgs = listIssuesAllPagesMock.mock.calls[0];
    const options = callArgs?.[2] as Record<string, unknown> | undefined;
    const collapse = options?.collapse as string[];
    expect(collapse).not.toContain("lifetime");
  });

  test("does not collapse lifetime in JSON mode without --fields", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: true },
      "my-org/"
    );

    expect(listIssuesAllPagesMock).toHaveBeenCalled();
    const callArgs = listIssuesAllPagesMock.mock.calls[0];
    const options = callArgs?.[2] as Record<string, unknown> | undefined;
    const collapse = options?.collapse as string[];
    expect(collapse).not.toContain("lifetime");
  });

  test("does not collapse lifetime in JSON mode when --fields includes lifetime-dependent field", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      {
        limit: 10,
        sort: "date",
        period: parsePeriod("90d"),
        json: true,
        fields: ["shortId", "title", "count"],
      },
      "my-org/"
    );

    expect(listIssuesAllPagesMock).toHaveBeenCalled();
    const callArgs = listIssuesAllPagesMock.mock.calls[0];
    const options = callArgs?.[2] as Record<string, unknown> | undefined;
    const collapse = options?.collapse as string[];
    expect(collapse).not.toContain("lifetime");
  });

  test("collapses lifetime in JSON mode when --fields omits all lifetime-dependent fields", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      {
        limit: 10,
        sort: "date",
        period: parsePeriod("90d"),
        json: true,
        fields: ["shortId", "title"],
      },
      "my-org/"
    );

    expect(listIssuesAllPagesMock).toHaveBeenCalled();
    const callArgs = listIssuesAllPagesMock.mock.calls[0];
    const options = callArgs?.[2] as Record<string, unknown> | undefined;
    const collapse = options?.collapse as string[];
    expect(collapse).toContain("lifetime");
  });

  test("collapses stats in JSON mode", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: true },
      "my-org/"
    );

    expect(listIssuesAllPagesMock).toHaveBeenCalled();
    const callArgs = listIssuesAllPagesMock.mock.calls[0];
    const options = callArgs?.[2] as Record<string, unknown> | undefined;
    const collapse = options?.collapse as string[];
    expect(collapse).toContain("stats");
  });

  test("omits groupStatsPeriod when stats are collapsed (JSON mode)", async () => {
    listIssuesAllPagesMock.mockResolvedValue({
      issues: [sampleIssue],
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
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: true },
      "my-org/"
    );

    expect(listIssuesAllPagesMock).toHaveBeenCalled();
    const callArgs = listIssuesAllPagesMock.mock.calls[0];
    const options = callArgs?.[2] as Record<string, unknown> | undefined;
    expect(options?.groupStatsPeriod).toBeUndefined();
  });
});

describe("issue list: multi-target cursor-safe budget", () => {
  const findProjectsBySlugMock = vi.mocked(projectsApi.findProjectsBySlug);

  function mockThreeProjectSearch() {
    findProjectsBySlugMock.mockResolvedValue({
      projects: [
        { id: "1", slug: "myproj", name: "My Project", orgSlug: "org-one" },
        { id: "2", slug: "myproj", name: "My Project", orgSlug: "org-two" },
        {
          id: "3",
          slug: "myproj",
          name: "My Project",
          orgSlug: "org-three",
        },
      ],
      orgs: [],
    });
  }

  function issue(org: string, index: number) {
    return mockIssue({
      id: `${org}-${index}`,
      shortId: `${org.toUpperCase()}-${index}`,
      project: { slug: "myproj" },
    });
  }

  beforeEach(() => {
    listIssuesAllPagesMock.mockReset();
    resolveCursorMock.mockReset();
    advancePaginationStateMock.mockReset();
    findProjectsBySlugMock.mockReset();
    resolveCursorMock.mockReturnValue({
      cursor: undefined,
      direction: "first",
    });
  });

  test("distributes multi-project budget exactly without over-fetching", async () => {
    mockThreeProjectSearch();
    const limitByOrg = new Map<string, number>();
    listIssuesAllPagesMock.mockImplementation(
      async (org, _project, options) => {
        const limit = Number(options.limit);
        limitByOrg.set(org, limit);
        return {
          issues: Array.from({ length: limit }, (_, i) => issue(org, i + 1)),
          nextCursor: `${org}-next:0:0`,
        };
      }
    );

    const { context, stdout } = createContext();
    await func.call(
      context,
      { limit: 10, sort: "date", period: parsePeriod("90d"), json: true },
      "myproj"
    );

    const output = JSON.parse(stdout.output);
    expect(output.data).toHaveLength(10);
    expect(Object.fromEntries(limitByOrg)).toEqual({
      "org-one": 4,
      "org-two": 3,
      "org-three": 3,
    });
  });

  test("does not save a next cursor when fetched rows were trimmed", async () => {
    mockThreeProjectSearch();
    listIssuesAllPagesMock.mockImplementation(
      async (org, _project, options) => {
        const limit = Number(options.limit);
        return {
          issues: Array.from({ length: limit }, (_, i) => issue(org, i + 1)),
          nextCursor: `${org}-next:0:0`,
        };
      }
    );

    const { context, stdout } = createContext();
    await func.call(
      context,
      { limit: 2, sort: "date", period: parsePeriod("90d"), json: true },
      "myproj"
    );

    const output = JSON.parse(stdout.output);
    expect(output.data).toHaveLength(2);
    expect(output.hasMore).toBe(true);
    expect(advancePaginationStateMock).toHaveBeenCalledWith(
      "issue-list",
      expect.any(String),
      "first",
      undefined
    );
  });
});

// ---------------------------------------------------------------------------
// getComparator — sort comparator with null-safe date coercion
// ---------------------------------------------------------------------------

import { __testing } from "../../../src/commands/issue/list.js";

const { getComparator } = __testing;

import type { SentryIssue } from "../../../src/types/index.js";

function makeIssue(overrides: Partial<SentryIssue> = {}): SentryIssue {
  return {
    id: "1",
    shortId: "TEST-1",
    title: "Test",
    status: "unresolved",
    level: "error",
    count: "10",
    userCount: 1,
    firstSeen: "2024-01-01T00:00:00Z",
    lastSeen: "2024-01-02T00:00:00Z",
    permalink: "https://sentry.io/issues/1",
    ...overrides,
  };
}

describe("getComparator", () => {
  test("sort=new compares by firstSeen with null safety", () => {
    const cmp = getComparator("new");
    const older = makeIssue({ firstSeen: "2024-01-01T00:00:00Z" });
    const newer = makeIssue({ firstSeen: "2024-01-02T00:00:00Z" });
    expect(cmp(newer, older)).toBeLessThan(0);
    expect(cmp(older, newer)).toBeGreaterThan(0);
  });

  test("sort=new handles null firstSeen", () => {
    const cmp = getComparator("new");
    const nullDate = makeIssue({ firstSeen: null as unknown as string });
    const withDate = makeIssue({ firstSeen: "2024-01-01T00:00:00Z" });
    // should not throw
    expect(() => cmp(nullDate, withDate)).not.toThrow();
  });

  test("sort=date handles null lastSeen (covers ?? null branch)", () => {
    const cmp = getComparator("date");
    const nullDate = makeIssue({ lastSeen: null as unknown as string });
    const withDate = makeIssue({ lastSeen: "2024-01-01T00:00:00Z" });
    expect(cmp(nullDate, withDate)).not.toBe(undefined);
  });

  test("sort=new handles null firstSeen (covers ?? null branch)", () => {
    const cmp = getComparator("new");
    const nullDate = makeIssue({ firstSeen: null as unknown as string });
    const withDate = makeIssue({ firstSeen: "2024-01-01T00:00:00Z" });
    expect(cmp(nullDate, withDate)).not.toBe(undefined);
  });

  test("unknown sort value hits default branch (falls back to lastSeen)", () => {
    // A value not in the switch exercises the default: compareDates(lastSeen) case
    const cmp = getComparator("unknown_sort" as unknown as "date");
    const older = makeIssue({ lastSeen: "2024-01-01T00:00:00Z" });
    const newer = makeIssue({ lastSeen: "2024-01-02T00:00:00Z" });
    expect(cmp(newer, older)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// sanitizeQuery — tests moved to test/lib/search-query.test.ts
// ---------------------------------------------------------------------------
