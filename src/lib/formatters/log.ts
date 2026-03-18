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
  isPlainOutput,
  mdKvTable,
  mdRow,
  mdTableHeader,
  renderInlineMarkdown,
  renderMarkdown,
  stripMarkdownInline,
} from "./markdown.js";
import {
  renderTextTable,
  StreamingTable,
  type StreamingTableOptions,
} from "./text-table.js";

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
 * Minimal log-row shape shared by {@link SentryLog} (Explore/Events) and
 * trace-log entries (`TraceLog` from the trace-logs endpoint).
 * Both types carry these three fields with the same semantics.
 */
type LogLike = {
  timestamp: string;
  severity?: string | null;
  message?: string | null;
  /** Present on Explore/Events logs; absent on trace-logs (all rows share one trace). */
  trace?: string | null;
};

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
 * When `includeTrace` is true (the default), a short trace-ID suffix is
 * appended to the message cell — useful in Explore/Events lists where rows
 * may span many traces. Pass `false` when all rows already share the same
 * trace (e.g., `sentry trace logs`) so the redundant suffix is omitted.
 *
 * @param log - The log entry (any {@link LogLike} shape)
 * @param padSeverity - Whether to pad severity to 7 chars for alignment
 * @param includeTrace - Whether to append a short trace-ID suffix to the message
 * @returns `[timestamp, severity, message]` markdown-safe cell strings
 */
export function buildLogRowCells(
  log: LogLike,
  padSeverity = true,
  includeTrace = true
): [string, string, string] {
  const timestamp = formatTimestamp(log.timestamp);
  const level = padSeverity
    ? formatSeverity(log.severity)
    : formatSeverityLabel(log.severity);
  const message = escapeMarkdownCell(log.message ?? "");
  const trace =
    includeTrace && log.trace ? ` \`[${log.trace.slice(0, 8)}]\`` : "";
  return [timestamp, level, `${message}${trace}`];
}

/**
 * Format a single log entry as a plain markdown table row.
 * Used for non-TTY / piped output where StreamingTable isn't appropriate.
 *
 * @param log - The log entry (any {@link LogLike} shape)
 * @param includeTrace - Whether to append a short trace-ID suffix (default: true)
 * @returns Formatted log line with newline
 */
export function formatLogRow(log: LogLike, includeTrace = true): string {
  return mdRow(buildLogRowCells(log, true, includeTrace));
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
 * Accepts any {@link LogLike} shape — both {@link SentryLog} (Explore/Events)
 * and trace-log entries. Pass `includeTrace: false` when all rows already share
 * the same trace (e.g., `sentry trace logs`) to omit the redundant trace suffix.
 *
 * Pre-rendered ANSI codes in cell values (e.g. colored severity) are preserved.
 *
 * @param logs - Log entries to display
 * @param includeTrace - Whether to append a short trace-ID suffix (default: true)
 * @returns Rendered terminal string with Unicode-bordered table
 */
export function formatLogTable(logs: LogLike[], includeTrace = true): string {
  const headers = [...LOG_TABLE_COLS];

  if (isPlainOutput()) {
    const rows = logs.map((log) =>
      buildLogRowCells(log, false, includeTrace).map((c) =>
        stripMarkdownInline(c)
      )
    );
    return renderTextTable(headers, rows);
  }

  const rows = logs.map((log) =>
    buildLogRowCells(log, false, includeTrace).map((c) =>
      renderInlineMarkdown(c)
    )
  );
  return renderTextTable(headers, rows);
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
