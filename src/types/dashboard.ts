/**
 * Dashboard types and schemas
 *
 * Zod schemas and TypeScript types for Sentry Dashboard API responses.
 * Includes utility functions for stripping server-generated fields
 * before PUT requests, and strict input validation for user-authored widgets.
 */

import { z } from "zod";

import { ValidationError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Widget type and display type enums
//
// Source: sentry/src/sentry/models/dashboard_widget.py
// Also in: @sentry/api types (cli/node_modules/@sentry/api/dist/types.gen.d.ts)
// ---------------------------------------------------------------------------

/**
 * Widget types (dataset selectors) the API still accepts for creation.
 *
 * Source: sentry/src/sentry/models/dashboard_widget.py DashboardWidgetTypes.TYPES
 */
export const WIDGET_TYPES = [
  "issue",
  "metrics",
  "error-events",
  "spans",
  "logs",
  "tracemetrics",
  "preprod-app-size",
] as const;

/**
 * Deprecated widget types rejected by the Sentry Dashboard API.
 *
 * - `discover` → use `error-events` for errors or `spans` for everything else
 * - `transaction-like` → use `spans` with `is_transaction:true` filter
 */
export const DEPRECATED_WIDGET_TYPES = [
  "discover",
  "transaction-like",
] as const;

export type DeprecatedWidgetType = (typeof DEPRECATED_WIDGET_TYPES)[number];

/**
 * All widget types including deprecated — used for parsing server responses
 * where existing dashboards may still reference old types.
 */
export const ALL_WIDGET_TYPES = [
  ...WIDGET_TYPES,
  ...DEPRECATED_WIDGET_TYPES,
] as const;

export type WidgetType = (typeof ALL_WIDGET_TYPES)[number];

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
 *
 * Accepts ALL_WIDGET_TYPES (including deprecated) so that editing existing
 * widgets with deprecated types (e.g., "discover") doesn't fail validation.
 * CLI-level rejection of deprecated types for new widgets is handled by
 * validateWidgetEnums() in resolve.ts.
 */
export const DashboardWidgetInputSchema = z
  .object({
    title: z.string(),
    displayType: z.enum(DISPLAY_TYPES),
    widgetType: z.enum(ALL_WIDGET_TYPES).default(DEFAULT_WIDGET_TYPE),
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
 * Aggregate function aliases resolved before validation.
 *
 * The Sentry events API silently resolves these, but the dashboard widget UI
 * only understands canonical function names from AggregationKey. Resolving
 * aliases here ensures widgets render correctly in the UI.
 *
 * Source: https://github.com/getsentry/sentry/blob/master/src/sentry/search/events/constants.py
 *   SPAN_FUNCTION_ALIASES: spm→epm, sps→eps
 *   FUNCTION_ALIASES: tpm→epm, tps→eps
 */
export const AGGREGATE_ALIASES: Record<string, string> = {
  spm: "epm",
  sps: "eps",
  tpm: "epm",
  tps: "eps",
};

/**
 * Canonical aggregate functions for the spans dataset (default for dashboard widgets).
 * These are the function names the dashboard UI can render in the "Visualize" dropdown.
 *
 * Source: https://github.com/getsentry/sentry/blob/master/static/app/utils/fields/index.ts (AggregationKey enum)
 * Dataset: https://github.com/getsentry/sentry/blob/master/src/sentry/search/events/datasets/spans_indexed.py
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
  "any",
  "min",
  "max",
] as const;

export type SpanAggregateFunction = (typeof SPAN_AGGREGATE_FUNCTIONS)[number];

/**
 * Additional aggregate functions from the discover dataset.
 * Available when widgetType is "discover" or "error-events".
 *
 * Source: https://github.com/getsentry/sentry/blob/master/static/app/utils/fields/index.ts (AggregationKey enum)
 * Dataset: https://github.com/getsentry/sentry/blob/master/src/sentry/search/events/datasets/discover.py
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
 * Valid display types per widget dataset.
 *
 * Source: sentry/static/app/views/dashboards/datasetConfig/ @ a42668e87cc8a0b7410ac2acecee6074c52f376f
 * Each entry mirrors `supportedDisplayTypes` from the corresponding config:
 *
 *   issues.tsx         https://github.com/getsentry/sentry/blob/a42668e87cc8a0b7410ac2acecee6074c52f376f/static/app/views/dashboards/datasetConfig/issues.tsx#L90-L95
 *   spans.tsx          https://github.com/getsentry/sentry/blob/a42668e87cc8a0b7410ac2acecee6074c52f376f/static/app/views/dashboards/datasetConfig/spans.tsx#L287-L297
 *   errors.tsx         https://github.com/getsentry/sentry/blob/a42668e87cc8a0b7410ac2acecee6074c52f376f/static/app/views/dashboards/datasetConfig/errors.tsx#L115-L123
 *   transactions.tsx   https://github.com/getsentry/sentry/blob/a42668e87cc8a0b7410ac2acecee6074c52f376f/static/app/views/dashboards/datasetConfig/transactions.tsx#L76-L84
 *   releases.tsx       https://github.com/getsentry/sentry/blob/a42668e87cc8a0b7410ac2acecee6074c52f376f/static/app/views/dashboards/datasetConfig/releases.tsx#L90-L98
 *   logs.tsx           https://github.com/getsentry/sentry/blob/a42668e87cc8a0b7410ac2acecee6074c52f376f/static/app/views/dashboards/datasetConfig/logs.tsx#L201-L209
 *   traceMetrics.tsx   https://github.com/getsentry/sentry/blob/a42668e87cc8a0b7410ac2acecee6074c52f376f/static/app/views/dashboards/datasetConfig/traceMetrics.tsx#L285-L291
 *   mobileAppSize.tsx  https://github.com/getsentry/sentry/blob/a42668e87cc8a0b7410ac2acecee6074c52f376f/static/app/views/dashboards/datasetConfig/mobileAppSize.tsx#L255
 *
 * stacked_area is included for datasets that support timeseries (not in Sentry's UI picker
 * but accepted by the API and handled by the CLI's query engine).
 * details and server_tree are spans-only internal display types.
 *
 * Four display types are intentionally absent from this map — they bypass Sentry's standard
 * dataset query system and carry no dataset constraints:
 *   text                 — renders markdown; no dataset or query involved; user-editable
 *   wheel                — Web Vitals ring chart; prebuilt dashboards only, not user-editable
 *   rage_and_dead_clicks — rage/dead click viz; prebuilt only, fetches its own data
 *   agents_traces_table  — AI agent traces; prebuilt only, fetches its own data
 * Source: static/app/views/dashboards/utils.tsx (widgetFetchesOwnData / isWidgetEditable)
 */
export const DATASET_SUPPORTED_DISPLAY_TYPES = {
  issue: ["table", "area", "line", "bar"],
  spans: [
    "area",
    "bar",
    "big_number",
    "categorical_bar",
    "line",
    "stacked_area",
    "table",
    "top_n",
    "details",
    "server_tree",
  ],
  "error-events": [
    "area",
    "bar",
    "big_number",
    "categorical_bar",
    "line",
    "stacked_area",
    "table",
    "top_n",
  ],
  "transaction-like": [
    "area",
    "bar",
    "big_number",
    "categorical_bar",
    "line",
    "stacked_area",
    "table",
    "top_n",
  ],
  metrics: [
    "area",
    "bar",
    "big_number",
    "categorical_bar",
    "line",
    "stacked_area",
    "table",
    "top_n",
  ],
  logs: [
    "area",
    "bar",
    "big_number",
    "categorical_bar",
    "line",
    "stacked_area",
    "table",
    "top_n",
  ],
  discover: [
    "area",
    "bar",
    "big_number",
    "categorical_bar",
    "line",
    "stacked_area",
    "table",
    "top_n",
  ],
  tracemetrics: ["area", "bar", "big_number", "categorical_bar", "line"],
  "preprod-app-size": ["line"],
} as const satisfies Record<WidgetType, readonly string[]>;

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
 * Resolves aliases (spm→epm, tpm→epm, etc.) so widgets render in the dashboard UI.
 *
 * Accepts three formats:
 *   "count"              → "count()"
 *   "p95:span.duration"  → "p95(span.duration)"
 *   "count()"            → "count()"  (passthrough if already has parens)
 *   "spm"                → "epm()"    (alias resolved)
 */
export function parseAggregate(input: string): string {
  if (input.includes("(")) {
    // Resolve aliases even in paren form: spm() → epm(), tpm(x) → epm(x)
    const parenIdx = input.indexOf("(");
    const fn = input.slice(0, parenIdx);
    const alias = AGGREGATE_ALIASES[fn];
    return alias ? `${alias}${input.slice(parenIdx)}` : input;
  }
  const colonIdx = input.indexOf(":");
  if (colonIdx > 0) {
    const fn = input.slice(0, colonIdx);
    const resolved = AGGREGATE_ALIASES[fn] ?? fn;
    return `${resolved}(${input.slice(colonIdx + 1)})`;
  }
  const resolved = AGGREGATE_ALIASES[input] ?? input;
  return `${resolved}()`;
}

/**
 * Extract the function name from a parsed aggregate string.
 *   "count()"              → "count"
 *   "p95(span.duration)"   → "p95"
 */
function extractFunctionName(aggregate: string): string {
  const parenIdx = aggregate.indexOf("(");
  return parenIdx > 0 ? aggregate.slice(0, parenIdx) : aggregate;
}

/**
 * Extract the argument from a parsed aggregate string.
 *   "count()"              → ""
 *   "p95(span.duration)"   → "span.duration"
 *   "avg(g:custom/foo@b)"  → "g:custom/foo@b"
 */
function extractAggregateArg(aggregate: string): string {
  const openIdx = aggregate.indexOf("(");
  const closeIdx = aggregate.lastIndexOf(")");
  if (openIdx < 0 || closeIdx <= openIdx) {
    return "";
  }
  return aggregate.slice(openIdx + 1, closeIdx);
}

// ---------------------------------------------------------------------------
// MRI (Metric Resource Identifier) detection
//
// Port of Sentry's canonical Python parser:
//   sentry/src/sentry/snuba/metrics/naming_layer/mri.py
//
// MRI format: <entity>:<namespace>/<name>@<unit>
//   entity: "c" (counter), "d" (distribution), "g" (gauge), "s" (set),
//           "e" (extracted), or multi-char like "dist"
//   namespace: "sessions", "transactions", "spans", "custom", etc.
//   name: metric name, e.g. "duration", "measurements.fcp"
//   unit: "none", "millisecond", "byte", "byte/second", etc.
// ---------------------------------------------------------------------------

/**
 * Regex matching the MRI schema format.
 *
 * Uses the same permissive `[^:]+` entity pattern as the canonical Python parser
 * so it catches multi-char entity codes like "dist" in addition to the standard
 * single-letter codes (c, d, g, s, e).
 */
const MRI_RE =
  /^(?<entity>[^:]+):(?<namespace>[^/]+)\/(?<name>[^@]+)@(?<unit>.+)$/;

/** Parsed components of an MRI string */
export type ParsedMri = {
  /** Entity type code (e.g. "c", "d", "g", "s", "e", or "dist") */
  entity: string;
  /** Metric namespace (e.g. "custom", "sessions", "transactions") */
  namespace: string;
  /** Metric name (e.g. "duration", "node.runtime.mem.rss") */
  name: string;
  /** Metric unit (e.g. "byte", "millisecond", "none") */
  unit: string;
};

/**
 * Parse an MRI (Metric Resource Identifier) string into its components.
 *
 * Port of Sentry's `parse_mri` from `sentry/snuba/metrics/naming_layer/mri.py`.
 *
 * @returns Parsed MRI components, or null if the input doesn't match MRI format
 */
export function parseMri(input: string): ParsedMri | null {
  const match = MRI_RE.exec(input);
  if (!match?.groups) {
    return null;
  }
  const { entity, namespace, name, unit } = match.groups;
  if (!(entity && namespace && name && unit)) {
    return null;
  }
  return { entity, namespace, name, unit };
}

/** Maps known MRI entity codes to human-readable tracemetrics type names */
const MRI_ENTITY_TYPE_NAMES: Record<string, string> = {
  c: "counter",
  d: "distribution",
  g: "gauge",
  s: "set",
  e: "extracted",
};

/**
 * Check aggregates for MRI syntax and throw a ValidationError with guidance
 * on using `--dataset tracemetrics` with the correct query format.
 *
 * MRI queries like `avg(g:custom/node.runtime.mem.rss@byte)` pass function-name
 * validation (since "avg" is valid) but produce widgets that render as
 * "Internal Error" in the Sentry dashboard UI.
 *
 * @param aggregates - Parsed aggregate strings to check
 * @param dataset - Current dataset flag value (for context in error message)
 */
function rejectMriQueries(aggregates: string[], dataset?: string): void {
  for (const agg of aggregates) {
    const arg = extractAggregateArg(agg);
    const mri = parseMri(arg);
    if (!mri) {
      continue;
    }

    const fn = extractFunctionName(agg);
    const typeName = MRI_ENTITY_TYPE_NAMES[mri.entity] ?? mri.entity;
    const suggestion = `${fn}(value,${mri.name},${typeName},${mri.unit})`;
    const datasetNote =
      dataset === "tracemetrics"
        ? ""
        : `\nUse --dataset tracemetrics instead of --dataset ${dataset ?? "spans"}.`;

    throw new ValidationError(
      `MRI query syntax is not supported for dashboard widgets: "${agg}".\n\n` +
        "Use the tracemetrics query format instead:\n" +
        `  --query '${suggestion}'${datasetNote}\n\n` +
        "Tracemetrics format: fn(value,<metric_name>,<type>,<unit>)",
      "query"
    );
  }
}

/**
 * Validate that all aggregate function names in a list are known.
 * Also rejects MRI (Metric Resource Identifier) syntax with guidance
 * on the correct tracemetrics query format.
 * Throws a ValidationError listing valid functions if any are invalid.
 *
 * @param aggregates - Parsed aggregate strings (e.g. ["count()", "p95(span.duration)"])
 * @param dataset - Widget dataset, determines which function list to validate against
 */
export function validateAggregateNames(
  aggregates: string[],
  dataset?: string
): void {
  // Detect MRI syntax early — it passes function-name validation (e.g. "avg" is valid)
  // but produces widgets that render as "Internal Error" in the dashboard UI.
  rejectMriQueries(aggregates, dataset);

  const validFunctions: readonly string[] =
    dataset === "discover" || dataset === "error-events"
      ? DISCOVER_AGGREGATE_FUNCTIONS
      : SPAN_AGGREGATE_FUNCTIONS;

  for (const agg of aggregates) {
    const fn = extractFunctionName(agg);
    if (!validFunctions.includes(fn)) {
      const aliasList = Object.entries(AGGREGATE_ALIASES)
        .map(([from, to]) => `${from}→${to}`)
        .join(", ");
      throw new ValidationError(
        `Unknown aggregate function "${fn}".\n\n` +
          `Valid functions: ${validFunctions.join(", ")}\n` +
          `Aliases (auto-resolved): ${aliasList}`,
        "query"
      );
    }
  }
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
 * Clamps per-display-type limits to their maximums with a warning.
 */
export function prepareWidgetQueries(
  inputWidget: DashboardWidget
): DashboardWidget {
  let widget = inputWidget;
  // Clamp to per-display-type limit maximums
  const maxLimit = MAX_LIMITS[widget.displayType];
  if (
    maxLimit !== undefined &&
    widget.limit !== undefined &&
    widget.limit !== null &&
    widget.limit > maxLimit
  ) {
    logger.warn(
      `${widget.displayType} widgets support a maximum of ${maxLimit} rows. Clamping --limit from ${widget.limit} to ${maxLimit}.`
    );
    widget = { ...widget, limit: maxLimit };
  }

  if (!widget.queries) {
    return widget;
  }
  return {
    ...widget,
    queries: widget.queries.map((q) => ({
      ...q,
      conditions: q.conditions ?? "",
      fields: q.fields?.length
        ? q.fields
        : [...(q.columns ?? []), ...(q.aggregates ?? [])],
    })),
  };
}

// ---------------------------------------------------------------------------
// Auto-layout utilities
// ---------------------------------------------------------------------------

/** Sentry dashboard grid column count */
export const GRID_COLUMNS = 6;

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

/**
 * Fallback layout for widgets without an existing layout.
 * Used when merging explicit layout flags over a widget that has no layout set.
 * Position defaults to origin (0,0) with standard 3×2 dimensions.
 */
export const FALLBACK_LAYOUT: DashboardWidgetLayout = {
  x: 0,
  y: 0,
  ...FALLBACK_SIZE,
};

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

// ---------------------------------------------------------------------------
// Layout validation
// ---------------------------------------------------------------------------

/** Shared layout flags accepted by widget add and edit commands */
export type WidgetLayoutFlags = {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
};

/** Assert a layout value is a non-negative integer within an optional upper bound */
function assertLayoutInt(
  value: number,
  flag: string,
  min: number,
  max?: number
): void {
  if (!Number.isInteger(value) || value < min) {
    throw new ValidationError(
      `--${flag} must be ${min === 0 ? "a non-negative" : "a positive"} integer (got ${value}).`,
      flag
    );
  }
  if (max !== undefined && value > max) {
    throw new ValidationError(
      `--${flag} must be ${min}–${max} (dashboard grid is ${GRID_COLUMNS} columns wide).`,
      flag
    );
  }
}

/**
 * Validate layout flag values against the 6-column dashboard grid.
 *
 * Checks that position and size values are within the valid range and
 * that the widget fits within the grid columns. Validates each provided
 * flag independently, and cross-validates x + width when both are known.
 *
 * @param flags - Layout flags from the command
 * @param existing - Existing widget layout (used for cross-validation when only one dimension is provided)
 */
export function validateWidgetLayout(
  flags: WidgetLayoutFlags,
  existing?: DashboardWidgetLayout
): void {
  if (flags.x !== undefined) {
    assertLayoutInt(flags.x, "x", 0, GRID_COLUMNS - 1);
  }
  if (flags.y !== undefined) {
    assertLayoutInt(flags.y, "y", 0);
  }
  if (flags.width !== undefined) {
    assertLayoutInt(flags.width, "width", 1, GRID_COLUMNS);
  }
  if (flags.height !== undefined) {
    assertLayoutInt(flags.height, "height", 1);
  }

  // Cross-validate x + width doesn't overflow the grid
  const effectiveX = flags.x ?? existing?.x;
  const effectiveW = flags.width ?? existing?.w;
  if (
    effectiveX !== undefined &&
    effectiveW !== undefined &&
    effectiveX + effectiveW > GRID_COLUMNS
  ) {
    throw new ValidationError(
      `Widget overflows the grid: x(${effectiveX}) + width(${effectiveW}) = ${effectiveX + effectiveW}, but the grid is ${GRID_COLUMNS} columns wide.`,
      "x"
    );
  }
}

// ---------------------------------------------------------------------------
// Server field stripping utilities
//
// The Sentry dashboard API returns many extra fields via GET that should NOT
// be sent back in PUT requests. Using an allowlist approach ensures only
// fields the API accepts are included, avoiding silent rejection of widgets.
// ---------------------------------------------------------------------------

/** Extract only the query fields the PUT API accepts */
function cleanQuery(q: DashboardWidgetQuery): DashboardWidgetQuery {
  return {
    name: q.name ?? "",
    conditions: q.conditions ?? "",
    columns: q.columns ?? [],
    aggregates: q.aggregates ?? [],
    fields: q.fields ?? [],
    ...(q.fieldAliases && { fieldAliases: q.fieldAliases }),
    ...(q.orderby && { orderby: q.orderby }),
  };
}

/**
 * Strip server-generated and passthrough fields from a widget for PUT requests.
 *
 * Uses an allowlist approach: only includes fields the dashboard PUT API
 * accepts. The GET response includes many extra fields (description, thresholds,
 * interval, axisRange, datasetSource, etc.) that cause silent failures if
 * sent back in PUT.
 *
 * @param widget - Widget object from GET response
 * @returns Widget safe for PUT (only API-accepted fields)
 */
export function stripWidgetServerFields(
  widget: DashboardWidget
): DashboardWidget {
  const cleaned: DashboardWidget = {
    title: widget.title,
    displayType: widget.displayType,
    ...(widget.widgetType && { widgetType: widget.widgetType }),
    ...(widget.queries && { queries: widget.queries.map(cleanQuery) }),
    ...(widget.limit !== undefined &&
      widget.limit !== null && { limit: widget.limit }),
  };

  // Preserve layout (x, y, w, h, minH only — not isResizable)
  if (widget.layout) {
    cleaned.layout = {
      x: widget.layout.x,
      y: widget.layout.y,
      w: widget.layout.w,
      h: widget.layout.h,
      ...(widget.layout.minH !== undefined && { minH: widget.layout.minH }),
    };
  }

  return cleaned;
}

/**
 * Prepare a full dashboard for PUT update.
 * Strips server-generated fields from all widgets while preserving
 * widgetType, displayType, and layout.
 *
 * @param dashboard - Dashboard detail from GET response
 * @returns Object with title and cleaned widgets, ready for PUT body
 */
export function prepareDashboardForUpdate(dashboard: DashboardDetail): {
  title: string;
  widgets: DashboardWidget[];
  projects?: number[];
  environment?: string[];
  period?: string | null;
} {
  return {
    title: dashboard.title,
    widgets: (dashboard.widgets ?? []).map(stripWidgetServerFields),
    projects: dashboard.projects,
    environment: dashboard.environment,
    period: dashboard.period,
  };
}

// ---------------------------------------------------------------------------
// Widget data query types
//
// Types for responses from the events-stats and events API endpoints
// used to fetch actual widget data for dashboard rendering.
// ---------------------------------------------------------------------------

/**
 * Single data point from the events-stats API.
 * Format: [timestamp_epoch_seconds, [{count: value}]]
 */
export const EventsStatsDataPointSchema = z.tuple([
  z.number(),
  z.array(z.object({ count: z.number() })),
]);

export type EventsStatsDataPoint = z.infer<typeof EventsStatsDataPointSchema>;

/**
 * A single time-series from events-stats.
 *
 * In simple queries this is the top-level response.
 * In grouped queries (`topEvents > 0`) each group key maps to one of these.
 */
export const EventsStatsSeriesSchema = z
  .object({
    data: z.array(EventsStatsDataPointSchema),
    order: z.number().optional(),
    start: z.union([z.string(), z.number()]).optional(),
    end: z.union([z.string(), z.number()]).optional(),
    meta: z
      .object({
        fields: z.record(z.string()).optional(),
        units: z.record(z.string().nullable()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type EventsStatsSeries = z.infer<typeof EventsStatsSeriesSchema>;

/**
 * Response from `GET /organizations/{org}/events/` (table format).
 *
 * Used by table, big_number, and top_n widget types.
 */
export const EventsTableResponseSchema = z.object({
  data: z.array(z.record(z.unknown())),
  meta: z
    .object({
      fields: z.record(z.string()).optional(),
      units: z.record(z.string().nullable()).optional(),
    })
    .optional(),
});

export type EventsTableResponse = z.infer<typeof EventsTableResponseSchema>;

// ---------------------------------------------------------------------------
// Widget data result types — discriminated union for all widget outputs
// ---------------------------------------------------------------------------

/** Time-series data for chart widgets (line, area, bar) */
export type TimeseriesResult = {
  type: "timeseries";
  series: {
    label: string;
    values: { timestamp: number; value: number }[];
    unit?: string | null;
  }[];
};

/** Tabular data for table and top_n widgets */
export type TableResult = {
  type: "table";
  columns: { name: string; type?: string; unit?: string | null }[];
  rows: Record<string, unknown>[];
};

/** Single scalar value for big_number widgets */
export type ScalarResult = {
  type: "scalar";
  value: number;
  previousValue?: number;
  unit?: string | null;
};

/** Widget type not supported for data fetching */
export type UnsupportedResult = {
  type: "unsupported";
  reason: string;
};

/** Widget query failed */
export type ErrorResult = {
  type: "error";
  message: string;
};

/**
 * Result of querying a widget's data.
 *
 * Discriminated on `type` to determine how to render:
 * - `timeseries` → sparkline charts
 * - `table` → text table
 * - `scalar` → big number display
 * - `unsupported` → placeholder message
 * - `error` → error message
 */
export type WidgetDataResult =
  | TimeseriesResult
  | TableResult
  | ScalarResult
  | UnsupportedResult
  | ErrorResult;

// ---------------------------------------------------------------------------
// Dataset mapping
// ---------------------------------------------------------------------------

/**
 * Maps widget types to API dataset parameter values.
 *
 * Widget types that don't map to a dataset (issue, metrics, etc.)
 * return null and are rendered as "unsupported".
 */
const WIDGET_TYPE_TO_DATASET: Record<string, string> = {
  spans: "spans",
  discover: "discover",
  "error-events": "errors",
  "transaction-like": "transactions",
  logs: "logs",
};

/**
 * Map a widget's `widgetType` to the API `dataset` parameter.
 *
 * @param widgetType - The widget's dataset type (e.g., "spans", "discover")
 * @returns The API dataset string, or null if the type isn't queryable
 */
export function mapWidgetTypeToDataset(
  widgetType: string | undefined
): string | null {
  if (!widgetType) {
    return null;
  }
  return WIDGET_TYPE_TO_DATASET[widgetType] ?? null;
}

/** Display types that use time-series data (events-stats endpoint) */
export const TIMESERIES_DISPLAY_TYPES = new Set([
  "line",
  "area",
  "stacked_area",
  "bar",
  "categorical_bar",
]);

/** Display types that use tabular data (events endpoint) */
export const TABLE_DISPLAY_TYPES = new Set(["table", "top_n"]);
