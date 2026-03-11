/**
 * Trace-specific formatters
 *
 * Provides formatting utilities for displaying Sentry traces in the CLI.
 * Includes flat span utilities for `span list` and `span view` commands.
 */

import type { TraceSpan, TransactionListItem } from "../../types/index.js";
import { muted } from "./colors.js";
import { formatRelativeTime } from "./human.js";
import {
  escapeMarkdownCell,
  isPlainOutput,
  mdKvTable,
  mdRow,
  mdTableHeader,
  renderInlineMarkdown,
  renderMarkdown,
  stripColorTags,
} from "./markdown.js";
import { type Column, writeTable } from "./table.js";
import { renderTextTable } from "./text-table.js";

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * - < 1s: "245ms"
 * - < 60s: "1.24s"
 * - >= 60s: "2m 15s"
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatTraceDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    // Check if toFixed(2) would round up to 60.00s
    const secs = Number((ms / 1000).toFixed(2));
    if (secs < 60) {
      return `${secs.toFixed(2)}s`;
    }
    // Fall through to minutes format
  }
  // Round total seconds first, then split into mins/secs to avoid "Xm 60s"
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}m ${secs}s`;
}

/** Column headers for the streaming trace table (`:` suffix = right-aligned) */
const TRACE_TABLE_COLS = ["Trace ID", "Transaction", "Duration:", "When"];

/**
 * Extract the four cell values for a trace row.
 *
 * Shared by {@link formatTraceRow} (streaming) and {@link formatTraceTable}
 * (batch) so cell formatting stays consistent between the two paths.
 *
 * @param item - Transaction list item from the API
 * @returns `[traceId, transaction, duration, when]` markdown-safe strings
 */
export function buildTraceRowCells(
  item: TransactionListItem
): [string, string, string, string] {
  return [
    `\`${item.trace}\``,
    escapeMarkdownCell(item.transaction || "unknown"),
    formatTraceDuration(item["transaction.duration"]),
    formatRelativeTime(item.timestamp),
  ];
}

/**
 * Format a single transaction row for streaming output (follow/live mode).
 *
 * In plain mode (non-TTY / `SENTRY_PLAIN_OUTPUT=1`): emits a markdown table
 * row so streamed output composes into a valid CommonMark document.
 * In rendered mode (TTY): emits ANSI-styled text via `mdRow`.
 *
 * @param item - Transaction list item from the API
 * @returns Formatted row string with newline
 */
export function formatTraceRow(item: TransactionListItem): string {
  return mdRow(buildTraceRowCells(item));
}

/**
 * Format column header for traces list in plain (non-TTY) mode.
 *
 * Emits a proper markdown table header + separator row so that
 * the streamed rows compose into a valid CommonMark document when redirected.
 * In TTY mode, use StreamingTable for row-by-row output instead.
 *
 * @returns Header string (includes trailing newline)
 */
export function formatTracesHeader(): string {
  return `${mdTableHeader(TRACE_TABLE_COLS)}\n`;
}

/**
 * Build a rendered markdown table for a batch list of trace transactions.
 *
 * Uses {@link buildTraceRowCells} to share cell formatting with
 * {@link formatTraceRow}. Pre-rendered ANSI codes are preserved through the
 * pipeline via cli-table3's `string-width`-aware column sizing.
 *
 * @param items - Transaction list items from the API
 * @returns Rendered terminal string with Unicode-bordered table
 */
export function formatTraceTable(items: TransactionListItem[]): string {
  if (isPlainOutput()) {
    const rows = items
      .map((item) => mdRow(buildTraceRowCells(item)).trimEnd())
      .join("\n");
    return `${stripColorTags(mdTableHeader(TRACE_TABLE_COLS))}\n${rows}\n`;
  }
  const headers = TRACE_TABLE_COLS.map((c) =>
    c.endsWith(":") ? c.slice(0, -1) : c
  );
  const rows = items.map((item) =>
    buildTraceRowCells(item).map((c) => renderInlineMarkdown(c))
  );
  const alignments = TRACE_TABLE_COLS.map((c) =>
    c.endsWith(":") ? ("right" as const) : ("left" as const)
  );
  return renderTextTable(headers, rows, { alignments });
}

/** Trace summary computed from a span tree */
export type TraceSummary = {
  /** The 32-character trace ID */
  traceId: string;
  /** Total trace duration in milliseconds */
  duration: number;
  /** Total number of spans in the trace */
  spanCount: number;
  /** Project slugs involved in the trace */
  projects: string[];
  /** Root transaction name (e.g., "GET /api/users") */
  rootTransaction?: string;
  /** Root operation type (e.g., "http.server") */
  rootOp?: string;
  /** Trace start time as Unix timestamp (seconds) */
  startTimestamp: number;
};

/**
 * Check whether a timestamp from a span is usable for duration calculations.
 * Filters out zero, negative, NaN, and non-finite values that would corrupt
 * min/max computations.
 */
function isValidTimestamp(ts: number): boolean {
  return Number.isFinite(ts) && ts > 0;
}

/**
 * Recursively count spans and collect metadata from a span tree.
 */
function walkSpanTree(
  span: TraceSpan,
  isRoot: boolean,
  state: {
    spanCount: number;
    minStart: number;
    maxEnd: number;
    projects: Set<string>;
    rootTransaction?: string;
    rootOp?: string;
  }
): void {
  state.spanCount += 1;

  // Only use timestamps that are valid positive numbers.
  // Some spans have start_timestamp=0 or timestamp=0 which would corrupt
  // the min/max calculations and produce NaN/Infinity durations.
  if (isValidTimestamp(span.start_timestamp)) {
    state.minStart = Math.min(state.minStart, span.start_timestamp);
  }

  // The API may return `end_timestamp` instead of `timestamp` depending on
  // the span source. Prefer `end_timestamp` when present and non-zero,
  // fall back to `timestamp`. Use || so that 0 (invalid) falls through.
  const endTs = span.end_timestamp || span.timestamp;
  if (endTs !== undefined && isValidTimestamp(endTs)) {
    state.maxEnd = Math.max(state.maxEnd, endTs);
  }
  if (span.project_slug) {
    state.projects.add(span.project_slug);
  }
  if (isRoot && !state.rootTransaction) {
    state.rootTransaction = span.transaction ?? span.description ?? undefined;
    state.rootOp = span["transaction.op"] ?? span.op;
  }
  for (const child of span.children ?? []) {
    walkSpanTree(child, false, state);
  }
}

/**
 * Compute a summary from a trace span tree.
 * Walks the full tree to calculate duration, span count, and involved projects.
 *
 * Duration is computed from the min `start_timestamp` and max `end_timestamp`
 * (or `timestamp`) across all spans. Returns `NaN` duration when no valid
 * timestamps are found (e.g., all spans have `start_timestamp: 0`).
 *
 * @param traceId - The trace ID
 * @param spans - Root-level spans from the /trace/ API
 * @returns Computed trace summary (duration may be NaN if timestamps are missing)
 */
export function computeTraceSummary(
  traceId: string,
  spans: TraceSpan[]
): TraceSummary {
  const state = {
    spanCount: 0,
    minStart: Number.POSITIVE_INFINITY,
    maxEnd: 0,
    projects: new Set<string>(),
    rootTransaction: undefined as string | undefined,
    rootOp: undefined as string | undefined,
  };

  for (const span of spans) {
    walkSpanTree(span, true, state);
  }

  // If no valid timestamps were found, minStart stays at +Infinity and maxEnd stays at 0.
  // Produce NaN duration in that case so formatTraceDuration() renders "—".
  const hasValidRange =
    Number.isFinite(state.minStart) &&
    state.maxEnd > 0 &&
    state.maxEnd >= state.minStart;
  const duration = hasValidRange
    ? (state.maxEnd - state.minStart) * 1000
    : Number.NaN;

  return {
    traceId,
    duration,
    spanCount: state.spanCount,
    projects: [...state.projects],
    rootTransaction: state.rootTransaction,
    rootOp: state.rootOp,
    startTimestamp: state.minStart,
  };
}

/**
 * Format trace summary for human-readable display as rendered markdown.
 * Shows metadata including root transaction, duration, span count, and projects.
 *
 * @param summary - Computed trace summary
 * @returns Rendered terminal string
 */
export function formatTraceSummary(summary: TraceSummary): string {
  const kvRows: [string, string][] = [];

  if (summary.rootTransaction) {
    const opPrefix = summary.rootOp ? `[\`${summary.rootOp}\`] ` : "";
    kvRows.push([
      "Root",
      `${opPrefix}${escapeMarkdownCell(summary.rootTransaction)}`,
    ]);
  }
  kvRows.push(["Duration", formatTraceDuration(summary.duration)]);
  kvRows.push(["Spans", String(summary.spanCount)]);
  if (summary.projects.length > 0) {
    kvRows.push(["Projects", summary.projects.join(", ")]);
  }
  if (Number.isFinite(summary.startTimestamp) && summary.startTimestamp > 0) {
    const date = new Date(summary.startTimestamp * 1000);
    kvRows.push(["Started", date.toLocaleString("sv-SE")]);
  }

  const md = `## Trace \`${summary.traceId}\`\n\n${mdKvTable(kvRows)}\n`;
  return renderMarkdown(md);
}

// ---------------------------------------------------------------------------
// Flat span utilities (for span list / span view)
// ---------------------------------------------------------------------------

/**
 * Compute the duration of a span in milliseconds.
 * Prefers the API-provided `duration` field, falls back to timestamp arithmetic.
 *
 * @returns Duration in milliseconds, or undefined if not computable
 */
export function computeSpanDurationMs(span: TraceSpan): number | undefined {
  if (span.duration !== undefined && Number.isFinite(span.duration)) {
    return span.duration;
  }
  const endTs = span.end_timestamp || span.timestamp;
  if (endTs !== undefined && Number.isFinite(endTs)) {
    const ms = (endTs - span.start_timestamp) * 1000;
    return ms >= 0 ? ms : undefined;
  }
  return;
}

/** Flat span for list output — no nested children */
export type FlatSpan = {
  span_id: string;
  parent_span_id?: string | null;
  op?: string;
  description?: string | null;
  duration_ms?: number;
  start_timestamp: number;
  project_slug?: string;
  transaction?: string;
  depth: number;
  child_count: number;
};

/**
 * Flatten a hierarchical TraceSpan[] tree into a depth-first flat array.
 *
 * @param spans - Root-level spans from the /trace/ API
 * @returns Flat array with depth and child_count computed
 */
export function flattenSpanTree(spans: TraceSpan[]): FlatSpan[] {
  const result: FlatSpan[] = [];

  function walk(span: TraceSpan, depth: number): void {
    const children = span.children ?? [];
    result.push({
      span_id: span.span_id,
      parent_span_id: span.parent_span_id,
      op: span.op || span["transaction.op"],
      description: span.description || span.transaction,
      duration_ms: computeSpanDurationMs(span),
      start_timestamp: span.start_timestamp,
      project_slug: span.project_slug,
      transaction: span.transaction,
      depth,
      child_count: children.length,
    });
    for (const child of children) {
      walk(child, depth + 1);
    }
  }

  for (const span of spans) {
    walk(span, 0);
  }
  return result;
}

/** Result of finding a span by ID in the tree */
export type FoundSpan = {
  span: TraceSpan;
  depth: number;
  ancestors: TraceSpan[];
};

/**
 * Find a span by ID in the tree, returning the span, its depth, and ancestor chain.
 *
 * @param spans - Root-level spans from the /trace/ API
 * @param spanId - The span ID to search for
 * @returns Found span with depth and ancestors (root→parent), or null
 */
export function findSpanById(
  spans: TraceSpan[],
  spanId: string
): FoundSpan | null {
  function search(
    span: TraceSpan,
    depth: number,
    ancestors: TraceSpan[]
  ): FoundSpan | null {
    if (span.span_id === spanId) {
      return { span, depth, ancestors };
    }
    for (const child of span.children ?? []) {
      const found = search(child, depth + 1, [...ancestors, span]);
      if (found) {
        return found;
      }
    }
    return null;
  }

  for (const root of spans) {
    const found = search(root, 0, []);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Parsed span filter from a query string */
export type SpanFilter = {
  op?: string;
  project?: string;
  description?: string;
  minDuration?: number;
  maxDuration?: number;
};

/**
 * Parse a "-q" filter string into structured filters.
 *
 * Supports: `op:db`, `project:backend`, `description:fetch`,
 * `duration:>100ms`, `duration:<500ms`
 *
 * Bare words without a `:` prefix are treated as description filters.
 *
 * @param query - Raw query string
 * @returns Parsed filter
 */
export function parseSpanQuery(query: string): SpanFilter {
  const filter: SpanFilter = {};
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];

  for (const token of tokens) {
    applyQueryToken(filter, token);
  }
  return filter;
}

/**
 * Apply a single query token to a filter.
 * Bare words (no colon) are treated as description filters.
 */
function applyQueryToken(filter: SpanFilter, token: string): void {
  const colonIdx = token.indexOf(":");
  if (colonIdx === -1) {
    filter.description = token;
    return;
  }
  const key = token.slice(0, colonIdx).toLowerCase();
  let value = token.slice(colonIdx + 1);
  // Strip quotes
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }

  switch (key) {
    case "op":
      filter.op = value.toLowerCase();
      break;
    case "project":
      filter.project = value.toLowerCase();
      break;
    case "description":
      filter.description = value;
      break;
    case "duration": {
      const ms = parseDurationValue(value);
      if (ms !== null) {
        if (value.startsWith(">")) {
          filter.minDuration = ms;
        } else if (value.startsWith("<")) {
          filter.maxDuration = ms;
        }
      }
      break;
    }
    default:
      break;
  }
}

/** Regex to strip comparison operators from duration values */
const COMPARISON_OP_RE = /^[><]=?/;

/** Regex to parse a numeric duration with optional unit */
const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i;

/**
 * Parse a duration filter value like ">100ms", "<2s", ">500".
 * Returns the numeric milliseconds, or null if unparseable.
 */
function parseDurationValue(value: string): number | null {
  // Strip comparison operator
  const numStr = value.replace(COMPARISON_OP_RE, "");
  const match = numStr.match(DURATION_RE);
  if (!match || match[1] === undefined) {
    return null;
  }
  const num = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  switch (unit) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60_000;
    default:
      return num;
  }
}

/**
 * Test whether a single span matches all active filter criteria.
 */
function matchesFilter(span: FlatSpan, filter: SpanFilter): boolean {
  if (filter.op && !span.op?.toLowerCase().includes(filter.op)) {
    return false;
  }
  if (
    filter.project &&
    !span.project_slug?.toLowerCase().includes(filter.project)
  ) {
    return false;
  }
  if (filter.description) {
    const desc = (span.description || "").toLowerCase();
    if (!desc.includes(filter.description.toLowerCase())) {
      return false;
    }
  }
  if (
    filter.minDuration !== undefined &&
    (span.duration_ms === undefined || span.duration_ms < filter.minDuration)
  ) {
    return false;
  }
  if (
    filter.maxDuration !== undefined &&
    (span.duration_ms === undefined || span.duration_ms > filter.maxDuration)
  ) {
    return false;
  }
  return true;
}

/**
 * Apply a parsed filter to a flat span list.
 *
 * @param spans - Flat span array
 * @param filter - Parsed span filter
 * @returns Filtered array (does not mutate input)
 */
export function applySpanFilter(
  spans: FlatSpan[],
  filter: SpanFilter
): FlatSpan[] {
  return spans.filter((span) => matchesFilter(span, filter));
}

/** Column definitions for the flat span table */
const SPAN_TABLE_COLUMNS: Column<FlatSpan>[] = [
  {
    header: "Span ID",
    value: (s) => `\`${s.span_id}\``,
    minWidth: 18,
    shrinkable: false,
  },
  {
    header: "Op",
    value: (s) => escapeMarkdownCell(s.op || "—"),
    minWidth: 6,
  },
  {
    header: "Description",
    value: (s) => escapeMarkdownCell(s.description || "(no description)"),
    truncate: true,
  },
  {
    header: "Duration",
    value: (s) =>
      s.duration_ms !== undefined ? formatTraceDuration(s.duration_ms) : "—",
    align: "right",
    minWidth: 8,
    shrinkable: false,
  },
  {
    header: "Depth",
    value: (s) => String(s.depth),
    align: "right",
    minWidth: 5,
    shrinkable: false,
  },
];

/**
 * Write a flat span list as a formatted table.
 *
 * @param stdout - Output writer
 * @param spans - Flat span array to display
 */
export function writeSpanTable(
  stdout: { write(s: string): void },
  spans: FlatSpan[]
): void {
  writeTable(stdout, spans, SPAN_TABLE_COLUMNS, { truncate: true });
}

/**
 * Build key-value rows for a span's metadata.
 */
function buildSpanKvRows(span: TraceSpan, traceId: string): [string, string][] {
  const kvRows: [string, string][] = [];

  kvRows.push(["Span ID", `\`${span.span_id}\``]);
  kvRows.push(["Trace ID", `\`${traceId}\``]);

  if (span.parent_span_id) {
    kvRows.push(["Parent", `\`${span.parent_span_id}\``]);
  }

  const op = span.op || span["transaction.op"];
  if (op) {
    kvRows.push(["Op", `\`${op}\``]);
  }

  const desc = span.description || span.transaction;
  if (desc) {
    kvRows.push(["Description", escapeMarkdownCell(desc)]);
  }

  const durationMs = computeSpanDurationMs(span);
  if (durationMs !== undefined) {
    kvRows.push(["Duration", formatTraceDuration(durationMs)]);
  }

  if (span.project_slug) {
    kvRows.push(["Project", span.project_slug]);
  }

  if (isValidTimestamp(span.start_timestamp)) {
    const date = new Date(span.start_timestamp * 1000);
    kvRows.push(["Started", date.toLocaleString("sv-SE")]);
  }

  kvRows.push(["Children", String((span.children ?? []).length)]);

  return kvRows;
}

/**
 * Format an ancestor chain as indented tree lines.
 */
function formatAncestorChain(ancestors: TraceSpan[]): string {
  const lines: string[] = ["", muted("─── Ancestors ───"), ""];
  for (let i = 0; i < ancestors.length; i++) {
    const a = ancestors[i];
    if (!a) {
      continue;
    }
    const indent = "  ".repeat(i);
    const aOp = a.op || a["transaction.op"] || "unknown";
    const aDesc = a.description || a.transaction || "(no description)";
    lines.push(`${indent}${muted(aOp)} — ${aDesc} ${muted(`(${a.span_id})`)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Format a single span's details for human-readable output.
 *
 * @param span - The TraceSpan to format
 * @param ancestors - Ancestor chain from root to parent
 * @param traceId - The trace ID for context
 * @returns Rendered terminal string
 */
export function formatSpanDetails(
  span: TraceSpan,
  ancestors: TraceSpan[],
  traceId: string
): string {
  const kvRows = buildSpanKvRows(span, traceId);
  const md = `## Span \`${span.span_id}\`\n\n${mdKvTable(kvRows)}\n`;
  let output = renderMarkdown(md);

  if (ancestors.length > 0) {
    output += formatAncestorChain(ancestors);
  }

  return output;
}
