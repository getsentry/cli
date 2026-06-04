import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listCommand } from "../../../../src/commands/alert/metrics/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../../src/lib/browser.js";
import { DEFAULT_SENTRY_URL } from "../../../../src/lib/constants.js";
import { setAuthToken } from "../../../../src/lib/db/auth.js";
import { setOrgRegion } from "../../../../src/lib/db/regions.js";
import { logger } from "../../../../src/lib/logger.js";
import { mockFetch, useTestConfigDir } from "../../../helpers.js";

const getConfigDir = useTestConfigDir("test-alert-metrics-list-", {
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

describe("alert metrics list pagination", () => {
  let func: ListFunc;
  let openInBrowserSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    func = (await listCommand.loader()) as unknown as ListFunc;
    await setAuthToken("test-token");
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);
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
      if (req.url.includes("/organizations/test-org/alert-rules/")) {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              name: "Metric Rule Alpha",
              status: 0,
              query: "event.type:error",
              aggregate: "count()",
              dataset: "errors",
              timeWindow: 5,
              environment: null,
              owner: null,
              projects: [],
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
    await func.call(
      context,
      {
        web: false,
        fresh: false,
        limit: 1,
        json: true,
      },
      "test-org/"
    );

    const parsed = JSON.parse(stdout.output);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.data).toHaveLength(1);
  });

  test("empty query page keeps hasMore when next cursor exists", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/organizations/test-org/alert-rules/")) {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              name: "Metric Rule Alpha",
              status: 0,
              query: "event.type:error",
              aggregate: "count()",
              dataset: "errors",
              timeWindow: 5,
              environment: null,
              owner: null,
              projects: [],
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
    await func.call(
      context,
      {
        web: false,
        fresh: false,
        limit: 1,
        json: true,
        query: "zzz",
      },
      "test-org/"
    );

    const parsed = JSON.parse(stdout.output);
    expect(parsed.data).toEqual([]);
    expect(parsed.hasMore).toBe(true);
  });

  test("--web with explicit org opens browser without fetching rules", async () => {
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
      "test-org/"
    );

    expect(openInBrowserSpy).toHaveBeenCalledWith(
      expect.stringContaining("test-org"),
      "metric alert rules"
    );
  });

  test("human output includes org column for multi-org project-search results", async () => {
    setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    setOrgRegion("org-two", DEFAULT_SENTRY_URL);

    const rule = (org: string) => ({
      id: `${org}-1`,
      name: `${org} Metric Rule`,
      status: org === "org-one" ? 0 : 1,
      query: "event.type:error",
      aggregate: "count()",
      dataset: "errors",
      timeWindow: 5,
      environment: "prod",
      owner: null,
      projects: ["myproj"],
      dateCreated: "2026-01-01T00:00:00Z",
    });

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const alertMatch = url.pathname.match(
        /\/api\/0\/organizations\/([^/]+)\/alert-rules\//
      );
      if (alertMatch) {
        return Response.json([rule(alertMatch[1] as string)]);
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

    expect(stdout.output).toContain("Metric alert rules from 2 organizations:");
    expect(stdout.output).toContain("ORG");
    expect(stdout.output).toContain("org-one");
    expect(stdout.output).toContain("org-two");
    expect(stdout.output).toContain("Metric Rule");
    expect(stdout.output).toContain("count");
    expect(stdout.output).toContain("errors");
    expect(stdout.output).toContain("active");
  });

  test("partial org failure warns and still returns successful metric rules", async () => {
    setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    setOrgRegion("org-two", DEFAULT_SENTRY_URL);

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const alertMatch = url.pathname.match(
        /\/api\/0\/organizations\/([^/]+)\/alert-rules\//
      );
      if (alertMatch) {
        const org = alertMatch[1] as string;
        if (org === "org-two") {
          return new Response(JSON.stringify({ detail: "boom" }), {
            status: 500,
          });
        }
        return Response.json([
          {
            id: "ok-1",
            name: "Surviving Metric Rule",
            status: 0,
            query: "event.type:error",
            aggregate: "count()",
            dataset: "errors",
            timeWindow: 5,
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
    expect(parsed.data[0].name).toBe("Surviving Metric Rule");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to fetch metric alert rules from org-two")
    );
  });

  test("distributes multi-org budget exactly without over-fetching", async () => {
    setOrgRegion("org-one", DEFAULT_SENTRY_URL);
    setOrgRegion("org-two", DEFAULT_SENTRY_URL);
    setOrgRegion("org-three", DEFAULT_SENTRY_URL);
    const perPageByOrg = new Map<string, number>();

    const rule = (org: string, index: number) => ({
      id: `${org}-${index}`,
      name: `${org} Metric Rule ${index}`,
      status: 0,
      query: "event.type:error",
      aggregate: "count()",
      dataset: "errors",
      timeWindow: 5,
      environment: null,
      owner: null,
      projects: [],
      dateCreated: "2026-01-01T00:00:00Z",
    });

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const alertMatch = url.pathname.match(
        /\/api\/0\/organizations\/([^/]+)\/alert-rules\//
      );
      if (alertMatch) {
        const org = alertMatch[1] as string;
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
