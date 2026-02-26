/**
 * Log-specific formatters
 *
 * Provides formatting utilities for displaying Sentry logs in the CLI.
 */

import type { DetailedSentryLog, SentryLog } from "../../types/index.js";
import { buildTraceUrl } from "../sentry-urls.js";
import { cyan, muted, red, yellow } from "./colors.js";
import { renderMarkdown } from "./markdown.js";

/** Color functions for log severity levels */
const SEVERITY_COLORS: Record<string, (text: string) => string> = {
  fatal: red,
  error: red,
  warning: yellow,
  warn: yellow,
  info: cyan,
  debug: muted,
  trace: muted,
};

/**
 * Format severity level with appropriate color.
 * Pads to 7 characters for alignment (longest: "warning").
 *
 * @param severity - The log severity level
 * @returns Colored and padded severity string
 */
function formatSeverity(severity: string | null | undefined): string {
  const level = (severity ?? "info").toLowerCase();
  const colorFn = SEVERITY_COLORS[level] ?? ((s: string) => s);
  return colorFn(level.toUpperCase().padEnd(7));
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
 * Format a single log entry for human-readable output.
 *
 * Format: "TIMESTAMP  SEVERITY  MESSAGE [trace_id]"
 * Example: "2024-01-30 14:32:15  ERROR    Failed to connect [abc12345]"
 *
 * @param log - The log entry to format
 * @returns Formatted log line with newline
 */
export function formatLogRow(log: SentryLog): string {
  const timestamp = formatTimestamp(log.timestamp);
  const severity = formatSeverity(log.severity);
  const message = log.message ?? "";
  const trace = log.trace ? muted(` [${log.trace.slice(0, 8)}]`) : "";

  return `${timestamp}  ${severity}  ${message}${trace}\n`;
}

/**
 * Format column header for logs list (used in streaming/follow mode).
 *
 * @returns Header line with column titles and separator
 */
export function formatLogsHeader(): string {
  const header = muted("TIMESTAMP            LEVEL    MESSAGE");
  return `${header}\n${muted("─".repeat(80))}\n`;
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
  const header = "| Timestamp | Level | Message |";
  const separator = "| --- | --- | --- |";
  const rows = logs
    .map((log) => {
      const timestamp = formatTimestamp(log.timestamp);
      // Pre-render ANSI severity color — survives the cli-table3 pipeline
      const severity = formatSeverity(log.severity).trim();
      const message = escapeMarkdownCell(log.message ?? "");
      const trace = log.trace ? ` \`[${log.trace.slice(0, 8)}]\`` : "";
      return `| ${timestamp} | ${severity} | ${message}${trace} |`;
    })
    .join("\n");

  return renderMarkdown(`${header}\n${separator}\n${rows}`);
}

/**
 * Format severity level with color for detailed view (not padded).
 *
 * @param severity - The log severity level
 * @returns Colored severity string
 */
function formatSeverityLabel(severity: string | null | undefined): string {
  const level = (severity ?? "info").toLowerCase();
  const colorFn = SEVERITY_COLORS[level] ?? ((s: string) => s);
  return colorFn(level.toUpperCase());
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

  lines.push(`## Log \`${logId.slice(0, 12)}...\``);
  lines.push("");

  // Core fields table
  const rows: string[] = [];
  rows.push(`| **ID** | \`${logId}\` |`);
  rows.push(`| **Timestamp** | ${formatTimestamp(log.timestamp)} |`);
  rows.push(`| **Severity** | ${formatSeverityLabel(log.severity)} |`);

  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(...rows);

  if (log.message) {
    lines.push("");
    lines.push("**Message:**");
    lines.push("");
    lines.push(`> ${log.message.replace(/\n/g, "\n> ")}`);
  }

  // Context section
  if (log.project || log.environment || log.release) {
    lines.push("");
    lines.push("### Context");
    lines.push("");
    const ctxRows: string[] = [];
    if (log.project) {
      ctxRows.push(`| **Project** | ${log.project} |`);
    }
    if (log.environment) {
      ctxRows.push(`| **Environment** | ${log.environment} |`);
    }
    if (log.release) {
      ctxRows.push(`| **Release** | ${log.release} |`);
    }
    lines.push("| | |");
    lines.push("|---|---|");
    lines.push(...ctxRows);
  }

  // SDK section
  const sdkName = log["sdk.name"];
  const sdkVersion = log["sdk.version"];
  if (sdkName || sdkVersion) {
    lines.push("");
    lines.push("### SDK");
    lines.push("");
    // Wrap in backticks to prevent markdown from interpreting underscores/dashes
    const sdkInfo =
      sdkName && sdkVersion
        ? `\`${sdkName} ${sdkVersion}\``
        : `\`${sdkName ?? sdkVersion}\``;
    lines.push("| | |");
    lines.push("|---|---|");
    lines.push(`| **SDK** | ${sdkInfo} |`);
  }

  // Trace section
  if (log.trace) {
    lines.push("");
    lines.push("### Trace");
    lines.push("");
    const traceRows: string[] = [];
    traceRows.push(`| **Trace ID** | \`${log.trace}\` |`);
    if (log.span_id) {
      traceRows.push(`| **Span ID** | \`${log.span_id}\` |`);
    }
    traceRows.push(`| **Link** | ${buildTraceUrl(orgSlug, log.trace)} |`);
    lines.push("| | |");
    lines.push("|---|---|");
    lines.push(...traceRows);
  }

  // Source location section (OTel code attributes)
  const codeFunction = log["code.function"];
  const codeFilePath = log["code.file.path"];
  const codeLineNumber = log["code.line.number"];
  if (codeFunction || codeFilePath) {
    lines.push("");
    lines.push("### Source Location");
    lines.push("");
    const srcRows: string[] = [];
    if (codeFunction) {
      srcRows.push(`| **Function** | \`${codeFunction}\` |`);
    }
    if (codeFilePath) {
      const location = codeLineNumber
        ? `${codeFilePath}:${codeLineNumber}`
        : codeFilePath;
      srcRows.push(`| **File** | \`${location}\` |`);
    }
    lines.push("| | |");
    lines.push("|---|---|");
    lines.push(...srcRows);
  }

  // OpenTelemetry section
  const otelKind = log["sentry.otel.kind"];
  const otelStatus = log["sentry.otel.status_code"];
  const otelScope = log["sentry.otel.instrumentation_scope.name"];
  if (otelKind || otelStatus || otelScope) {
    lines.push("");
    lines.push("### OpenTelemetry");
    lines.push("");
    const otelRows: string[] = [];
    if (otelKind) {
      otelRows.push(`| **Kind** | ${otelKind} |`);
    }
    if (otelStatus) {
      otelRows.push(`| **Status** | ${otelStatus} |`);
    }
    if (otelScope) {
      otelRows.push(`| **Scope** | ${otelScope} |`);
    }
    lines.push("| | |");
    lines.push("|---|---|");
    lines.push(...otelRows);
  }

  return renderMarkdown(lines.join("\n"));
}
