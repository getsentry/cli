/**
 * Trace-specific formatters
 *
 * Provides formatting utilities for displaying Sentry traces in the CLI.
 */

import type { TraceSpan, TransactionListItem } from "../../types/index.js";
import { formatRelativeTime } from "./human.js";
import {
  divider,
  escapeMarkdownCell,
  mdRow,
  mdTableHeader,
  renderMarkdown,
} from "./markdown.js";

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
function buildTraceRowCells(
  item: TransactionListItem
): [string, string, string, string] {
  return [
    `\`${item.trace}\``,
    escapeMarkdownCell(item.transaction || "unknown"),
    formatTraceDuration(item["transaction.duration"]),
    formatRelativeTime(item.timestamp).trim(),
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
 * Format column header for traces list (streaming mode).
 *
 * @returns Header string (includes trailing newline)
 */
export function formatTracesHeader(): string {
  const names = TRACE_TABLE_COLS.map((c) =>
    c.endsWith(":") ? c.slice(0, -1) : c
  );
  return `${mdRow(names.map((n) => `**${n}**`))}${divider(96)}\n`;
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
  const rows = items
    .map((item) => {
      const [traceId, transaction, duration, when] = buildTraceRowCells(item);
      return `| ${traceId} | ${transaction} | ${duration} | ${when} |`;
    })
    .join("\n");
  return renderMarkdown(`${mdTableHeader(TRACE_TABLE_COLS)}\n${rows}`);
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
  const rows: string[] = [];

  if (summary.rootTransaction) {
    const opPrefix = summary.rootOp ? `[\`${summary.rootOp}\`] ` : "";
    rows.push(
      `| **Root** | ${opPrefix}${escapeMarkdownCell(summary.rootTransaction)} |`
    );
  }
  rows.push(`| **Duration** | ${formatTraceDuration(summary.duration)} |`);
  rows.push(`| **Spans** | ${summary.spanCount} |`);
  if (summary.projects.length > 0) {
    rows.push(`| **Projects** | ${summary.projects.join(", ")} |`);
  }
  if (Number.isFinite(summary.startTimestamp) && summary.startTimestamp > 0) {
    const date = new Date(summary.startTimestamp * 1000);
    rows.push(`| **Started** | ${date.toLocaleString("sv-SE")} |`);
  }

  const table = `| | |\n|---|---|\n${rows.join("\n")}`;
  const md = `## Trace \`${summary.traceId}\`\n\n${table}\n`;
  return renderMarkdown(md);
}
