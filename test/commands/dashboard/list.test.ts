/**
 * Dashboard List Command Tests
 *
 * Tests for the dashboard list command in src/commands/dashboard/list.ts.
 * Uses spyOn pattern to mock API client, pagination DB, resolve-target,
 * browser, and polling modules.
 *
 * Note: Core cursor encoding invariants (round-trips, edge cases) are tested
 * via unit tests on the exported encodeCursor/decodeCursor functions. Command
 * integration tests focus on end-to-end behavior through the Stricli func().
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

import {
  decodeCursor,
  encodeCursor,
  listCommand,
} from "../../../src/commands/dashboard/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as paginationDb from "../../../src/lib/db/pagination.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as polling from "../../../src/lib/polling.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { DashboardListItem } from "../../../src/types/dashboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(cwd = "/tmp") {
  const stdoutWrite = mock(() => true);
  const stderrWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
      cwd,
    },
    stdoutWrite,
    stderrWrite,
  };
}

/** Default flags for most tests (no cursor, no web, no fresh) */
function defaultFlags(overrides: Partial<ListFlags> = {}): ListFlags {
  return {
    json: false,
    web: false,
    fresh: false,
    limit: 30,
    ...overrides,
  };
}

type ListFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly json?: boolean;
  readonly fields?: string[];
};

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const DASHBOARD_A: DashboardListItem = {
  id: "1",
  title: "Errors Overview",
  widgetDisplay: ["big_number", "line"],
  dateCreated: "2026-01-15T10:00:00Z",
};

const DASHBOARD_B: DashboardListItem = {
  id: "42",
  title: "Performance",
  widgetDisplay: ["table"],
  dateCreated: "2026-02-20T12:00:00Z",
};

const DASHBOARD_C: DashboardListItem = {
  id: "99",
  title: "API Monitoring",
  widgetDisplay: ["line", "bar"],
  dateCreated: "2026-03-01T08:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dashboard list command", () => {
  let listDashboardsPaginatedSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;
  let openInBrowserSpy: ReturnType<typeof spyOn>;
  let withProgressSpy: ReturnType<typeof spyOn>;
  let advancePaginationStateSpy: ReturnType<typeof spyOn>;
  let hasPreviousPageSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listDashboardsPaginatedSpy = spyOn(apiClient, "listDashboardsPaginated");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
    openInBrowserSpy = spyOn(browser, "openInBrowser").mockResolvedValue(
      undefined as never
    );
    // Bypass spinner — just run the callback directly
    withProgressSpy = spyOn(polling, "withProgress").mockImplementation(
      (_opts, fn) =>
        fn(() => {
          /* no-op setMessage */
        })
    );
    advancePaginationStateSpy = spyOn(
      paginationDb,
      "advancePaginationState"
    ).mockReturnValue(undefined);
    hasPreviousPageSpy = spyOn(paginationDb, "hasPreviousPage").mockReturnValue(
      false
    );
  });

  afterEach(() => {
    listDashboardsPaginatedSpy.mockRestore();
    resolveOrgSpy.mockRestore();
    openInBrowserSpy.mockRestore();
    withProgressSpy.mockRestore();
    advancePaginationStateSpy.mockRestore();
    hasPreviousPageSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // JSON output
  // -------------------------------------------------------------------------

  test("outputs JSON envelope with { data, hasMore } when --json", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A, DASHBOARD_B],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags({ json: true }));

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("hasMore", false);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].id).toBe("1");
    expect(parsed.data[0].title).toBe("Errors Overview");
    expect(parsed.data[1].id).toBe("42");
  });

  test("outputs { data: [], hasMore: false } when no dashboards exist", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags({ json: true }));

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ data: [], hasMore: false });
  });

  // -------------------------------------------------------------------------
  // Human output
  // -------------------------------------------------------------------------

  test("outputs human-readable table with column headers", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A, DASHBOARD_B],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags());

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("ID");
    expect(output).toContain("TITLE");
    expect(output).toContain("WIDGETS");
    expect(output).toContain("Errors Overview");
    expect(output).toContain("Performance");
  });

  test("shows empty state message when no dashboards exist", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags());

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No dashboards found.");
  });

  // -------------------------------------------------------------------------
  // --web flag
  // -------------------------------------------------------------------------

  test("--web flag opens browser instead of listing", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags({ web: true }));

    expect(openInBrowserSpy).toHaveBeenCalled();
    expect(listDashboardsPaginatedSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // --limit flag
  // -------------------------------------------------------------------------

  test("passes limit as perPage to API", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A],
      nextCursor: undefined,
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags({ json: true, limit: 10 }));

    expect(withProgressSpy).toHaveBeenCalled();
    expect(listDashboardsPaginatedSpy).toHaveBeenCalledWith("test-org", {
      perPage: 10,
      cursor: undefined,
    });
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  test("hasMore is true in JSON when API returns nextCursor", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A, DASHBOARD_B],
      nextCursor: "1735689600:0:0",
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags({ json: true, limit: 2 }));

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextCursor).toBeDefined();
  });

  test("hint includes -c next when more pages available", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A, DASHBOARD_B],
      nextCursor: "1735689600:0:0",
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags({ limit: 2 }));

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("-c next");
  });

  test("hasMore is false when API returns no nextCursor", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags({ json: true }));

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.nextCursor).toBeUndefined();
  });

  test("auto-pagination: --limit larger than page size fetches multiple pages", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });

    // First page returns 2 items + nextCursor, second page returns 1 item
    listDashboardsPaginatedSpy
      .mockResolvedValueOnce({
        data: [DASHBOARD_A, DASHBOARD_B],
        nextCursor: "cursor-page-2",
      })
      .mockResolvedValueOnce({
        data: [DASHBOARD_C],
        nextCursor: undefined,
      });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    // Request 3 items, which exceeds a single page of 2
    await func.call(context, defaultFlags({ json: true, limit: 3 }));

    // Should have called API twice
    expect(listDashboardsPaginatedSpy).toHaveBeenCalledTimes(2);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.data).toHaveLength(3);
    expect(parsed.hasMore).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Glob filter
  // -------------------------------------------------------------------------

  test("single glob arg filters dashboards by title", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A, DASHBOARD_B, DASHBOARD_C],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    // "Error*" should match "Errors Overview" only
    await func.call(context, defaultFlags({ json: true }), "Error*");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].title).toBe("Errors Overview");
  });

  test("two-arg form: explicit org + glob filter", async () => {
    // With "my-org/" as first arg, resolveOrgFromTarget returns "my-org"
    // directly (explicit/org-all mode), no resolveOrg call needed
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A, DASHBOARD_B, DASHBOARD_C],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags({ json: true }), "my-org/", "*API*");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].title).toBe("API Monitoring");
  });

  test("glob filter is case-insensitive", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A, DASHBOARD_B, DASHBOARD_C],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    // Lowercase "error*" should still match "Errors Overview"
    await func.call(context, defaultFlags({ json: true }), "error*");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].title).toBe("Errors Overview");
  });

  test("glob filter with no matches shows filter-aware message", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A, DASHBOARD_B, DASHBOARD_C],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags(), "NoMatch*");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No dashboards matching 'NoMatch*'.");
  });

  test("glob filter with no matches shows fuzzy suggestions for close input", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A, DASHBOARD_B, DASHBOARD_C],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    // "Perf" is a prefix of "Performance" → fuzzy match finds it
    await func.call(context, defaultFlags(), "Perf");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Did you mean:");
    expect(output).toContain("Performance");
  });

  // -------------------------------------------------------------------------
  // Org argument
  // -------------------------------------------------------------------------

  test("uses org from positional argument (org/ form)", async () => {
    // "my-org/" is parsed as org-all, resolveOrgFromTarget returns "my-org"
    // directly without calling resolveOrg
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [DASHBOARD_A],
      nextCursor: undefined,
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, defaultFlags({ json: true }), "my-org/");

    expect(listDashboardsPaginatedSpy).toHaveBeenCalledWith("my-org", {
      perPage: 30,
      cursor: undefined,
    });
  });

  test("throws ContextError when org cannot be resolved", async () => {
    resolveOrgSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(func.call(context, defaultFlags())).rejects.toThrow(
      "Organization"
    );
  });
});

// ---------------------------------------------------------------------------
// Extended cursor encoding / decoding
// ---------------------------------------------------------------------------

describe("encodeCursor", () => {
  test("encodes server cursor with afterId", () => {
    expect(encodeCursor("1:0:0", "42")).toBe("1:0:0|42");
  });

  test("returns plain server cursor when no afterId", () => {
    expect(encodeCursor("1:0:0")).toBe("1:0:0");
  });

  test("encodes afterId without server cursor", () => {
    expect(encodeCursor(undefined, "42")).toBe("|42");
  });

  test("returns undefined when no cursor and no afterId", () => {
    expect(encodeCursor(undefined)).toBeUndefined();
  });
});

describe("decodeCursor", () => {
  test("decodes cursor with pipe separator", () => {
    expect(decodeCursor("1:0:0|42")).toEqual({
      serverCursor: "1:0:0",
      afterId: "42",
    });
  });

  test("decodes plain server cursor (no pipe)", () => {
    expect(decodeCursor("1:0:0")).toEqual({
      serverCursor: "1:0:0",
      afterId: undefined,
    });
  });

  test("decodes afterId-only cursor (leading pipe)", () => {
    expect(decodeCursor("|42")).toEqual({
      serverCursor: undefined,
      afterId: "42",
    });
  });

  test("decodes empty string to all undefined", () => {
    expect(decodeCursor("")).toEqual({
      serverCursor: undefined,
      afterId: undefined,
    });
  });
});
