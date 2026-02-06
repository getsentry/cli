/**
 * Log-specific formatters
 *
 * Provides formatting utilities for displaying Sentry logs in the CLI.
 */

import type { DetailedSentryLog, SentryLog } from "../../types/index.js";
import { buildTraceUrl } from "../sentry-urls.js";
import { cyan, muted, red, yellow } from "./colors.js";
import { divider } from "./human.js";

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
 * Format column header for logs list.
 *
 * @returns Header line with column titles and divider
 */
export function formatLogsHeader(): string {
  const header = muted("TIMESTAMP            LEVEL    MESSAGE");
  return `${header}\n${divider(80)}\n`;
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

/** Minimum width for header separator line */
const MIN_HEADER_WIDTH = 20;

/**
 * Format detailed log entry for display.
 * Shows all available fields in a structured format.
 *
 * @param log - The detailed log entry to format
 * @param orgSlug - Organization slug for building trace URLs
 * @returns Array of formatted lines
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: log detail formatting requires multiple conditional sections
export function formatLogDetails(
  log: DetailedSentryLog,
  orgSlug: string
): string[] {
  const lines: string[] = [];
  const logId = log["sentry.item_id"];

  // Header
  const headerText = `Log ${logId.slice(0, 12)}...`;
  const separatorWidth = Math.max(MIN_HEADER_WIDTH, Math.min(80, 40));
  lines.push(headerText);
  lines.push(muted("═".repeat(separatorWidth)));
  lines.push("");

  // Core fields
  lines.push(`ID:         ${logId}`);
  lines.push(`Timestamp:  ${formatTimestamp(log.timestamp)}`);
  lines.push(`Severity:   ${formatSeverityLabel(log.severity)}`);

  // Message (may be multi-line or long)
  if (log.message) {
    lines.push("");
    lines.push("Message:");
    lines.push(`  ${log.message}`);
  }
  lines.push("");

  // Context section
  if (log.project || log.environment || log.release) {
    lines.push(muted("─── Context ───"));
    lines.push("");
    if (log.project) {
      lines.push(`Project:      ${log.project}`);
    }
    if (log.environment) {
      lines.push(`Environment:  ${log.environment}`);
    }
    if (log.release) {
      lines.push(`Release:      ${log.release}`);
    }
    lines.push("");
  }

  // SDK section
  const sdkName = log["sdk.name"];
  const sdkVersion = log["sdk.version"];
  if (sdkName || sdkVersion) {
    lines.push(muted("─── SDK ───"));
    lines.push("");
    const sdkInfo = sdkVersion ? `${sdkName} ${sdkVersion}` : sdkName;
    lines.push(`SDK:          ${sdkInfo}`);
    lines.push("");
  }

  // Trace section
  if (log.trace) {
    lines.push(muted("─── Trace ───"));
    lines.push("");
    lines.push(`Trace ID:     ${log.trace}`);
    if (log.span_id) {
      lines.push(`Span ID:      ${log.span_id}`);
    }
    lines.push(`Link:         ${buildTraceUrl(orgSlug, log.trace)}`);
    lines.push("");
  }

  // Source location section (OTel code attributes)
  const codeFunction = log["code.function"];
  const codeFilePath = log["code.file.path"];
  const codeLineNumber = log["code.line.number"];
  if (codeFunction || codeFilePath) {
    lines.push(muted("─── Source Location ───"));
    lines.push("");
    if (codeFunction) {
      lines.push(`Function:     ${codeFunction}`);
    }
    if (codeFilePath) {
      const location = codeLineNumber
        ? `${codeFilePath}:${codeLineNumber}`
        : codeFilePath;
      lines.push(`File:         ${location}`);
    }
    lines.push("");
  }

  // OpenTelemetry section (if any OTel fields are present)
  const otelKind = log["sentry.otel.kind"];
  const otelStatus = log["sentry.otel.status_code"];
  const otelScope = log["sentry.otel.instrumentation_scope.name"];
  if (otelKind || otelStatus || otelScope) {
    lines.push(muted("─── OpenTelemetry ───"));
    lines.push("");
    if (otelKind) {
      lines.push(`Kind:         ${otelKind}`);
    }
    if (otelStatus) {
      lines.push(`Status:       ${otelStatus}`);
    }
    if (otelScope) {
      lines.push(`Scope:        ${otelScope}`);
    }
    lines.push("");
  }

  return lines;
}
