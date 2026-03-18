/**
 * Dashboard Type & Validation Tests
 *
 * Tests for enum constants, strict input schema, and parseWidgetInput()
 * in src/types/dashboard.ts.
 */

import { describe, expect, test } from "bun:test";
import {
  assignDefaultLayout,
  type DashboardWidget,
  DashboardWidgetInputSchema,
  DEFAULT_WIDGET_TYPE,
  DISCOVER_AGGREGATE_FUNCTIONS,
  DISPLAY_TYPES,
  DiscoverAggregateFunctionSchema,
  type DisplayType,
  IS_FILTER_VALUES,
  IsFilterValueSchema,
  parseAggregate,
  parseSortExpression,
  parseWidgetInput,
  prepareWidgetQueries,
  SPAN_AGGREGATE_FUNCTIONS,
  SpanAggregateFunctionSchema,
  stripWidgetServerFields,
  WIDGET_TYPES,
  type WidgetType,
} from "../../src/types/dashboard.js";

// ---------------------------------------------------------------------------
// Enum constants
// ---------------------------------------------------------------------------

describe("WIDGET_TYPES", () => {
  test("contains spans as default", () => {
    expect(WIDGET_TYPES).toContain("spans");
    expect(DEFAULT_WIDGET_TYPE).toBe("spans");
  });

  test("contains all expected dataset types", () => {
    const expected: WidgetType[] = [
      "discover",
      "issue",
      "metrics",
      "error-events",
      "transaction-like",
      "spans",
      "logs",
      "tracemetrics",
      "preprod-app-size",
    ];
    for (const t of expected) {
      expect(WIDGET_TYPES).toContain(t);
    }
  });
});

describe("DISPLAY_TYPES", () => {
  test("contains common visualization types", () => {
    const common: DisplayType[] = [
      "line",
      "area",
      "bar",
      "table",
      "big_number",
    ];
    for (const t of common) {
      expect(DISPLAY_TYPES).toContain(t);
    }
  });

  test("contains all expected display types", () => {
    const expected: DisplayType[] = [
      "line",
      "area",
      "stacked_area",
      "bar",
      "table",
      "big_number",
      "top_n",
      "details",
      "categorical_bar",
      "wheel",
      "rage_and_dead_clicks",
      "server_tree",
      "text",
      "agents_traces_table",
    ];
    for (const t of expected) {
      expect(DISPLAY_TYPES).toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------
// SPAN_AGGREGATE_FUNCTIONS / DISCOVER_AGGREGATE_FUNCTIONS
// ---------------------------------------------------------------------------

describe("SPAN_AGGREGATE_FUNCTIONS", () => {
  test("contains core aggregate functions", () => {
    const core = [
      "count",
      "avg",
      "sum",
      "min",
      "max",
      "p50",
      "p75",
      "p95",
      "p99",
    ];
    for (const fn of core) {
      expect(SPAN_AGGREGATE_FUNCTIONS).toContain(fn);
    }
  });

  test("contains rate functions and aliases", () => {
    expect(SPAN_AGGREGATE_FUNCTIONS).toContain("eps");
    expect(SPAN_AGGREGATE_FUNCTIONS).toContain("epm");
    expect(SPAN_AGGREGATE_FUNCTIONS).toContain("sps");
    expect(SPAN_AGGREGATE_FUNCTIONS).toContain("spm");
  });

  test("zod schema validates known functions", () => {
    expect(SpanAggregateFunctionSchema.safeParse("count").success).toBe(true);
    expect(SpanAggregateFunctionSchema.safeParse("p95").success).toBe(true);
  });

  test("zod schema rejects unknown functions", () => {
    expect(SpanAggregateFunctionSchema.safeParse("bogus").success).toBe(false);
  });
});

describe("DISCOVER_AGGREGATE_FUNCTIONS", () => {
  test("is a superset of span functions", () => {
    for (const fn of SPAN_AGGREGATE_FUNCTIONS) {
      expect(DISCOVER_AGGREGATE_FUNCTIONS).toContain(fn);
    }
  });

  test("contains discover-specific functions", () => {
    const extras = [
      "failure_count",
      "failure_rate",
      "apdex",
      "user_misery",
      "count_if",
      "last_seen",
    ];
    for (const fn of extras) {
      expect(DISCOVER_AGGREGATE_FUNCTIONS).toContain(fn);
    }
  });

  test("zod schema validates discover functions", () => {
    expect(DiscoverAggregateFunctionSchema.safeParse("apdex").success).toBe(
      true
    );
    expect(
      DiscoverAggregateFunctionSchema.safeParse("failure_rate").success
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IS_FILTER_VALUES
// ---------------------------------------------------------------------------

describe("IS_FILTER_VALUES", () => {
  test("contains status values", () => {
    const statuses = ["resolved", "unresolved", "ignored", "archived"];
    for (const s of statuses) {
      expect(IS_FILTER_VALUES).toContain(s);
    }
  });

  test("contains substatus values", () => {
    const substatuses = ["escalating", "ongoing", "regressed", "new"];
    for (const s of substatuses) {
      expect(IS_FILTER_VALUES).toContain(s);
    }
  });

  test("contains assignment values", () => {
    const assignments = [
      "assigned",
      "unassigned",
      "for_review",
      "linked",
      "unlinked",
    ];
    for (const s of assignments) {
      expect(IS_FILTER_VALUES).toContain(s);
    }
  });

  test("zod schema validates known values", () => {
    expect(IsFilterValueSchema.safeParse("unresolved").success).toBe(true);
    expect(IsFilterValueSchema.safeParse("escalating").success).toBe(true);
    expect(IsFilterValueSchema.safeParse("assigned").success).toBe(true);
  });

  test("zod schema rejects unknown values", () => {
    expect(IsFilterValueSchema.safeParse("bogus").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DashboardWidgetInputSchema
// ---------------------------------------------------------------------------

describe("DashboardWidgetInputSchema", () => {
  const minimalWidget = {
    title: "My Widget",
    displayType: "line",
  };

  test("accepts minimal widget and defaults widgetType to spans", () => {
    const result = DashboardWidgetInputSchema.safeParse(minimalWidget);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.widgetType).toBe("spans");
    }
  });

  test("accepts explicit widgetType", () => {
    const result = DashboardWidgetInputSchema.safeParse({
      ...minimalWidget,
      widgetType: "error-events",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.widgetType).toBe("error-events");
    }
  });

  test("accepts all valid widgetType values", () => {
    for (const wt of WIDGET_TYPES) {
      const result = DashboardWidgetInputSchema.safeParse({
        ...minimalWidget,
        widgetType: wt,
      });
      expect(result.success).toBe(true);
    }
  });

  test("accepts all valid displayType values", () => {
    for (const dt of DISPLAY_TYPES) {
      const result = DashboardWidgetInputSchema.safeParse({
        title: "Test",
        displayType: dt,
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid displayType", () => {
    const result = DashboardWidgetInputSchema.safeParse({
      ...minimalWidget,
      displayType: "chart",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid widgetType", () => {
    const result = DashboardWidgetInputSchema.safeParse({
      ...minimalWidget,
      widgetType: "span",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing title", () => {
    const result = DashboardWidgetInputSchema.safeParse({
      displayType: "line",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing displayType", () => {
    const result = DashboardWidgetInputSchema.safeParse({
      title: "My Widget",
    });
    expect(result.success).toBe(false);
  });

  test("preserves extra fields via passthrough", () => {
    const result = DashboardWidgetInputSchema.safeParse({
      ...minimalWidget,
      customField: "hello",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).customField).toBe(
        "hello"
      );
    }
  });

  test("accepts widget with queries", () => {
    const result = DashboardWidgetInputSchema.safeParse({
      ...minimalWidget,
      queries: [
        {
          conditions: "transaction.op:http",
          aggregates: ["count()"],
          columns: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseWidgetInput
// ---------------------------------------------------------------------------

describe("parseWidgetInput", () => {
  test("returns validated widget with defaults", () => {
    const widget = parseWidgetInput({
      title: "Error Count",
      displayType: "big_number",
    });
    expect(widget.title).toBe("Error Count");
    expect(widget.displayType).toBe("big_number");
    expect(widget.widgetType).toBe("spans");
  });

  test("preserves explicit widgetType", () => {
    const widget = parseWidgetInput({
      title: "Errors",
      displayType: "line",
      widgetType: "error-events",
    });
    expect(widget.widgetType).toBe("error-events");
  });

  test("throws ValidationError for invalid displayType with valid values listed", () => {
    expect(() =>
      parseWidgetInput({
        title: "Bad Widget",
        displayType: "invalid_chart",
      })
    ).toThrow(/Invalid displayType/);
    expect(() =>
      parseWidgetInput({
        title: "Bad Widget",
        displayType: "invalid_chart",
      })
    ).toThrow(/line/);
  });

  test("throws ValidationError for invalid widgetType with valid values listed", () => {
    expect(() =>
      parseWidgetInput({
        title: "Bad Widget",
        displayType: "line",
        widgetType: "span",
      })
    ).toThrow(/Invalid widgetType/);
    expect(() =>
      parseWidgetInput({
        title: "Bad Widget",
        displayType: "line",
        widgetType: "span",
      })
    ).toThrow(/spans/);
  });

  test("throws ValidationError for missing required fields", () => {
    expect(() => parseWidgetInput({})).toThrow(/Invalid widget definition/);
  });

  test("throws ValidationError for non-object input", () => {
    expect(() => parseWidgetInput("not an object")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseAggregate
// ---------------------------------------------------------------------------

describe("parseAggregate", () => {
  test("bare name becomes no-arg function call", () => {
    expect(parseAggregate("count")).toBe("count()");
  });

  test("colon syntax becomes function with arg", () => {
    expect(parseAggregate("p95:span.duration")).toBe("p95(span.duration)");
  });

  test("passthrough when already has parens", () => {
    expect(parseAggregate("count()")).toBe("count()");
  });

  test("passthrough for function with args in parens", () => {
    expect(parseAggregate("avg(span.self_time)")).toBe("avg(span.self_time)");
  });

  test("colon with dotted column name", () => {
    expect(parseAggregate("avg:span.self_time")).toBe("avg(span.self_time)");
  });

  test("single word functions", () => {
    expect(parseAggregate("p50")).toBe("p50()");
    expect(parseAggregate("p75")).toBe("p75()");
    expect(parseAggregate("p99")).toBe("p99()");
  });
});

// ---------------------------------------------------------------------------
// parseSortExpression
// ---------------------------------------------------------------------------

describe("parseSortExpression", () => {
  test("ascending bare name", () => {
    expect(parseSortExpression("count")).toBe("count()");
  });

  test("descending bare name", () => {
    expect(parseSortExpression("-count")).toBe("-count()");
  });

  test("ascending colon syntax", () => {
    expect(parseSortExpression("p95:span.duration")).toBe("p95(span.duration)");
  });

  test("descending colon syntax", () => {
    expect(parseSortExpression("-p95:span.duration")).toBe(
      "-p95(span.duration)"
    );
  });

  test("passthrough with parens", () => {
    expect(parseSortExpression("count()")).toBe("count()");
    expect(parseSortExpression("-count()")).toBe("-count()");
  });
});

// ---------------------------------------------------------------------------
// prepareWidgetQueries
// ---------------------------------------------------------------------------

describe("prepareWidgetQueries", () => {
  test("auto-computes fields from aggregates + columns", () => {
    const widget = prepareWidgetQueries({
      title: "Test",
      displayType: "line",
      queries: [
        {
          aggregates: ["count()"],
          columns: ["browser.name"],
        },
      ],
    });
    expect(widget.queries?.[0]?.fields).toEqual(["browser.name", "count()"]);
  });

  test("does not overwrite existing fields", () => {
    const widget = prepareWidgetQueries({
      title: "Test",
      displayType: "line",
      queries: [
        {
          aggregates: ["count()"],
          columns: ["browser.name"],
          fields: ["custom_field"],
        },
      ],
    });
    expect(widget.queries?.[0]?.fields).toEqual(["custom_field"]);
  });

  test("defaults conditions to empty string when missing", () => {
    const widget = prepareWidgetQueries({
      title: "Test",
      displayType: "line",
      queries: [{ aggregates: ["count()"] }],
    });
    expect(widget.queries?.[0]?.conditions).toBe("");
  });

  test("preserves existing conditions", () => {
    const widget = prepareWidgetQueries({
      title: "Test",
      displayType: "line",
      queries: [
        {
          aggregates: ["count()"],
          conditions: "is:unresolved",
        },
      ],
    });
    expect(widget.queries?.[0]?.conditions).toBe("is:unresolved");
  });

  test("handles widget with no queries", () => {
    const widget = prepareWidgetQueries({
      title: "Test",
      displayType: "big_number",
    });
    expect(widget.queries).toBeUndefined();
  });

  test("handles empty aggregates and columns", () => {
    const widget = prepareWidgetQueries({
      title: "Test",
      displayType: "line",
      queries: [{}],
    });
    expect(widget.queries?.[0]?.fields).toEqual([]);
    expect(widget.queries?.[0]?.conditions).toBe("");
  });

  test("throws for table widget with limit exceeding max", () => {
    expect(() =>
      prepareWidgetQueries({
        title: "Test",
        displayType: "table",
        limit: 25,
      })
    ).toThrow(/maximum limit for table widgets is 10/);
  });

  test("throws for bar widget with limit exceeding max", () => {
    expect(() =>
      prepareWidgetQueries({
        title: "Test",
        displayType: "bar",
        limit: 15,
      })
    ).toThrow(/maximum limit for bar widgets is 10/);
  });

  test("accepts table widget with limit within max", () => {
    const widget = prepareWidgetQueries({
      title: "Test",
      displayType: "table",
      limit: 5,
    });
    expect(widget.limit).toBe(5);
  });

  test("accepts line widget with any limit", () => {
    const widget = prepareWidgetQueries({
      title: "Test",
      displayType: "line",
      limit: 100,
    });
    expect(widget.limit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// assignDefaultLayout
// ---------------------------------------------------------------------------

describe("assignDefaultLayout", () => {
  test("widget with existing layout returns unchanged", () => {
    const widget: DashboardWidget = {
      title: "Test",
      displayType: "line",
      layout: { x: 1, y: 2, w: 3, h: 2 },
    };
    const result = assignDefaultLayout(widget, []);
    expect(result.layout).toEqual({ x: 1, y: 2, w: 3, h: 2 });
  });

  test("widget without layout assigns default size at (0,0)", () => {
    const widget: DashboardWidget = {
      title: "Test",
      displayType: "big_number",
    };
    const result = assignDefaultLayout(widget, []);
    expect(result.layout).toBeDefined();
    expect(result.layout!.x).toBe(0);
    expect(result.layout!.y).toBe(0);
    expect(result.layout!.w).toBe(2);
    expect(result.layout!.h).toBe(1);
  });

  test("widget in partially filled grid finds first gap", () => {
    const existing: DashboardWidget[] = [
      {
        title: "Existing",
        displayType: "big_number",
        layout: { x: 0, y: 0, w: 2, h: 1 },
      },
    ];
    const widget: DashboardWidget = {
      title: "New",
      displayType: "big_number",
    };
    const result = assignDefaultLayout(widget, existing);
    expect(result.layout).toBeDefined();
    // Should be placed after the existing widget, not overlapping
    expect(result.layout!.x).toBe(2);
    expect(result.layout!.y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// stripWidgetServerFields
// ---------------------------------------------------------------------------

describe("stripWidgetServerFields", () => {
  test("strips id, dashboardId, dateCreated from widget", () => {
    const widget: DashboardWidget = {
      id: "100",
      dashboardId: "42",
      dateCreated: "2026-01-01T00:00:00Z",
      title: "Test",
      displayType: "line",
      widgetType: "spans",
    };
    const result = stripWidgetServerFields(widget);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("dashboardId");
    expect(result).not.toHaveProperty("dateCreated");
    expect(result.title).toBe("Test");
    expect(result.displayType).toBe("line");
    expect(result.widgetType).toBe("spans");
  });

  test("strips server fields from queries", () => {
    const widget: DashboardWidget = {
      title: "Test",
      displayType: "line",
      queries: [
        {
          id: "q1",
          widgetId: "w1",
          dateCreated: "2026-01-01T00:00:00Z",
          aggregates: ["count()"],
          conditions: "",
          name: "Query 1",
        },
      ],
    };
    const result = stripWidgetServerFields(widget);
    const query = result.queries![0]!;
    expect(query).not.toHaveProperty("id");
    expect(query).not.toHaveProperty("widgetId");
    expect(query).not.toHaveProperty("dateCreated");
    expect(query.aggregates).toEqual(["count()"]);
  });

  test("strips isResizable from layout", () => {
    const widget: DashboardWidget = {
      title: "Test",
      displayType: "line",
      layout: { x: 0, y: 0, w: 3, h: 2, isResizable: true },
    };
    const result = stripWidgetServerFields(widget);
    expect(result.layout).not.toHaveProperty("isResizable");
    expect(result.layout!.x).toBe(0);
    expect(result.layout!.w).toBe(3);
  });

  test("preserves widgetType, displayType, and layout", () => {
    const widget: DashboardWidget = {
      id: "100",
      title: "Test",
      displayType: "bar",
      widgetType: "spans",
      layout: { x: 1, y: 2, w: 3, h: 4 },
    };
    const result = stripWidgetServerFields(widget);
    expect(result.displayType).toBe("bar");
    expect(result.widgetType).toBe("spans");
    expect(result.layout).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});
