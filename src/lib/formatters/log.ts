/**
 * Log-specific formatters
 *
 * Provides formatting utilities for displaying Sentry logs in the CLI.
 */

import type { DetailedSentryLog, SentryLog } from "../../types/index.js";
import { buildTraceUrl } from "../sentry-urls.js";
import {
  colorTag,
  escapeMarkdownCell,
  escapeMarkdownInline,
  mdKvTable,
  mdRow,
  mdTableHeader,
  renderMarkdown,
} from "./markdown.js";
import { StreamingTable, type StreamingTableOptions } from "./text-table.js";

/** Markdown color tag names for log severity levels */
const SEVERITY_TAGS: Record<string, Parameters<typeof colorTag>[0]> = {
  fatal: "red",
  error: "red",
  warning: "yellow",
  warn: "yellow",
  info: "cyan",
  debug: "muted",
  trace: "muted",
};

/** Column headers for the streaming log table */
const LOG_TABLE_COLS = ["Timestamp", "Level", "Message"] as const;

/**
 * Format severity level with appropriate color tag.
 * Pads to 7 characters for alignment (longest: "warning").
 *
 * @param severity - The log severity level
 * @returns Markdown color-tagged and padded severity string
 */
function formatSeverity(severity: string | null | undefined): string {
  const level = (severity ?? "info").toLowerCase();
  const tag = SEVERITY_TAGS[level];
  const label = level.toUpperCase().padEnd(7);
  return tag ? colorTag(tag, label) : label;
}

/**
 * Format ISO timestamp for display.
 * Converts to local time in "YYYY-MM-DD HH:MM:SS" format.
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Formatted local timestamp, or original string if invalid
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  // Handle invalid dates - return original string
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  // Swedish locale naturally uses ISO 8601 format (YYYY-MM-DD HH:MM:SS) in local time
  return date.toLocaleString("sv-SE");
}

/**
 * Extract cell values for a log row (shared by streaming and batch paths).
 *
 * @param log - The log entry
 * @param padSeverity - Whether to pad severity to 7 chars for alignment
 * @returns `[timestamp, severity, message]` strings
 */
export function buildLogRowCells(
  log: SentryLog,
  padSeverity = true
): [string, string, string] {
  const timestamp = formatTimestamp(log.timestamp);
  const level = padSeverity
    ? formatSeverity(log.severity)
    : formatSeverityLabel(log.severity);
  const message = escapeMarkdownCell(log.message ?? "");
  const trace = log.trace ? ` \`[${log.trace.slice(0, 8)}]\`` : "";
  return [timestamp, level, `${message}${trace}`];
}

/**
 * Format a single log entry as a plain markdown table row.
 * Used for non-TTY / piped output where StreamingTable isn't appropriate.
 *
 * @param log - The log entry to format
 * @returns Formatted log line with newline
 */
export function formatLogRow(log: SentryLog): string {
  return mdRow(buildLogRowCells(log));
}

/** Hint rows for column width estimation in streaming mode. */
const LOG_HINT_ROWS: string[][] = [
  ["2026-01-15 23:59:59", "WARNING", "A typical log message with some detail"],
];

/**
 * Create a StreamingTable configured for log output.
 *
 * @param options - Override default table options
 * @returns A StreamingTable with log-specific column configuration
 */
export function createLogStreamingTable(
  options: Partial<StreamingTableOptions> = {}
): StreamingTable {
  return new StreamingTable([...LOG_TABLE_COLS], {
    hintRows: LOG_HINT_ROWS,
    // Timestamp and Level are fixed-width; Message gets the rest
    shrinkable: [false, false, true],
    truncate: false,
    ...options,
  });
}

/**
 * Format column header for logs list in plain (non-TTY) mode.
 *
 * Emits a proper markdown table header + separator row so that
 * the streamed rows compose into a valid CommonMark document when redirected.
 * In TTY mode, use {@link createLogStreamingTable} instead.
 *
 * @returns Header string (includes trailing newline)
 */
export function formatLogsHeader(): string {
  return `${mdTableHeader(LOG_TABLE_COLS)}\n`;
}

/**
 * Build a markdown table for a list of log entries.
 *
 * Pre-rendered ANSI codes in cell values (e.g. colored severity) are preserved.
 *
 * @param logs - Log entries to display
 * @returns Rendered terminal string with Unicode-bordered table
 */
export function formatLogTable(logs: SentryLog[]): string {
  const rows = logs
    .map((log) => mdRow(buildLogRowCells(log, false)).trimEnd())
    .join("\n");

  return renderMarkdown(`${mdTableHeader(LOG_TABLE_COLS)}\n${rows}`);
}

/**
 * Format severity level with color tag for detailed view (not padded).
 *
 * @param severity - The log severity level
 * @returns Markdown color-tagged severity string
 */
function formatSeverityLabel(severity: string | null | undefined): string {
  const level = (severity ?? "info").toLowerCase();
  const tag = SEVERITY_TAGS[level];
  const label = level.toUpperCase();
  return tag ? colorTag(tag, label) : label;
}

/**
 * Format detailed log entry for display as rendered markdown.
 * Shows all available fields in a structured format.
 *
 * @param log - The detailed log entry to format
 * @param orgSlug - Organization slug for building trace URLs
 * @returns Rendered terminal string
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: log detail formatting requires multiple conditional sections
export function formatLogDetails(
  log: DetailedSentryLog,
  orgSlug: string
): string {
  const logId = log["sentry.item_id"];
  const lines: string[] = [];

  lines.push(`## Log \`${logId.slice(0, 6)}...${logId.slice(-6)}\``);
  lines.push("");

  // Core fields table
  lines.push(
    mdKvTable([
      ["ID", `\`${logId}\``],
      ["Timestamp", formatTimestamp(log.timestamp)],
      ["Severity", formatSeverityLabel(log.severity)],
    ])
  );

  if (log.message) {
    lines.push("");
    lines.push("**Message:**");
    lines.push("");
    lines.push(`> ${escapeMarkdownInline(log.message).replace(/\n/g, "\n> ")}`);
  }

  // Context section
  if (log.project || log.environment || log.release) {
    const ctxRows: [string, string][] = [];
    if (log.project) {
      ctxRows.push(["Project", log.project]);
    }
    if (log.environment) {
      ctxRows.push(["Environment", log.environment]);
    }
    if (log.release) {
      ctxRows.push(["Release", log.release]);
    }
    lines.push("");
    lines.push(mdKvTable(ctxRows, "Context"));
  }

  // SDK section
  const sdkName = log["sdk.name"];
  const sdkVersion = log["sdk.version"];
  if (sdkName || sdkVersion) {
    // Wrap in backticks to prevent markdown from interpreting underscores/dashes
    const sdkInfo =
      sdkName && sdkVersion
        ? `\`${sdkName} ${sdkVersion}\``
        : `\`${sdkName ?? sdkVersion}\``;
    lines.push("");
    lines.push(mdKvTable([["SDK", sdkInfo]], "SDK"));
  }

  // Trace section
  if (log.trace) {
    const traceRows: [string, string][] = [["Trace ID", `\`${log.trace}\``]];
    if (log.span_id) {
      traceRows.push(["Span ID", `\`${log.span_id}\``]);
    }
    traceRows.push(["Link", buildTraceUrl(orgSlug, log.trace)]);
    lines.push("");
    lines.push(mdKvTable(traceRows, "Trace"));
  }

  // Source location section (OTel code attributes)
  const codeFunction = log["code.function"];
  const codeFilePath = log["code.file.path"];
  const codeLineNumber = log["code.line.number"];
  if (codeFunction || codeFilePath) {
    const srcRows: [string, string][] = [];
    if (codeFunction) {
      srcRows.push(["Function", `\`${codeFunction}\``]);
    }
    if (codeFilePath) {
      const location = codeLineNumber
        ? `${codeFilePath}:${codeLineNumber}`
        : codeFilePath;
      srcRows.push(["File", `\`${location}\``]);
    }
    lines.push("");
    lines.push(mdKvTable(srcRows, "Source Location"));
  }

  // OpenTelemetry section
  const otelKind = log["sentry.otel.kind"];
  const otelStatus = log["sentry.otel.status_code"];
  const otelScope = log["sentry.otel.instrumentation_scope.name"];
  if (otelKind || otelStatus || otelScope) {
    const otelRows: [string, string][] = [];
    if (otelKind) {
      otelRows.push(["Kind", otelKind]);
    }
    if (otelStatus) {
      otelRows.push(["Status", otelStatus]);
    }
    if (otelScope) {
      otelRows.push(["Scope", otelScope]);
    }
    lines.push("");
    lines.push(mdKvTable(otelRows, "OpenTelemetry"));
  }

  return renderMarkdown(lines.join("\n"));
}
