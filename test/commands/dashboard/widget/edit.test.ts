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
      setContext: mock(() => {
        // no-op for test
      }),
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
