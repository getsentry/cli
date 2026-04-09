/**
 * Dashboard Widget Add Command Tests
 *
 * Tests for the widget add command in src/commands/dashboard/widget/add.ts.
 * Uses spyOn pattern to mock API client and resolve-target.
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

import { addCommand } from "../../../../src/commands/dashboard/widget/add.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../../src/lib/api-client.js";
import { ValidationError } from "../../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../../src/lib/resolve-target.js";
import type { DashboardDetail } from "../../../../src/types/dashboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(cwd = "/tmp") {
  const stdoutWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      cwd,
    },
    stdoutWrite,
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const sampleDashboard: DashboardDetail = {
  id: "123",
  title: "My Dashboard",
  widgets: [
    {
      title: "Error Count",
      displayType: "big_number",
      widgetType: "spans",
      queries: [
        {
          name: "",
          conditions: "",
          columns: [],
          aggregates: ["count()"],
          fields: ["count()"],
        },
      ],
      layout: { x: 0, y: 0, w: 2, h: 1 },
    },
    {
      title: "Slow Spans",
      displayType: "table",
      widgetType: "spans",
      queries: [
        {
          name: "",
          conditions: "",
          columns: ["span.description"],
          aggregates: ["p95(span.duration)", "count()"],
          fields: ["span.description", "p95(span.duration)", "count()"],
        },
      ],
      layout: { x: 2, y: 0, w: 4, h: 2 },
    },
  ],
  dateCreated: "2026-03-01T10:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dashboard widget add", () => {
  let getDashboardSpy: ReturnType<typeof spyOn>;
  let updateDashboardSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getDashboardSpy = spyOn(apiClient, "getDashboard");
    updateDashboardSpy = spyOn(apiClient, "updateDashboard");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");

    // Default mocks
    resolveOrgSpy.mockResolvedValue({ org: "acme-corp" });
    getDashboardSpy.mockResolvedValue(sampleDashboard);
    updateDashboardSpy.mockImplementation(async (_org, _id, body) => ({
      ...sampleDashboard,
      widgets: body.widgets,
    }));
  });

  afterEach(() => {
    getDashboardSpy.mockRestore();
    updateDashboardSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("adds widget with correct API args (getDashboard then updateDashboard)", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      { json: false, display: "line", query: ["count"] },
      "123",
      "New Widget"
    );

    expect(getDashboardSpy).toHaveBeenCalledWith("acme-corp", "123");
    expect(updateDashboardSpy).toHaveBeenCalledWith(
      "acme-corp",
      "123",
      expect.objectContaining({
        title: "My Dashboard",
        widgets: expect.arrayContaining([
          expect.objectContaining({ title: "New Widget", displayType: "line" }),
        ]),
      })
    );
    // Original widgets should be preserved plus the new one
    const body = updateDashboardSpy.mock.calls[0]?.[2];
    expect(body.widgets.length).toBe(3);
  });

  test("JSON output contains dashboard, widget, and url", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      { json: true, display: "big_number", query: ["count"] },
      "123",
      "My Counter"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.dashboard).toBeDefined();
    expect(parsed.widget).toBeDefined();
    expect(parsed.widget.title).toBe("My Counter");
    expect(parsed.url).toContain("dashboard/123");
  });

  test("human output contains 'Added widget' and title", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      { json: false, display: "line", query: ["count"] },
      "123",
      "Error Rate"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Added widget");
    expect(output).toContain("Error Rate");
  });

  test("throws ValidationError when title is missing (less than 2 positional args)", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();

    const err = await func
      .call(context, { json: false, display: "line" }, "123")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("Widget title is required");
  });

  test("throws ValidationError for invalid display type", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();

    const err = await func
      .call(
        context,
        { json: false, display: "invalid_type" },
        "123",
        "Bad Widget"
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("Invalid --display");
  });

  test("throws ValidationError for invalid aggregate function", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();

    const err = await func
      .call(
        context,
        { json: false, display: "line", query: ["not_a_function"] },
        "123",
        "Bad Widget"
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("Unknown aggregate function");
  });

  test("throws ValidationError for big_number with issue dataset", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();

    const err = await func
      .call(
        context,
        { json: false, display: "big_number", dataset: "issue" },
        "123",
        "Unresolved Count"
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('"issue" dataset supports');
  });

  test("allows line/area/bar with issue dataset", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();

    for (const display of ["line", "area", "bar"]) {
      updateDashboardSpy.mockClear();
      await func.call(
        context,
        { json: false, display, dataset: "issue" },
        "123",
        "Issues Over Time"
      );
      expect(updateDashboardSpy).toHaveBeenCalledTimes(1);
    }
  });

  test("issue line dataset does not default columns", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      { json: false, display: "line", dataset: "issue" },
      "123",
      "Issues Over Time"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const addedWidget = body.widgets.at(-1);
    expect(addedWidget.queries[0].columns).toEqual([]);
  });

  test("issue dataset defaults columns to ['issue'] and orderby to -count()", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      { json: false, display: "table", dataset: "issue" },
      "123",
      "Top Issues"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const addedWidget = body.widgets.at(-1);
    expect(addedWidget.queries[0].columns).toEqual(["issue"]);
    expect(addedWidget.queries[0].fields).toContain("issue");
    expect(addedWidget.queries[0].orderby).toBe("-count()");
  });

  test("issue dataset respects explicit --group-by over default", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      {
        json: false,
        display: "table",
        dataset: "issue",
        "group-by": ["project"],
        limit: 5,
      },
      "123",
      "Issues by Project"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const addedWidget = body.widgets.at(-1);
    expect(addedWidget.queries[0].columns).toEqual(["project"]);
  });

  // preprod-app-size: line only
  // https://github.com/getsentry/sentry/blob/a42668e/static/app/views/dashboards/datasetConfig/mobileAppSize.tsx#L255
  test("throws ValidationError for table with preprod-app-size dataset", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    const err = await func
      .call(
        context,
        { json: false, display: "table", dataset: "preprod-app-size" },
        "123",
        "App Size"
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('"preprod-app-size" dataset supports');
  });

  test("allows line with preprod-app-size dataset", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      { json: false, display: "line", dataset: "preprod-app-size" },
      "123",
      "App Size"
    );
    expect(updateDashboardSpy).toHaveBeenCalledTimes(1);
  });

  // tracemetrics: no table or top_n
  // https://github.com/getsentry/sentry/blob/a42668e/static/app/views/dashboards/datasetConfig/traceMetrics.tsx#L285-L291
  test("throws ValidationError for table with tracemetrics dataset", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    const err = await func
      .call(
        context,
        { json: false, display: "table", dataset: "tracemetrics" },
        "123",
        "Trace Metrics"
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('"tracemetrics" dataset supports');
  });

  // spans: only dataset supporting details and server_tree
  // https://github.com/getsentry/sentry/blob/a42668e/static/app/views/dashboards/datasetConfig/spans.tsx#L287-L297
  test("allows details display with spans dataset", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      { json: false, display: "details", dataset: "spans" },
      "123",
      "Span Details"
    );
    expect(updateDashboardSpy).toHaveBeenCalledTimes(1);
  });

  test("throws ValidationError for details display with non-spans dataset", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    const err = await func
      .call(
        context,
        { json: false, display: "details", dataset: "logs" },
        "123",
        "Details"
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('"logs" dataset supports');
  });

  // -------------------------------------------------------------------------
  // Layout flag tests
  // -------------------------------------------------------------------------

  test("uses explicit layout when --x --y --width --height provided", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      {
        json: false,
        display: "line",
        query: ["count"],
        x: 0,
        y: 5,
        width: 6,
        height: 3,
      },
      "123",
      "Full Width Widget"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const addedWidget = body.widgets.at(-1);
    expect(addedWidget.layout.x).toBe(0);
    expect(addedWidget.layout.y).toBe(5);
    expect(addedWidget.layout.w).toBe(6);
    expect(addedWidget.layout.h).toBe(3);
  });

  test("partial layout flags override auto-layout defaults", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      {
        json: false,
        display: "big_number",
        query: ["count"],
        x: 4,
      },
      "123",
      "Positioned Counter"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const addedWidget = body.widgets.at(-1);
    // x overridden, other values from auto-layout defaults for big_number (w:2, h:1)
    expect(addedWidget.layout.x).toBe(4);
    expect(addedWidget.layout.w).toBe(2);
    expect(addedWidget.layout.h).toBe(1);
  });

  test("throws ValidationError for width > 6", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    const err = await func
      .call(
        context,
        { json: false, display: "line", query: ["count"], width: 7 },
        "123",
        "Too Wide"
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("--width");
  });

  test("throws ValidationError when --x overflows with auto-layout default width", async () => {
    // table display defaults to w=6, so --x 1 would produce x=1 + w=6 = 7 > 6
    const { context } = createMockContext();
    const func = await addCommand.loader();
    const err = await func
      .call(
        context,
        { json: false, display: "table", query: ["count"], x: 1 },
        "123",
        "Wide Table"
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("overflows the grid");
  });

  test("throws ValidationError for negative y", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    const err = await func
      .call(
        context,
        { json: false, display: "line", query: ["count"], y: -1 },
        "123",
        "Bad Y"
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("--y");
  });

  test("auto-defaults orderby when group-by + limit provided", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      {
        json: false,
        display: "bar",
        query: ["count"],
        "group-by": ["browser.name"],
        limit: 5,
      },
      "123",
      "Top Browsers"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const addedWidget = body.widgets.at(-1);
    expect(addedWidget.queries[0].orderby).toBe("-count()");
  });

  // -- Layout mode flag tests -----------------------------------------------

  test("--layout dense passes dense mode to auto-placer", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      { json: false, display: "big_number", query: ["count"], layout: "dense" },
      "123",
      "Dense Widget"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const addedWidget = body.widgets.at(-1);
    // Existing widgets: big_number at (0,0,2,1) and table at (2,0,4,2).
    // Dense mode finds the first gap. The gap at (0,1) fits a 2x1 big_number.
    expect(addedWidget.layout.x).toBe(0);
    expect(addedWidget.layout.y).toBe(1);
  });

  test("--layout sequential (default) uses sequential placement", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    await func.call(
      context,
      {
        json: false,
        display: "big_number",
        query: ["count"],
        layout: "sequential",
      },
      "123",
      "Sequential Widget"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const addedWidget = body.widgets.at(-1);
    // Existing widgets: big_number at (0,0,2,1) and table at (2,0,4,2).
    // Last widget is table at x=2,w=4 → cursor=(6,0) → 6+2=8 > 6 → wrap to (0,2).
    expect(addedWidget.layout.x).toBe(0);
    expect(addedWidget.layout.y).toBe(2);
  });

  test("--layout invalid rejects with ValidationError", async () => {
    const { context } = createMockContext();
    const func = await addCommand.loader();
    const err = await func
      .call(
        context,
        {
          json: false,
          display: "big_number",
          query: ["count"],
          layout: "invalid",
        },
        "123",
        "Bad Layout"
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain("--layout");
  });
});
