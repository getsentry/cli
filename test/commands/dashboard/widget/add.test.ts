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
});
