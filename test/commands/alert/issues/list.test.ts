import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  __testing,
  listCommand,
} from "../../../../src/commands/alert/issues/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../../src/lib/browser.js";
import { DEFAULT_SENTRY_URL } from "../../../../src/lib/constants.js";
import { setAuthToken } from "../../../../src/lib/db/auth.js";
import {
  setDefaultOrganization,
  setDefaultProject,
} from "../../../../src/lib/db/defaults.js";
import { setOrgRegion } from "../../../../src/lib/db/regions.js";
import { logger } from "../../../../src/lib/logger.js";
import { mockFetch, useTestConfigDir } from "../../../helpers.js";

const getConfigDir = useTestConfigDir("test-alert-issues-list-", {
  isolateProjectRoot: true,
});

type ListFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly json: boolean;
  readonly fields?: string[];
  readonly query?: string;
};

type ListFunc = (
  this: unknown,
  flags: ListFlags,
  target?: string
) => Promise<void>;

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
  return {
    context: {
      process,
      stdout,
      stderr,
      cwd: getConfigDir(),
    },
    stdout,
  };
}

describe("alert issues list pagination", () => {
  let func: ListFunc;
  let openInBrowserSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    func = (await listCommand.loader()) as unknown as ListFunc;
    await setAuthToken("test-token");
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);
    setDefaultOrganization("test-org");
    setDefaultProject("test-project");
    openInBrowserSpy = vi.spyOn(browser, "openInBrowser");
    warnSpy = vi.spyOn(logger, "warn");
    openInBrowserSpy.mockResolvedValue(undefined);
    warnSpy.mockImplementation(() => {
      // Suppress expected partial-failure warnings in behavior tests.
    });
  });

  afterEach(() => {
    openInBrowserSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("hasMore is false when limit is reached without next cursor", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/projects/test-org/test-project/rules/")) {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              name: "Rule Alpha",
              status: "active",
              actionMatch: "any",
              conditions: [],
              actions: [],
              frequency: 30,
              environment: null,
              owner: null,
              projects: ["test-project"],
              dateCreated: "2026-01-01T00:00:00Z",
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: '<https://sentry.io/api/0/>; rel="next"; results="false"; cursor="0:0:0"',
            },
          }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    });

    const { context, stdout } = createContext();
    await func.call(context, {
      web: false,
      fresh: false,
      limit: 1,
      json: true,
    });

    const parsed = JSON.parse(stdout.output);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.data).toHaveLength(1);
  });

  test("empty query page keeps hasMore when next cursor exists", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/projects/test-org/test-project/rules/")) {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              name: "Rule Alpha",
              status: "active",
              actionMatch: "any",
              conditions: [],
              actions: [],
              frequency: 30,
              environment: null,
              owner: null,
              projects: ["test-project"],
              dateCreated: "2026-01-01T00:00:00Z",
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: '<https://sentry.io/api/0/>; rel="next"; results="true"; cursor="next:0:0"',
            },
          }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    });

    const { context, stdout } = createContext();
    await func.call(context, {
      web: false,
      fresh: false,
      limit: 1,
      json: true,
      query: "zzz",
    });

    const parsed = JSON.parse(stdout.output);
    expect(parsed.data).toEqual([]);
    expect(parsed.hasMore).toBe(true);
  });

  test("--web with explicit target opens browser without fetching rules", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("fetch should not be called for explicit --web");
    });

    const { context } = createContext();
    await func.call(
      context,
      {
        web: true,
        fresh: false,
        limit: 30,
        json: false,
      },
      "test-org/test-project"
    );

    expect(openInBrowserSpy).toHaveBeenCalledWith(
      expect.stringContaining("test-org"),
      "issue alert rules"
    );
    expect(openInBrowserSpy).toHaveBeenCalledWith(
      expect.stringContaining("test-project"),
      "issue alert rules"
    );
  });

  test("human output includes project column for multi-project results", async () => {
    setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    setOrgRegion("org-two", DEFAULT_SENTRY_URL);

    const rule = (org: string) => ({
      id: `${org}-1`,
      name: `${org} Rule`,
      status: org === "org-one" ? "active" : "disabled",
      actionMatch: "any",
      conditions: [{ id: "condition-a" }],
      actions: [{ id: "action-a" }],
      frequency: 30,
      environment: "prod",
      owner: null,
      projects: ["myproj"],
      dateCreated: "2026-01-01T00:00:00Z",
    });

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const ruleMatch = url.pathname.match(
        /\/api\/0\/projects\/([^/]+)\/myproj\/rules\//
      );
      if (ruleMatch) {
        return Response.json([rule(ruleMatch[1] as string)]);
      }
      if (url.pathname === "/api/0/organizations/") {
        return Response.json([
          { slug: "org-one", name: "Org One" },
          { slug: "org-two", name: "Org Two" },
        ]);
      }
      const projectMatch = url.pathname.match(
        /\/api\/0\/projects\/([^/]+)\/myproj\//
      );
      if (projectMatch) {
        const org = projectMatch[1] as string;
        return Response.json({
          id: `${org}-id`,
          slug: "myproj",
          name: "My Project",
        });
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    });

    const { context, stdout } = createContext();
    await func.call(
      context,
      {
        web: false,
        fresh: false,
        limit: 10,
        json: false,
      },
      "myproj"
    );

    expect(stdout.output).toContain("Issue alert rules from 2 projects:");
    expect(stdout.output).toContain("PROJECT");
    expect(stdout.output).toContain("org-one");
    expect(stdout.output).toContain("org-two");
    expect(stdout.output).toContain("myproj");
    expect(stdout.output).toContain("Rule");
    expect(stdout.output).toContain("prod");
  });

  test("partial project failure warns and still returns successful issue rules", async () => {
    setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    setOrgRegion("org-two", DEFAULT_SENTRY_URL);

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const ruleMatch = url.pathname.match(
        /\/api\/0\/projects\/([^/]+)\/myproj\/rules\//
      );
      if (ruleMatch) {
        const org = ruleMatch[1] as string;
        if (org === "org-two") {
          return new Response(JSON.stringify({ detail: "boom" }), {
            status: 500,
          });
        }
        return Response.json([
          {
            id: "ok-1",
            name: "Surviving Rule",
            status: "active",
            actionMatch: "any",
            conditions: [],
            actions: [],
            frequency: 30,
            environment: null,
            owner: null,
            projects: ["myproj"],
            dateCreated: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      if (url.pathname === "/api/0/organizations/") {
        return Response.json([
          { slug: "org-one", name: "Org One" },
          { slug: "org-two", name: "Org Two" },
        ]);
      }
      const projectMatch = url.pathname.match(
        /\/api\/0\/projects\/([^/]+)\/myproj\//
      );
      if (projectMatch) {
        const org = projectMatch[1] as string;
        return Response.json({
          id: `${org}-id`,
          slug: "myproj",
          name: "My Project",
        });
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    });

    const { context, stdout } = createContext();
    await func.call(
      context,
      {
        web: false,
        fresh: false,
        limit: 10,
        json: true,
      },
      "myproj"
    );

    const parsed = JSON.parse(stdout.output);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].name).toBe("Surviving Rule");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to fetch alert rules from org-two/myproj")
    );
  });

  test("distributes multi-project budget exactly without over-fetching", async () => {
    setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    setOrgRegion("org-two", DEFAULT_SENTRY_URL);
    setOrgRegion("org-three", DEFAULT_SENTRY_URL);
    const perPageByOrg = new Map<string, number>();

    const rule = (org: string, index: number) => ({
      id: `${org}-${index}`,
      name: `${org} Rule ${index}`,
      status: "active",
      actionMatch: "any",
      conditions: [],
      actions: [],
      frequency: 30,
      environment: null,
      owner: null,
      projects: ["myproj"],
      dateCreated: "2026-01-01T00:00:00Z",
    });

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const ruleMatch = url.pathname.match(
        /\/api\/0\/projects\/([^/]+)\/myproj\/rules\//
      );
      if (ruleMatch) {
        const org = ruleMatch[1] as string;
        const perPage = Number(url.searchParams.get("per_page"));
        perPageByOrg.set(org, perPage);
        return new Response(
          JSON.stringify(
            Array.from({ length: perPage }, (_, i) => rule(org, i + 1))
          ),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: `<https://sentry.io/api/0/>; rel="next"; results="true"; cursor="${org}-next:0:0"`,
            },
          }
        );
      }

      if (url.pathname === "/api/0/organizations/") {
        return Response.json([
          { slug: "org-one", name: "Org One" },
          { slug: "org-two", name: "Org Two" },
          { slug: "org-three", name: "Org Three" },
        ]);
      }

      const projectMatch = url.pathname.match(
        /\/api\/0\/projects\/([^/]+)\/myproj\//
      );
      if (projectMatch) {
        const org = projectMatch[1] as string;
        return Response.json({
          id: `${org}-id`,
          slug: "myproj",
          name: "My Project",
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    });

    const { context, stdout } = createContext();
    await func.call(
      context,
      {
        web: false,
        fresh: false,
        limit: 10,
        json: true,
      },
      "myproj"
    );

    const parsed = JSON.parse(stdout.output);
    expect(parsed.data).toHaveLength(10);
    expect(Object.fromEntries(perPageByOrg)).toEqual({
      "org-one": 4,
      "org-two": 3,
      "org-three": 3,
    });
  });
});

/**
 * `phase1HasMore` is shared (same `some(success && hasMore)` logic) in metrics list;
 * unit tests live here only to avoid duplicating the same cases across both files.
 */
describe("alert issues list __testing", () => {
  const { phase1HasMore } = __testing;
  const sampleTarget = {
    org: "a",
    project: "b",
    orgDisplay: "a",
    projectDisplay: "b",
  };

  test("phase1HasMore: OR of per-target hasMore, ignores failed fetches", () => {
    const success = (hasMore: boolean) => ({
      success: true as const,
      data: { hasMore, rules: [] as const, target: sampleTarget },
    });
    expect(phase1HasMore([success(false), success(true)])).toBe(true);
    expect(phase1HasMore([success(false), success(false)])).toBe(false);
    expect(
      phase1HasMore([
        { success: false, error: new Error("nope") },
        success(true),
      ])
    ).toBe(true);
  });
});
