/**
 * Tests for `sentry explore` command.
 *
 * Verifies target resolution (org, org/project, bare slug, auto-detect),
 * API call parameters, output formatting, pagination, and dataset handling.
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
import { exploreCommand } from "../../src/commands/explore.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as paginationDb from "../../src/lib/db/pagination.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../src/lib/resolve-target.js";
import { parsePeriod } from "../../src/lib/time-range.js";
import { useTestConfigDir } from "../helpers.js";

// Keep namespace references alive so biome doesn't strip the imports
const _apiRef = apiClient;
const _paginationRef = paginationDb;
const _resolveRef = resolveTarget;

useTestConfigDir("explore-test-");

type ExploreFunc = (
  this: unknown,
  flags: Record<string, unknown>,
  ...args: unknown[]
) => Promise<void>;

let func: ExploreFunc;

function createContext() {
  const stdoutChunks: string[] = [];
  return {
    context: {
      stdout: {
        write: mock((s: string) => {
          stdoutChunks.push(s);
        }),
      },
      stderr: {
        write: mock((_s: string) => {
          /* no-op */
        }),
      },
      cwd: "/tmp/test-explore",
    },
    getStdout: () => stdoutChunks.join(""),
  };
}

const MOCK_EVENTS_RESPONSE = {
  data: [
    { title: "TypeError: Cannot read property 'foo'", "count()": 1234 },
    { title: "ReferenceError: bar is not defined", "count()": 567 },
  ],
  meta: {
    fields: { title: "string", "count()": "integer" },
    units: {},
  },
};

let queryEventsSpy: ReturnType<typeof spyOn>;
let resolveOrgSpy: ReturnType<typeof spyOn>;
let resolveProjectBySlugSpy: ReturnType<typeof spyOn>;
let resolveCursorSpy: ReturnType<typeof spyOn>;
let advancePaginationStateSpy: ReturnType<typeof spyOn>;
let hasPreviousPageSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  func = (await exploreCommand.loader()) as unknown as ExploreFunc;

  queryEventsSpy = spyOn(apiClient, "queryEvents");
  queryEventsSpy.mockResolvedValue({
    data: MOCK_EVENTS_RESPONSE,
    nextCursor: undefined,
  });

  resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
  resolveOrgSpy.mockResolvedValue({ org: "test-org" });

  // Default: bare-slug lookups resolve to test-org/test-project
  resolveProjectBySlugSpy = spyOn(resolveTarget, "resolveProjectBySlug");
  resolveProjectBySlugSpy.mockResolvedValue({
    org: "test-org",
    project: "test-project",
    projectData: {} as never,
  });

  resolveCursorSpy = spyOn(paginationDb, "resolveCursor").mockReturnValue({
    cursor: undefined,
    direction: "next" as const,
  });
  advancePaginationStateSpy = spyOn(
    paginationDb,
    "advancePaginationState"
  ).mockReturnValue(undefined);
  hasPreviousPageSpy = spyOn(paginationDb, "hasPreviousPage").mockReturnValue(
    false
  );
});

afterEach(() => {
  queryEventsSpy.mockRestore();
  resolveOrgSpy.mockRestore();
  resolveProjectBySlugSpy.mockRestore();
  resolveCursorSpy.mockRestore();
  advancePaginationStateSpy.mockRestore();
  hasPreviousPageSpy.mockRestore();
});

const DEFAULT_FLAGS = {
  limit: 25,
  dataset: "errors",
  period: parsePeriod("24h"),
  json: false,
  fresh: false,
};

describe("sentry explore", () => {
  describe("target resolution", () => {
    test("`<org>/` uses org without project filter", async () => {
      const { context } = createContext();

      await func.call(context, DEFAULT_FLAGS, "my-org/");

      // No resolveOrg call needed — org-all parses directly
      expect(queryEventsSpy).toHaveBeenCalledWith(
        "my-org",
        expect.objectContaining({ query: undefined })
      );
    });

    test("`<org>/<project>` adds project:<slug> to query automatically", async () => {
      const { context } = createContext();

      await func.call(context, DEFAULT_FLAGS, "my-org/cli");

      expect(queryEventsSpy).toHaveBeenCalledWith(
        "my-org",
        expect.objectContaining({ query: "project:cli" })
      );
    });

    test("`<org>/<project>` with --query merges project filter and user query", async () => {
      const { context } = createContext();

      await func.call(
        context,
        { ...DEFAULT_FLAGS, query: "level:error" },
        "my-org/cli"
      );

      expect(queryEventsSpy).toHaveBeenCalledWith(
        "my-org",
        expect.objectContaining({ query: "project:cli level:error" })
      );
    });

    test("bare slug resolves project across orgs and adds project filter", async () => {
      const { context } = createContext();

      await func.call(context, DEFAULT_FLAGS, "cli");

      expect(resolveProjectBySlugSpy).toHaveBeenCalledWith(
        "cli",
        expect.any(String),
        expect.any(String),
        undefined
      );
      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ query: "project:test-project" })
      );
    });

    test("auto-detects org when no target provided", async () => {
      const { context } = createContext();

      await func.call(context, DEFAULT_FLAGS);

      expect(resolveOrgSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/tmp/test-explore" })
      );
      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ query: undefined })
      );
    });

    test("throws ContextError when auto-detect fails", async () => {
      resolveOrgSpy.mockResolvedValue(null);
      const { context } = createContext();

      await expect(func.call(context, DEFAULT_FLAGS)).rejects.toThrow(
        "Organization"
      );
    });
  });

  describe("API call parameters", () => {
    test("passes default fields and dataset when none specified", async () => {
      const { context } = createContext();

      await func.call(context, DEFAULT_FLAGS, "test-org/");

      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          fields: ["title", "count()"],
          dataset: "errors",
        })
      );
    });

    test("passes custom fields from --field flag", async () => {
      const { context } = createContext();

      await func.call(
        context,
        {
          ...DEFAULT_FLAGS,
          field: ["transaction", "p50(transaction.duration)"],
        },
        "test-org/"
      );

      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          fields: ["transaction", "p50(transaction.duration)"],
        })
      );
    });

    test("passes custom dataset", async () => {
      const { context } = createContext();

      await func.call(
        context,
        { ...DEFAULT_FLAGS, dataset: "transactions" },
        "test-org/"
      );

      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ dataset: "transactions" })
      );
    });

    test("passes user query unchanged when no project filter", async () => {
      const { context } = createContext();

      await func.call(
        context,
        { ...DEFAULT_FLAGS, query: "is:unresolved" },
        "test-org/"
      );

      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ query: "is:unresolved" })
      );
    });

    test("passes limit", async () => {
      const { context } = createContext();

      await func.call(context, { ...DEFAULT_FLAGS, limit: 100 }, "test-org/");

      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ limit: 100 })
      );
    });
  });

  describe("sort handling", () => {
    test("auto-sorts by first aggregate descending for non-spans", async () => {
      const { context } = createContext();

      await func.call(context, DEFAULT_FLAGS, "test-org/");

      // Default fields are ["title", "count()"], so sort should be omitted
      // for non-spans datasets (errors is the default)
      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ sort: undefined })
      );
    });

    test("applies explicit sort on spans dataset", async () => {
      const { context } = createContext();

      await func.call(
        context,
        { ...DEFAULT_FLAGS, dataset: "spans", sort: "-count()" },
        "test-org/"
      );

      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ sort: "-count()", dataset: "spans" })
      );
    });

    test("omits sort for non-spans dataset even when auto-detected", async () => {
      const { context } = createContext();

      await func.call(
        context,
        { ...DEFAULT_FLAGS, dataset: "errors" },
        "test-org/"
      );

      expect(queryEventsSpy).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ sort: undefined })
      );
    });
  });

  describe("output", () => {
    test("renders human-readable table with results", async () => {
      const { context, getStdout } = createContext();

      await func.call(context, DEFAULT_FLAGS, "test-org/");

      const output = getStdout();
      expect(output).toContain("errors");
      expect(output).toContain("test-org");
    });

    test("includes project in human header when target is org/project", async () => {
      const { context, getStdout } = createContext();

      await func.call(context, DEFAULT_FLAGS, "my-org/cli");

      expect(getStdout()).toContain("my-org/cli");
    });

    test("preserves user --field order in table columns", async () => {
      // API returns fields in a different order than requested
      queryEventsSpy.mockResolvedValue({
        data: {
          data: [{ title: "Error A", "count_unique(user)": 5, "count()": 100 }],
          meta: {
            // Note: API returns in alphabetical-ish order, NOT request order
            fields: {
              "count_unique(user)": "integer",
              "count()": "integer",
              title: "string",
            },
          },
        },
        nextCursor: undefined,
      });
      const { context, getStdout } = createContext();

      await func.call(
        context,
        {
          ...DEFAULT_FLAGS,
          field: ["title", "count()", "count_unique(user)"],
        },
        "test-org/"
      );

      const output = getStdout();
      const titleIdx = output.indexOf("TITLE");
      const countIdx = output.indexOf("COUNT()");
      const uniqueIdx = output.indexOf("COUNT_UNIQUE(USER)");

      // All three columns must appear
      expect(titleIdx).toBeGreaterThan(-1);
      expect(countIdx).toBeGreaterThan(-1);
      expect(uniqueIdx).toBeGreaterThan(-1);

      // Order must match user input: TITLE < COUNT() < COUNT_UNIQUE(USER)
      expect(titleIdx).toBeLessThan(countIdx);
      expect(countIdx).toBeLessThan(uniqueIdx);
    });

    test("renders JSON output with envelope", async () => {
      const { context, getStdout } = createContext();

      await func.call(context, { ...DEFAULT_FLAGS, json: true }, "test-org/");

      const parsed = JSON.parse(getStdout());
      expect(parsed.data).toBeArray();
      expect(parsed.dataset).toBe("errors");
      expect(parsed.hasMore).toBe(false);
      expect(parsed.hasPrev).toBe(false);
      expect(parsed.meta).toBeDefined();
    });

    test("shows empty message when no results", async () => {
      queryEventsSpy.mockResolvedValue({
        data: { data: [], meta: { fields: {} } },
        nextCursor: undefined,
      });
      const { context, getStdout } = createContext();

      await func.call(context, DEFAULT_FLAGS, "test-org/");

      expect(getStdout()).toContain("No results matched the query.");
    });
  });

  describe("pagination", () => {
    test("includes nextCursor in JSON when more results available", async () => {
      queryEventsSpy.mockResolvedValue({
        data: MOCK_EVENTS_RESPONSE,
        nextCursor: "1735689600:0:1",
      });
      const { context, getStdout } = createContext();

      await func.call(context, { ...DEFAULT_FLAGS, json: true }, "test-org/");

      const parsed = JSON.parse(getStdout());
      expect(parsed.hasMore).toBe(true);
      expect(parsed.nextCursor).toBe("1735689600:0:1");
    });

    test("advances pagination state after query", async () => {
      queryEventsSpy.mockResolvedValue({
        data: MOCK_EVENTS_RESPONSE,
        nextCursor: "cursor123",
      });
      const { context } = createContext();

      await func.call(context, DEFAULT_FLAGS, "test-org/");

      expect(advancePaginationStateSpy).toHaveBeenCalledWith(
        "explore",
        expect.any(String),
        "next",
        "cursor123"
      );
    });
  });
});
