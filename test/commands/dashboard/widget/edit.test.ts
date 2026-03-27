/**
 * Dashboard Widget Edit Command Tests
 *
 * Tests for the widget edit command in src/commands/dashboard/widget/edit.ts.
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

import { editCommand } from "../../../../src/commands/dashboard/widget/edit.js";
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

describe("dashboard widget edit", () => {
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

  test("edits widget by index with new display type", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();
    await func.call(context, { json: false, index: 0, display: "line" }, "123");

    expect(getDashboardSpy).toHaveBeenCalledWith("acme-corp", "123");
    expect(updateDashboardSpy).toHaveBeenCalledWith(
      "acme-corp",
      "123",
      expect.objectContaining({
        widgets: expect.arrayContaining([
          expect.objectContaining({
            title: "Error Count",
            displayType: "line",
          }),
        ]),
      })
    );
  });

  test("edits widget by title (case-insensitive)", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();
    await func.call(
      context,
      { json: false, title: "error count", display: "bar" },
      "123"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    expect(body.widgets[0].displayType).toBe("bar");
    expect(body.widgets[0].title).toBe("Error Count");
  });

  test("throws ValidationError when neither --index nor --title provided", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();

    const err = await func
      .call(context, { json: false, display: "line" }, "123")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("--index or --title");
  });

  test("throws ValidationError for invalid aggregate", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();

    const err = await func
      .call(context, { json: false, index: 0, query: ["bogus_func"] }, "123")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("Unknown aggregate function");
  });

  test("preserves existing fields when no query flags provided", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();
    await func.call(context, { json: false, index: 1, display: "bar" }, "123");

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const edited = body.widgets[1];
    // Display changed but queries preserved from original
    expect(edited.displayType).toBe("bar");
    expect(edited.queries[0].aggregates).toEqual([
      "p95(span.duration)",
      "count()",
    ]);
    expect(edited.queries[0].columns).toEqual(["span.description"]);
  });

  test("throws ValidationError when --dataset change produces invalid combo with existing display", async () => {
    // existing widget is displayType: "big_number" (spans), user changes only --dataset to "issue"
    // → effective combo is big_number + issue, which is invalid
    getDashboardSpy.mockResolvedValueOnce({
      ...sampleDashboard,
      widgets: [
        {
          title: "Count",
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
      ],
    });
    const { context } = createMockContext();
    const func = await editCommand.loader();
    const err = await func
      .call(context, { json: false, index: 0, dataset: "issue" }, "123")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('"issue" dataset supports');
  });

  test("throws ValidationError when --display change produces invalid combo with existing dataset", async () => {
    // existing widget is displayType: "line" + widgetType: "preprod-app-size", user changes only --display to "table"
    getDashboardSpy.mockResolvedValueOnce({
      ...sampleDashboard,
      widgets: [
        {
          title: "App Size",
          displayType: "line",
          widgetType: "preprod-app-size",
          queries: [
            {
              name: "",
              conditions: "",
              columns: [],
              aggregates: ["max(install_size)"],
              fields: ["max(install_size)"],
            },
          ],
          layout: { x: 0, y: 0, w: 4, h: 2 },
        },
      ],
    });
    const { context } = createMockContext();
    const func = await editCommand.loader();
    const err = await func
      .call(context, { json: false, index: 0, display: "table" }, "123")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('"preprod-app-size" dataset supports');
  });

  test("allows --dataset change on widget with untracked display type (text)", async () => {
    // text, wheel, rage_and_dead_clicks, agents_traces_table bypass Sentry's dataset system
    // entirely — they should not be cross-validated against a dataset.
    getDashboardSpy.mockResolvedValueOnce({
      ...sampleDashboard,
      widgets: [
        {
          title: "Notes",
          displayType: "text",
          widgetType: "spans",
          queries: [],
          layout: { x: 0, y: 0, w: 3, h: 2 },
        },
      ],
    });
    const { context } = createMockContext();
    const func = await editCommand.loader();
    // Should not throw — "text" is untracked, no dataset constraint applies
    await func.call(
      context,
      { json: false, index: 0, dataset: "discover" },
      "123"
    );
    expect(updateDashboardSpy).toHaveBeenCalled();
  });

  test("allows --display change to untracked display type (text)", async () => {
    // Changing --display to an untracked type should also skip cross-validation.
    const { context } = createMockContext();
    const func = await editCommand.loader();
    // sampleDashboard widget[0] is displayType: "big_number", widgetType: "spans"
    // Changing to "text" should not throw even though "text" isn't in spans' supported types.
    await func.call(context, { json: false, index: 0, display: "text" }, "123");
    expect(updateDashboardSpy).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Layout flag tests
  // -------------------------------------------------------------------------

  test("applies --x and --y layout flags to existing widget", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();
    await func.call(context, { json: false, index: 0, x: 4, y: 3 }, "123");

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const edited = body.widgets[0];
    expect(edited.layout.x).toBe(4);
    expect(edited.layout.y).toBe(3);
    // Width and height preserved from original
    expect(edited.layout.w).toBe(2);
    expect(edited.layout.h).toBe(1);
  });

  test("applies --width and --height layout flags", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();
    await func.call(
      context,
      { json: false, index: 1, x: 0, width: 6, height: 4 },
      "123"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const edited = body.widgets[1];
    expect(edited.layout.w).toBe(6);
    expect(edited.layout.h).toBe(4);
    expect(edited.layout.x).toBe(0);
    expect(edited.layout.y).toBe(0);
  });

  test("preserves existing layout when no layout flags provided", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();
    await func.call(context, { json: false, index: 0, display: "line" }, "123");

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    const edited = body.widgets[0];
    expect(edited.layout).toEqual({ x: 0, y: 0, w: 2, h: 1 });
  });

  test("throws ValidationError for x out of range", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();
    const err = await func
      .call(context, { json: false, index: 0, x: 6 }, "123")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("--x");
  });

  test("throws ValidationError for negative width", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();
    const err = await func
      .call(context, { json: false, index: 0, width: 0 }, "123")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("--width");
  });

  test("throws ValidationError when --x overflows with fallback width on layoutless widget", async () => {
    // Widget without layout uses FALLBACK_LAYOUT (w=3), so --x 4 → 4+3=7 > 6
    getDashboardSpy.mockResolvedValueOnce({
      ...sampleDashboard,
      widgets: [
        {
          title: "No Layout Widget",
          displayType: "line",
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
          // no layout field
        },
      ],
    });
    const { context } = createMockContext();
    const func = await editCommand.loader();
    const err = await func
      .call(context, { json: false, index: 0, x: 4 }, "123")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("overflows the grid");
  });

  test("throws ValidationError when x + width overflows grid", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();
    const err = await func
      .call(context, { json: false, index: 0, x: 4, width: 4 }, "123")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("overflows the grid");
  });

  test("validates aggregates against new dataset when --dataset changes", async () => {
    const { context } = createMockContext();
    const func = await editCommand.loader();

    // "failure_rate" is valid for discover but not spans.
    // Here we change the existing spans widget to discover dataset while
    // also setting a discover-only aggregate. This should succeed.
    await func.call(
      context,
      {
        json: false,
        index: 0,
        dataset: "discover",
        query: ["failure_rate"],
      },
      "123"
    );

    const body = updateDashboardSpy.mock.calls[0]?.[2];
    expect(body.widgets[0].widgetType).toBe("discover");
    expect(body.widgets[0].queries[0].aggregates).toEqual(["failure_rate()"]);
  });
});
