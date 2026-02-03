/**
 * Log-specific formatters
 *
 * Provides formatting utilities for displaying Sentry logs in the CLI.
 */

import type { SentryLog } from "../../types/index.js";
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
 * @returns Formatted local timestamp
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  // Format as local time: YYYY-MM-DD HH:MM:SS
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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
