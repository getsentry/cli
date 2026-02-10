/**
 * Unit Tests for Project List Command
 *
 * Tests the exported helper functions and handler functions.
 * Handlers are tested with fetch mocking for API isolation.
 */

// biome-ignore-all lint/suspicious/noMisplacedAssertion: Property tests use expect() inside fast-check callbacks.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  array,
  constantFrom,
  assert as fcAssert,
  property,
  tuple,
} from "fast-check";
import {
  buildContextKey,
  filterByPlatform,
  handleExplicit,
  handleOrgAll,
  handleProjectSearch,
  PAGINATION_KEY,
  resolveCursor,
  writeHeader,
  writeRows,
  writeSelfHostedWarning,
} from "../../../src/commands/project/list.js";
import type { ParsedOrgProject } from "../../../src/lib/arg-parsing.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { CONFIG_DIR_ENV_VAR } from "../../../src/lib/db/index.js";
import {
  getPaginationCursor,
  setPaginationCursor,
} from "../../../src/lib/db/pagination.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { ContextError } from "../../../src/lib/errors.js";
import type { SentryProject, Writer } from "../../../src/types/index.js";
import { cleanupTestDir, createTestConfigDir } from "../../helpers.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

// Test config directory for DB-dependent tests
let testConfigDir: string;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-project-list-", {
    isolateProjectRoot: true,
  });
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

/** Capture stdout writes */
function createCapture(): { writer: Writer; output: () => string } {
  const chunks: string[] = [];
  return {
    writer: {
      write: (s: string) => {
        chunks.push(s);
        return true;
      },
    } as Writer,
    output: () => chunks.join(""),
  };
}

/** Create a minimal project for testing */
function makeProject(
  overrides: Partial<SentryProject> & { orgSlug?: string } = {}
): SentryProject & { orgSlug?: string } {
  return {
    id: "1",
    slug: "test-project",
    name: "Test Project",
    platform: "javascript",
    dateCreated: "2024-01-01T00:00:00Z",
    status: "active",
    ...overrides,
  };
}

// Arbitraries

const slugArb = array(
  constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
  {
    minLength: 1,
    maxLength: 12,
  }
).map((chars) => chars.join(""));

const platformArb = constantFrom(
  "javascript",
  "python",
  "go",
  "java",
  "ruby",
  "php",
  "javascript-react",
  "python-django"
);

// Tests

describe("buildContextKey", () => {
  test("org-all mode produces org: prefix", () => {
    fcAssert(
      property(slugArb, (org) => {
        const parsed: ParsedOrgProject = { type: "org-all", org };
        const key = buildContextKey(parsed, {});
        expect(key).toBe(`org:${org}`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("auto-detect mode produces 'auto'", () => {
    const parsed: ParsedOrgProject = { type: "auto-detect" };
    expect(buildContextKey(parsed, {})).toBe("auto");
  });

  test("explicit mode produces type:explicit", () => {
    fcAssert(
      property(tuple(slugArb, slugArb), ([org, project]) => {
        const parsed: ParsedOrgProject = { type: "explicit", org, project };
        const key = buildContextKey(parsed, {});
        expect(key).toBe("type:explicit");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("project-search mode produces type:project-search", () => {
    fcAssert(
      property(slugArb, (projectSlug) => {
        const parsed: ParsedOrgProject = {
          type: "project-search",
          projectSlug,
        };
        const key = buildContextKey(parsed, {});
        expect(key).toBe("type:project-search");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("platform flag is appended with pipe separator", () => {
    fcAssert(
      property(tuple(slugArb, platformArb), ([org, platform]) => {
        const parsed: ParsedOrgProject = { type: "org-all", org };
        const key = buildContextKey(parsed, { platform });
        expect(key).toBe(`org:${org}|platform:${platform}`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("no platform flag means no pipe in key", () => {
    fcAssert(
      property(slugArb, (org) => {
        const parsed: ParsedOrgProject = { type: "org-all", org };
        const key = buildContextKey(parsed, {});
        expect(key).not.toContain("|");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("filterByPlatform", () => {
  test("no platform returns all projects", () => {
    const projects = [
      makeProject({ platform: "javascript" }),
      makeProject({ platform: "python" }),
    ];
    expect(filterByPlatform(projects)).toHaveLength(2);
    expect(filterByPlatform(projects, undefined)).toHaveLength(2);
  });

  test("case-insensitive partial match", () => {
    const projects = [
      makeProject({ slug: "web", platform: "javascript-react" }),
      makeProject({ slug: "api", platform: "python-django" }),
      makeProject({ slug: "cli", platform: "javascript" }),
    ];

    // Partial match
    expect(filterByPlatform(projects, "javascript")).toHaveLength(2);
    expect(filterByPlatform(projects, "python")).toHaveLength(1);

    // Case-insensitive
    expect(filterByPlatform(projects, "JAVASCRIPT")).toHaveLength(2);
    expect(filterByPlatform(projects, "Python")).toHaveLength(1);
  });

  test("no match returns empty array", () => {
    const projects = [makeProject({ platform: "javascript" })];
    expect(filterByPlatform(projects, "rust")).toHaveLength(0);
  });

  test("null platform in project is not matched", () => {
    const projects = [makeProject({ platform: null as unknown as string })];
    expect(filterByPlatform(projects, "javascript")).toHaveLength(0);
  });

  test("property: filtering is idempotent", () => {
    fcAssert(
      property(platformArb, (platform) => {
        const projects = [
          makeProject({ slug: "a", platform: "javascript-react" }),
          makeProject({ slug: "b", platform: "python-django" }),
          makeProject({ slug: "c", platform: "go" }),
        ];
        const once = filterByPlatform(projects, platform);
        const twice = filterByPlatform(once, platform);
        expect(twice).toEqual(once);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("property: filtered result is subset of input", () => {
    fcAssert(
      property(platformArb, (platform) => {
        const projects = [
          makeProject({ slug: "a", platform: "javascript" }),
          makeProject({ slug: "b", platform: "python" }),
          makeProject({ slug: "c", platform: "go" }),
        ];
        const filtered = filterByPlatform(projects, platform);
        expect(filtered.length).toBeLessThanOrEqual(projects.length);
        for (const p of filtered) {
          expect(projects).toContain(p);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("resolveCursor", () => {
  test("undefined cursor returns undefined", () => {
    expect(resolveCursor(undefined, "org:sentry")).toBeUndefined();
  });

  test("explicit cursor value is passed through", () => {
    expect(resolveCursor("1735689600000:100:0", "org:sentry")).toBe(
      "1735689600000:100:0"
    );
  });

  test("'last' with no cached cursor throws ContextError", () => {
    expect(() => resolveCursor("last", "org:sentry")).toThrow(ContextError);
    expect(() => resolveCursor("last", "org:sentry")).toThrow(
      /No saved cursor/
    );
  });

  test("'last' with cached cursor returns the cached value", () => {
    const cursor = "1735689600000:100:0";
    const contextKey = "org:test-resolve";
    setPaginationCursor(PAGINATION_KEY, contextKey, cursor, 300_000);

    const result = resolveCursor("last", contextKey);
    expect(result).toBe(cursor);
  });

  test("'last' with expired cursor throws ContextError", () => {
    const contextKey = "org:test-expired";
    setPaginationCursor(PAGINATION_KEY, contextKey, "old-cursor", -1000);

    expect(() => resolveCursor("last", contextKey)).toThrow(ContextError);
  });
});

describe("writeHeader", () => {
  test("writes formatted header line", () => {
    const { writer, output } = createCapture();
    writeHeader(writer, 10, 15, 20);
    const line = output();
    expect(line).toContain("ORG");
    expect(line).toContain("PROJECT");
    expect(line).toContain("NAME");
    expect(line).toContain("PLATFORM");
    expect(line).toEndWith("\n");
  });

  test("respects column widths", () => {
    const { writer, output } = createCapture();
    writeHeader(writer, 5, 10, 8);
    const line = output();
    // "ORG" padded to 5, "PROJECT" padded to 10, "NAME" padded to 8
    expect(line).toMatch(/^ORG\s{2}\s+PROJECT\s+NAME\s+PLATFORM\n$/);
  });
});

describe("writeRows", () => {
  test("writes one line per project", () => {
    const { writer, output } = createCapture();
    const projects = [
      makeProject({
        slug: "proj-a",
        name: "Project A",
        platform: "javascript",
        orgSlug: "org1",
      }),
      makeProject({
        slug: "proj-b",
        name: "Project B",
        platform: "python",
        orgSlug: "org2",
      }),
    ];
    writeRows({
      stdout: writer,
      projects,
      orgWidth: 10,
      slugWidth: 15,
      nameWidth: 20,
    });
    const lines = output().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("writeSelfHostedWarning", () => {
  test("writes nothing when skippedSelfHosted is undefined", () => {
    const { writer, output } = createCapture();
    writeSelfHostedWarning(writer, undefined);
    expect(output()).toBe("");
  });

  test("writes nothing when skippedSelfHosted is 0", () => {
    const { writer, output } = createCapture();
    writeSelfHostedWarning(writer, 0);
    expect(output()).toBe("");
  });

  test("writes warning when skippedSelfHosted > 0", () => {
    const { writer, output } = createCapture();
    writeSelfHostedWarning(writer, 3);
    const text = output();
    expect(text).toContain("3 DSN(s)");
    expect(text).toContain("could not be resolved");
  });
});

// Handler tests with fetch mocking

let originalFetch: typeof globalThis.fetch;

/** Create a mock fetch for project API calls */
function mockProjectFetch(
  projects: SentryProject[],
  options: { hasMore?: boolean; nextCursor?: string } = {}
): typeof globalThis.fetch {
  const { hasMore = false, nextCursor } = options;
  // @ts-expect-error - partial mock
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = req.url;

    // getProject (single project fetch via /projects/{org}/{slug}/)
    if (url.match(/\/projects\/[^/]+\/[^/]+\//)) {
      if (projects.length > 0) {
        return new Response(JSON.stringify(projects[0]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    }

    // listProjects / listProjectsPaginated (via /organizations/{org}/projects/)
    if (url.includes("/projects/")) {
      const linkParts: string[] = [
        `<${url}>; rel="previous"; results="false"; cursor="0:0:1"`,
      ];
      if (hasMore && nextCursor) {
        linkParts.push(
          `<${url}>; rel="next"; results="true"; cursor="${nextCursor}"`
        );
      } else {
        linkParts.push(`<${url}>; rel="next"; results="false"; cursor="0:0:0"`);
      }
      return new Response(JSON.stringify(projects), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: linkParts.join(", "),
        },
      });
    }

    // listOrganizations
    if (
      url.includes("/organizations/") &&
      !url.includes("/projects/") &&
      !url.includes("/issues/")
    ) {
      return new Response(
        JSON.stringify([{ id: "1", slug: "test-org", name: "Test Org" }]),
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
}

const sampleProjects: SentryProject[] = [
  {
    id: "1",
    slug: "frontend",
    name: "Frontend",
    platform: "javascript",
    dateCreated: "2024-01-01T00:00:00Z",
    status: "active",
  },
  {
    id: "2",
    slug: "backend",
    name: "Backend",
    platform: "python",
    dateCreated: "2024-01-01T00:00:00Z",
    status: "active",
  },
];

describe("handleExplicit", () => {
  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    await setAuthToken("test-token");
    await setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("displays single project", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects);
    const { writer, output } = createCapture();

    await handleExplicit(writer, "test-org", "frontend", {
      limit: 30,
      json: false,
    });

    const text = output();
    expect(text).toContain("ORG");
    expect(text).toContain("frontend");
  });

  test("--json outputs JSON array", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects);
    const { writer, output } = createCapture();

    await handleExplicit(writer, "test-org", "frontend", {
      limit: 30,
      json: true,
    });

    const parsed = JSON.parse(output());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  test("not found shows message", async () => {
    globalThis.fetch = mockProjectFetch([]);
    const { writer, output } = createCapture();

    await handleExplicit(writer, "test-org", "nonexistent", {
      limit: 30,
      json: false,
    });

    const text = output();
    expect(text).toContain("No project");
    expect(text).toContain("nonexistent");
    expect(text).toContain("Tip:");
  });

  test("not found with --json outputs empty array", async () => {
    globalThis.fetch = mockProjectFetch([]);
    const { writer, output } = createCapture();

    await handleExplicit(writer, "test-org", "nonexistent", {
      limit: 30,
      json: true,
    });

    const parsed = JSON.parse(output());
    expect(parsed).toHaveLength(0);
  });

  test("platform filter with no match shows message", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects);
    const { writer, output } = createCapture();

    await handleExplicit(writer, "test-org", "frontend", {
      limit: 30,
      json: false,
      platform: "ruby",
    });

    const text = output();
    expect(text).toContain("No project");
    expect(text).toContain("platform");
  });

  test("platform filter match shows project", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects);
    const { writer, output } = createCapture();

    await handleExplicit(writer, "test-org", "frontend", {
      limit: 30,
      json: false,
      platform: "javascript",
    });

    const text = output();
    expect(text).toContain("frontend");
    expect(text).toContain("ORG");
  });
});

describe("handleOrgAll", () => {
  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    await setAuthToken("test-token");
    await setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("displays paginated project list", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects);
    const { writer, output } = createCapture();

    await handleOrgAll({
      stdout: writer,
      org: "test-org",
      flags: { limit: 30, json: false },
      contextKey: "org:test-org",
      cursor: undefined,
    });

    const text = output();
    expect(text).toContain("ORG");
    expect(text).toContain("frontend");
    expect(text).toContain("backend");
    expect(text).toContain("Showing 2 projects");
  });

  test("--json with hasMore includes nextCursor", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects, {
      hasMore: true,
      nextCursor: "1735689600000:100:0",
    });
    const { writer, output } = createCapture();

    await handleOrgAll({
      stdout: writer,
      org: "test-org",
      flags: { limit: 30, json: true },
      contextKey: "org:test-org",
      cursor: undefined,
    });

    const parsed = JSON.parse(output());
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextCursor).toBe("1735689600000:100:0");
    expect(parsed.data).toHaveLength(2);
  });

  test("--json without hasMore shows hasMore: false", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects);
    const { writer, output } = createCapture();

    await handleOrgAll({
      stdout: writer,
      org: "test-org",
      flags: { limit: 30, json: true },
      contextKey: "org:test-org",
      cursor: undefined,
    });

    const parsed = JSON.parse(output());
    expect(parsed.hasMore).toBe(false);
    expect(parsed.data).toHaveLength(2);
  });

  test("hasMore saves cursor for --cursor last", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects, {
      hasMore: true,
      nextCursor: "1735689600000:100:0",
    });
    const { writer } = createCapture();

    await handleOrgAll({
      stdout: writer,
      org: "test-org",
      flags: { limit: 30, json: false },
      contextKey: "org:test-org",
      cursor: undefined,
    });

    const cached = getPaginationCursor(PAGINATION_KEY, "org:test-org");
    expect(cached).toBe("1735689600000:100:0");
  });

  test("no hasMore clears cached cursor", async () => {
    setPaginationCursor(PAGINATION_KEY, "org:test-org", "old-cursor", 300_000);

    globalThis.fetch = mockProjectFetch(sampleProjects);
    const { writer } = createCapture();

    await handleOrgAll({
      stdout: writer,
      org: "test-org",
      flags: { limit: 30, json: false },
      contextKey: "org:test-org",
      cursor: undefined,
    });

    const cached = getPaginationCursor(PAGINATION_KEY, "org:test-org");
    expect(cached).toBeUndefined();
  });

  test("empty page with hasMore suggests next page", async () => {
    globalThis.fetch = mockProjectFetch([], {
      hasMore: true,
      nextCursor: "1735689600000:100:0",
    });
    const { writer, output } = createCapture();

    await handleOrgAll({
      stdout: writer,
      org: "test-org",
      flags: { limit: 30, json: false, platform: "rust" },
      contextKey: "org:test-org",
      cursor: undefined,
    });

    const text = output();
    expect(text).toContain("No matching projects on this page");
    expect(text).toContain("-c last");
  });

  test("empty page without hasMore shows no projects", async () => {
    globalThis.fetch = mockProjectFetch([]);
    const { writer, output } = createCapture();

    await handleOrgAll({
      stdout: writer,
      org: "test-org",
      flags: { limit: 30, json: false },
      contextKey: "org:test-org",
      cursor: undefined,
    });

    const text = output();
    expect(text).toContain("No projects found");
  });

  test("hasMore shows next page hint", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects, {
      hasMore: true,
      nextCursor: "1735689600000:100:0",
    });
    const { writer, output } = createCapture();

    await handleOrgAll({
      stdout: writer,
      org: "test-org",
      flags: { limit: 30, json: false },
      contextKey: "org:test-org",
      cursor: undefined,
    });

    const text = output();
    expect(text).toContain("more available");
    expect(text).toContain("-c last");
  });
});

describe("handleProjectSearch", () => {
  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    await setAuthToken("test-token");
    await setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("finds project across orgs", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects);
    const { writer, output } = createCapture();

    await handleProjectSearch(writer, "frontend", {
      limit: 30,
      json: false,
    });

    const text = output();
    expect(text).toContain("frontend");
  });

  test("--json outputs JSON array", async () => {
    globalThis.fetch = mockProjectFetch(sampleProjects);
    const { writer, output } = createCapture();

    await handleProjectSearch(writer, "frontend", {
      limit: 30,
      json: true,
    });

    const parsed = JSON.parse(output());
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("not found throws ContextError", async () => {
    // Mock returning empty projects
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("/organizations/") && !url.includes("/projects/")) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "test-org", name: "Test Org" }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (url.includes("/projects/")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<url>; rel="next"; results="false"; cursor="0:0:0"',
          },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const { writer } = createCapture();

    await expect(
      handleProjectSearch(writer, "nonexistent", {
        limit: 30,
        json: false,
      })
    ).rejects.toThrow(ContextError);
  });

  test("not found with --json outputs empty array", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("/organizations/") && !url.includes("/projects/")) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "test-org", name: "Test Org" }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (url.includes("/projects/")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<url>; rel="next"; results="false"; cursor="0:0:0"',
          },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const { writer, output } = createCapture();

    await handleProjectSearch(writer, "nonexistent", {
      limit: 30,
      json: true,
    });

    const parsed = JSON.parse(output());
    expect(parsed).toHaveLength(0);
  });

  test("multiple results shows count", async () => {
    globalThis.fetch = mockProjectFetch([...sampleProjects, ...sampleProjects]);
    const { writer, output } = createCapture();

    await handleProjectSearch(writer, "frontend", {
      limit: 30,
      json: false,
    });

    const text = output();
    expect(text).toContain("frontend");
  });
});
