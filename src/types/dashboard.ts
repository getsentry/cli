/**
 * Dashboard types and schemas
 *
 * Zod schemas and TypeScript types for Sentry Dashboard API responses.
 * Includes utility functions for stripping server-generated fields
 * before PUT requests, and strict input validation for user-authored widgets.
 */

import { z } from "zod";

import { ValidationError } from "../lib/errors.js";

// ---------------------------------------------------------------------------
// Widget type and display type enums
//
// Source: sentry/src/sentry/models/dashboard_widget.py
// Also in: @sentry/api types (cli/node_modules/@sentry/api/dist/types.gen.d.ts)
// ---------------------------------------------------------------------------

/**
 * Valid widget types (dataset selectors).
 *
 * Source: sentry/src/sentry/models/dashboard_widget.py DashboardWidgetTypes.TYPES
 */
export const WIDGET_TYPES = [
  "discover",
  "issue",
  "metrics",
  "error-events",
  "transaction-like",
  "spans",
  "logs",
  "tracemetrics",
  "preprod-app-size",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Default widgetType — the modern spans dataset covers most use cases */
export const DEFAULT_WIDGET_TYPE: WidgetType = "spans";

/**
 * Valid widget display types (visualization formats).
 *
 * Source: sentry/src/sentry/models/dashboard_widget.py DashboardWidgetDisplayTypes.TYPES
 */
export const DISPLAY_TYPES = [
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
] as const;

export type DisplayType = (typeof DISPLAY_TYPES)[number];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Schema for a single query within a dashboard widget */
export const DashboardWidgetQuerySchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    conditions: z.string().optional(),
    columns: z.array(z.string()).optional(),
    aggregates: z.array(z.string()).optional(),
    fieldAliases: z.array(z.string()).optional(),
    orderby: z.string().optional(),
    fields: z.array(z.string()).optional(),
    widgetId: z.string().optional(),
    dateCreated: z.string().optional(),
  })
  .passthrough();

/** Schema for widget layout position */
export const DashboardWidgetLayoutSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    minH: z.number().optional(),
    isResizable: z.boolean().optional(),
  })
  .passthrough();

/** Schema for a single dashboard widget */
export const DashboardWidgetSchema = z
  .object({
    id: z.string().optional(),
    title: z.string(),
    displayType: z.string(),
    widgetType: z.string().optional(),
    interval: z.string().optional(),
    queries: z.array(DashboardWidgetQuerySchema).optional(),
    layout: DashboardWidgetLayoutSchema.optional(),
    thresholds: z.unknown().optional(),
    limit: z.number().nullable().optional(),
    dashboardId: z.string().optional(),
    dateCreated: z.string().optional(),
  })
  .passthrough();

/** Schema for dashboard list items (lightweight, from GET /dashboards/) */
export const DashboardListItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    dateCreated: z.string().optional(),
    createdBy: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    widgetDisplay: z.array(z.string()).optional(),
  })
  .passthrough();

/** Schema for full dashboard detail (from GET /dashboards/{id}/) */
export const DashboardDetailSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    widgets: z.array(DashboardWidgetSchema).optional(),
    dateCreated: z.string().optional(),
    createdBy: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    projects: z.array(z.number()).optional(),
    environment: z.array(z.string()).optional(),
    period: z.string().nullable().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardWidgetQuery = z.infer<typeof DashboardWidgetQuerySchema>;
export type DashboardWidgetLayout = z.infer<typeof DashboardWidgetLayoutSchema>;
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;
export type DashboardListItem = z.infer<typeof DashboardListItemSchema>;
export type DashboardDetail = z.infer<typeof DashboardDetailSchema>;

// ---------------------------------------------------------------------------
// Strict input schema for user-authored widgets
// ---------------------------------------------------------------------------

/**
 * Strict schema for user-authored widget JSON (create/add/edit input).
 * Validates displayType and widgetType against known Sentry enums.
 * Defaults widgetType to "spans" when not provided.
 *
 * Use DashboardWidgetSchema (permissive) for parsing server responses.
 */
export const DashboardWidgetInputSchema = z
  .object({
    title: z.string(),
    displayType: z.enum(DISPLAY_TYPES),
    widgetType: z.enum(WIDGET_TYPES).default(DEFAULT_WIDGET_TYPE),
    interval: z.string().optional(),
    queries: z.array(DashboardWidgetQuerySchema).optional(),
    layout: DashboardWidgetLayoutSchema.optional(),
    thresholds: z.unknown().optional(),
    limit: z.number().nullable().optional(),
  })
  .passthrough();

/**
 * Parse and validate user-authored widget JSON with strict enum checks.
 * Throws ValidationError with actionable messages listing valid values.
 *
 * @param raw - Raw parsed JSON from user's widget file
 * @returns Validated widget with widgetType defaulted to "spans" if omitted
 */
export function parseWidgetInput(raw: unknown): DashboardWidget {
  const result = DashboardWidgetInputSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    if (issue.path.includes("displayType")) {
      return `Invalid displayType. Valid values: ${DISPLAY_TYPES.join(", ")}`;
    }
    if (issue.path.includes("widgetType")) {
      return `Invalid widgetType. Valid values: ${WIDGET_TYPES.join(", ")}`;
    }
    return `${issue.path.join(".")}: ${issue.message}`;
  });
  throw new ValidationError(
    `Invalid widget definition:\n${issues.join("\n")}`,
    "widget-json"
  );
}

// ---------------------------------------------------------------------------
// Aggregate functions & search filter enums
// ---------------------------------------------------------------------------

/**
 * Public aggregate functions available in the spans dataset (default for dashboard widgets).
 * These are the function names users pass to --query (e.g. `--query count`, `--query p95:span.duration`).
 *
 * Source: getsentry/sentry spans_indexed.py SpansIndexedDatasetConfig.function_converter
 * https://github.com/getsentry/sentry/blob/master/src/sentry/search/events/datasets/spans_indexed.py#L89-L363
 *
 * Aliases (sps→eps, spm→epm) defined in constants.py SPAN_FUNCTION_ALIASES:
 * https://github.com/getsentry/sentry/blob/master/src/sentry/search/events/constants.py#L334
 */
export const SPAN_AGGREGATE_FUNCTIONS = [
  "count",
  "count_unique",
  "sum",
  "avg",
  "percentile",
  "p50",
  "p75",
  "p90",
  "p95",
  "p99",
  "p100",
  "eps",
  "epm",
  "sps",
  "spm",
  "any",
  "min",
  "max",
] as const;

export type SpanAggregateFunction = (typeof SPAN_AGGREGATE_FUNCTIONS)[number];

/**
 * Additional aggregate functions from the discover dataset.
 * Available when widgetType is "discover" or "error-events".
 *
 * Source: getsentry/sentry discover.py DiscoverDatasetConfig.function_converter
 * https://github.com/getsentry/sentry/blob/master/src/sentry/search/events/datasets/discover.py#L188-L1095
 *
 * Aliases (tpm→epm, tps→eps) defined in constants.py FUNCTION_ALIASES:
 * https://github.com/getsentry/sentry/blob/master/src/sentry/search/events/constants.py#L325-L328
 */
export const DISCOVER_AGGREGATE_FUNCTIONS = [
  ...SPAN_AGGREGATE_FUNCTIONS,
  "failure_count",
  "failure_rate",
  "apdex",
  "count_miserable",
  "user_misery",
  "count_web_vitals",
  "count_if",
  "count_at_least",
  "last_seen",
  "latest_event",
  "var",
  "stddev",
  "cov",
  "corr",
  "performance_score",
  "opportunity_score",
  "count_scores",
  "tpm",
  "tps",
] as const;

export type DiscoverAggregateFunction =
  (typeof DISCOVER_AGGREGATE_FUNCTIONS)[number];

/** Zod schema for validating a span aggregate function name */
export const SpanAggregateFunctionSchema = z.enum(SPAN_AGGREGATE_FUNCTIONS);

/** Zod schema for validating a discover aggregate function name */
export const DiscoverAggregateFunctionSchema = z.enum(
  DISCOVER_AGGREGATE_FUNCTIONS
);

/**
 * Valid `is:` filter values for issue search conditions (--where flag).
 * Only valid when widgetType is "issue". Other datasets don't support `is:`.
 *
 * Status values from GroupStatus:
 * https://github.com/getsentry/sentry/blob/master/src/sentry/models/group.py#L196-L204
 *
 * Substatus values from SUBSTATUS_UPDATE_CHOICES:
 * https://github.com/getsentry/sentry/blob/master/src/sentry/types/group.py#L33-L41
 *
 * Assignment/link filters from is_filter_translation:
 * https://github.com/getsentry/sentry/blob/master/src/sentry/issues/issue_search.py#L45-L51
 */
export const IS_FILTER_VALUES = [
  // Status (GroupStatus)
  "resolved",
  "unresolved",
  "ignored",
  "archived",
  "muted",
  "reprocessing",
  // Substatus (GroupSubStatus)
  "escalating",
  "ongoing",
  "regressed",
  "new",
  "archived_until_escalating",
  "archived_until_condition_met",
  "archived_forever",
  // Assignment & linking
  "assigned",
  "unassigned",
  "for_review",
  "linked",
  "unlinked",
] as const;

export type IsFilterValue = (typeof IS_FILTER_VALUES)[number];

/** Zod schema for validating an `is:` filter value */
export const IsFilterValueSchema = z.enum(IS_FILTER_VALUES);

// ---------------------------------------------------------------------------
// Aggregate & sort parsing (quote-free CLI shorthand)
// ---------------------------------------------------------------------------

/**
 * Parse a shorthand aggregate expression into Sentry query syntax.
 * Accepts three formats:
 *   "count"              → "count()"
 *   "p95:span.duration"  → "p95(span.duration)"
 *   "count()"            → "count()"  (passthrough if already has parens)
 */
export function parseAggregate(input: string): string {
  if (input.includes("(")) {
    return input;
  }
  const colonIdx = input.indexOf(":");
  if (colonIdx > 0) {
    return `${input.slice(0, colonIdx)}(${input.slice(colonIdx + 1)})`;
  }
  return `${input}()`;
}

/**
 * Parse a sort expression with optional `-` prefix for descending.
 * Uses the same shorthand as {@link parseAggregate}.
 *   "-count"             → "-count()"
 *   "p95:span.duration"  → "p95(span.duration)"
 *   "-p95:span.duration" → "-p95(span.duration)"
 */
export function parseSortExpression(input: string): string {
  if (input.startsWith("-")) {
    return `-${parseAggregate(input.slice(1))}`;
  }
  return parseAggregate(input);
}

// ---------------------------------------------------------------------------
// Query preparation for Sentry API
// ---------------------------------------------------------------------------

/** Maximum result limits by display type */
const MAX_LIMITS: Partial<Record<string, number>> = {
  table: 10,
  bar: 10,
};

/**
 * Prepare widget queries for the Sentry API.
 * Auto-computes `fields` from columns + aggregates.
 * Defaults `conditions` to "" when missing.
 * Enforces per-display-type limit maximums.
 */
export function prepareWidgetQueries(widget: DashboardWidget): DashboardWidget {
  // Enforce limit maximums
  const maxLimit = MAX_LIMITS[widget.displayType];
  if (
    maxLimit !== undefined &&
    widget.limit !== undefined &&
    widget.limit !== null &&
    widget.limit > maxLimit
  ) {
    throw new ValidationError(
      `The maximum limit for ${widget.displayType} widgets is ${maxLimit}. Got: ${widget.limit}.`,
      "limit"
    );
  }

  if (!widget.queries) {
    return widget;
  }
  return {
    ...widget,
    queries: widget.queries.map((q) => ({
      ...q,
      conditions: q.conditions ?? "",
      fields: q.fields ?? [...(q.columns ?? []), ...(q.aggregates ?? [])],
    })),
  };
}

// ---------------------------------------------------------------------------
// Auto-layout utilities
// ---------------------------------------------------------------------------

/** Sentry dashboard grid column count */
const GRID_COLUMNS = 6;

/** Default widget dimensions by displayType */
const DEFAULT_WIDGET_SIZE: Partial<
  Record<DisplayType, { w: number; h: number; minH: number }>
> = {
  big_number: { w: 2, h: 1, minH: 1 },
  line: { w: 3, h: 2, minH: 2 },
  area: { w: 3, h: 2, minH: 2 },
  bar: { w: 3, h: 2, minH: 2 },
  table: { w: 6, h: 2, minH: 2 },
};
const FALLBACK_SIZE = { w: 3, h: 2, minH: 2 };

/** Build a set of occupied grid cells and the max bottom edge from existing layouts. */
function buildOccupiedGrid(widgets: DashboardWidget[]): {
  occupied: Set<string>;
  maxY: number;
} {
  const occupied = new Set<string>();
  let maxY = 0;
  for (const w of widgets) {
    if (!w.layout) {
      continue;
    }
    const bottom = w.layout.y + w.layout.h;
    if (bottom > maxY) {
      maxY = bottom;
    }
    for (let y = w.layout.y; y < bottom; y++) {
      for (let x = w.layout.x; x < w.layout.x + w.layout.w; x++) {
        occupied.add(`${x},${y}`);
      }
    }
  }
  return { occupied, maxY };
}

/** Check whether a rectangle fits at a position without overlapping occupied cells. */
function regionFits(
  occupied: Set<string>,
  rect: { px: number; py: number; w: number; h: number }
): boolean {
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      if (occupied.has(`${rect.px + dx},${rect.py + dy}`)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Assign a default layout to a widget if it doesn't already have one.
 * Packs the widget into the first available space in a 6-column grid,
 * scanning rows top-to-bottom and left-to-right.
 *
 * @param widget - Widget that may be missing a layout
 * @param existingWidgets - Widgets already in the dashboard (used to compute placement)
 * @returns Widget with layout guaranteed
 */
export function assignDefaultLayout(
  widget: DashboardWidget,
  existingWidgets: DashboardWidget[]
): DashboardWidget {
  if (widget.layout) {
    return widget;
  }

  const { w, h, minH } =
    DEFAULT_WIDGET_SIZE[widget.displayType as DisplayType] ?? FALLBACK_SIZE;

  const { occupied, maxY } = buildOccupiedGrid(existingWidgets);

  // Scan rows to find the first position where the widget fits
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= GRID_COLUMNS - w; x++) {
      if (regionFits(occupied, { px: x, py: y, w, h })) {
        return { ...widget, layout: { x, y, w, h, minH } };
      }
    }
  }

  // No gap found — place below everything
  return { ...widget, layout: { x: 0, y: maxY, w, h, minH } };
}
