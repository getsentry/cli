/**
 * Time range parsing and conversion for the --period flag.
 *
 * Supports three syntaxes:
 * 1. Relative durations: "7d", "24h", "1h", "30m", "2w"
 * 2. Date ranges with ".." separator: "2024-01-01..2024-02-01", "2024-01-01..", "..2024-02-01"
 * 3. Comparison operators (gh-compatible): ">2024-01-01", ">=2024-01-01", "<2024-02-01", "<=2024-02-01"
 *
 * Date-only inputs are normalized using the local machine timezone.
 * Datetimes with explicit timezone offsets are passed through as-is.
 */

import { ValidationError } from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Relative duration like "7d", "24h" */
export type RelativeTimeRange = {
  readonly type: "relative";
  /** Raw duration string passed through to the API's statsPeriod param */
  readonly period: string;
};

/** Absolute date range with optional open ends */
export type AbsoluteTimeRange = {
  readonly type: "absolute";
  /** ISO-8601 datetime string, or undefined for open-ended start */
  readonly start?: string;
  /** ISO-8601 datetime string, or undefined for open-ended end */
  readonly end?: string;
};

/** Discriminated union for all period flag values */
export type TimeRange = RelativeTimeRange | AbsoluteTimeRange;

/** API parameters for time-scoped queries — statsPeriod and start/end are mutually exclusive */
export type TimeRangeApiParams = {
  statsPeriod?: string;
  start?: string;
  end?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Brief text for --period flag help, shared across commands */
export const PERIOD_BRIEF =
  'Time range: "7d", "2024-01-01..2024-02-01", ">=2024-01-01"';

/** Valid unit suffixes for relative period strings */
const PERIOD_UNITS = "smhdw";

/** Seconds per unit for relative period computation */
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86_400,
  w: 604_800,
};

/**
 * Try to parse a relative period string (e.g., "7d") into its numeric value and unit.
 * Returns null if the string isn't a valid relative period.
 */
function parseRelativeParts(
  value: string
): { value: number; unit: string } | null {
  if (value.length < 2) {
    return null;
  }
  const unit = value.at(-1) ?? "";
  if (!PERIOD_UNITS.includes(unit)) {
    return null;
  }
  const numStr = value.slice(0, -1);
  const num = Number(numStr);
  if (!Number.isInteger(num) || num < 0 || numStr.length === 0) {
    return null;
  }
  return { value: num, unit };
}

/** Check if a string is a date-only value (no time component) */
function isDateOnly(value: string): boolean {
  return !value.includes("T");
}

/** Check if a datetime string has an explicit timezone indicator (Z, +HH:MM, -HH:MM) */
function hasTimezone(value: string): boolean {
  if (value.endsWith("Z")) {
    return true;
  }
  // Look for +/- offset after the time portion (position 10+ to skip date hyphens)
  const tail = value.slice(10);
  const lastPlus = tail.lastIndexOf("+");
  const lastMinus = tail.lastIndexOf("-");
  return lastPlus > 0 || lastMinus > 0;
}

// ---------------------------------------------------------------------------
// Local timezone helpers
// ---------------------------------------------------------------------------

/**
 * Get the local timezone UTC offset string (e.g., "-05:00", "+09:00", "+00:00")
 * for a specific date. The offset may vary by date due to DST.
 */
function getLocalOffsetString(date: Date): string {
  const offsetMinutes = date.getTimezoneOffset();
  // getTimezoneOffset returns minutes *behind* UTC, so flip the sign
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const mins = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${mins}`;
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Date normalization positions.
 *
 * - "start": inclusive start boundary (>= semantics). Date-only → local midnight.
 * - "end": inclusive end boundary (<= semantics). Date-only → local end-of-day.
 * - "after": exclusive start boundary (> semantics). Date-only → next day local midnight.
 * - "before": exclusive end boundary (< semantics). Date-only → previous day local end-of-day.
 */
type DatePosition = "start" | "end" | "after" | "before";

/**
 * Parse and normalize a date string based on its position in a range expression.
 *
 * - Date-only inputs (`YYYY-MM-DD`) are normalized with local timezone offset
 *   and position-aware time boundaries.
 * - Datetime inputs without timezone get local timezone appended.
 * - Datetime inputs with explicit timezone are passed through as-is.
 *
 * @throws ValidationError on invalid date input
 */
export function parseDate(raw: string, position: DatePosition): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(
      "Empty date value. Expected ISO-8601 format (e.g., 2024-01-01)",
      "period"
    );
  }

  if (isDateOnly(trimmed)) {
    return normalizeDateOnly(trimmed, position);
  }

  return normalizeDatetime(trimmed, position);
}

/**
 * Normalize a date-only string (YYYY-MM-DD) with position-aware boundaries.
 *
 * Uses local timezone so "2024-01-15" means the user's local midnight,
 * not UTC midnight.
 */
function normalizeDateOnly(dateStr: string, position: DatePosition): string {
  // Validate by constructing a Date in local time
  const testDate = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(testDate.getTime())) {
    throw new ValidationError(
      `Invalid date: '${dateStr}'. Expected YYYY-MM-DD format.`,
      "period"
    );
  }

  if (position === "start") {
    // Inclusive start: local midnight of the given day
    const d = new Date(`${dateStr}T00:00:00`);
    return `${dateStr}T00:00:00.000${getLocalOffsetString(d)}`;
  }
  if (position === "end") {
    // Inclusive end: local end-of-day
    const d = new Date(`${dateStr}T23:59:59`);
    return `${dateStr}T23:59:59.999${getLocalOffsetString(d)}`;
  }
  if (position === "after") {
    // Exclusive start (>): next day's local midnight
    const nextDay = new Date(`${dateStr}T12:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextStr = nextDay.toISOString().slice(0, 10);
    const d = new Date(`${nextStr}T00:00:00`);
    return `${nextStr}T00:00:00.000${getLocalOffsetString(d)}`;
  }
  // position === "before": Exclusive end (<): previous day's local end-of-day
  const prevDay = new Date(`${dateStr}T12:00:00`);
  prevDay.setDate(prevDay.getDate() - 1);
  const prevStr = prevDay.toISOString().slice(0, 10);
  const d = new Date(`${prevStr}T23:59:59`);
  return `${prevStr}T23:59:59.999${getLocalOffsetString(d)}`;
}

/**
 * Normalize a datetime string, appending local timezone if none is present.
 */
function normalizeDatetime(
  datetimeStr: string,
  _position: DatePosition
): string {
  // If it already has a timezone, validate and pass through
  if (hasTimezone(datetimeStr)) {
    const d = new Date(datetimeStr);
    if (Number.isNaN(d.getTime())) {
      throw new ValidationError(
        `Invalid datetime: '${datetimeStr}'. Expected ISO-8601 format.`,
        "period"
      );
    }
    return datetimeStr;
  }

  // No timezone — interpret as local time, append local offset
  const d = new Date(datetimeStr);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(
      `Invalid datetime: '${datetimeStr}'. Expected ISO-8601 format (e.g., 2024-01-01T12:00:00).`,
      "period"
    );
  }
  return `${datetimeStr}${getLocalOffsetString(d)}`;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Try to parse a comparison operator prefix (>=, >, <=, <).
 * Returns the parsed TimeRange or null if the value doesn't start with an operator.
 */
function tryParseOperator(value: string): AbsoluteTimeRange | null {
  const operators: Array<{
    prefix: string;
    position: DatePosition;
    field: "start" | "end";
  }> = [
    { prefix: ">=", position: "start", field: "start" },
    { prefix: ">", position: "after", field: "start" },
    { prefix: "<=", position: "end", field: "end" },
    { prefix: "<", position: "before", field: "end" },
  ];

  for (const op of operators) {
    if (!value.startsWith(op.prefix)) {
      continue;
    }
    const dateStr = value.slice(op.prefix.length);
    if (dateStr.length === 0) {
      throw new ValidationError(
        `Missing date after '${op.prefix}'. Expected e.g., '${op.prefix}2024-01-01'.`,
        "period"
      );
    }
    const parsed = parseDate(dateStr, op.position);
    return {
      type: "absolute",
      [op.field]: parsed,
    } as AbsoluteTimeRange;
  }

  return null;
}

/**
 * Try to parse a ".." range expression.
 * Returns the parsed TimeRange or null if the value doesn't contain "..".
 */
function tryParseRange(value: string): AbsoluteTimeRange | null {
  const dotDotIdx = value.indexOf("..");
  if (dotDotIdx === -1) {
    return null;
  }

  const left = value.slice(0, dotDotIdx);
  const right = value.slice(dotDotIdx + 2);

  if (left.length === 0 && right.length === 0) {
    throw new ValidationError(
      "Empty range '..'. Provide at least one date " +
        "(e.g., '2024-01-01..', '..2024-02-01', '2024-01-01..2024-02-01').",
      "period"
    );
  }

  const start = left.length > 0 ? parseDate(left, "start") : undefined;
  const end = right.length > 0 ? parseDate(right, "end") : undefined;

  // Validate start < end when both are present
  if (start && end) {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    if (startTime > endTime) {
      throw new ValidationError(
        `Start date '${left}' is after end date '${right}'. ` +
          "The start must be before the end.",
        "period"
      );
    }
  }

  return { type: "absolute", start, end };
}

/**
 * Try to parse a relative duration string (e.g., "7d", "24h").
 * Returns the parsed TimeRange or null if the value isn't a valid relative duration.
 */
function tryParseRelative(value: string): RelativeTimeRange | null {
  const parts = parseRelativeParts(value);
  if (!parts) {
    return null;
  }
  if (parts.value === 0) {
    throw new ValidationError(
      `Invalid period '${value}': duration cannot be zero.`,
      "period"
    );
  }
  return { type: "relative", period: value };
}

/**
 * Parse a --period flag value into a TimeRange.
 *
 * Accepts three syntax families:
 * 1. Comparison operators: ">2024-01-01", ">=2024-01-01", "<2024-02-01", "<=2024-02-01"
 * 2. Range syntax: "2024-01-01..2024-02-01", "2024-01-01..", "..2024-02-01"
 * 3. Relative durations: "7d", "24h", "1h", "30m", "2w"
 *
 * @throws ValidationError on invalid input
 */
export function parsePeriod(value: string): TimeRange {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(
      "Empty period value. Use a relative duration (e.g., '7d', '24h') " +
        "or a date range (e.g., '2024-01-01..2024-02-01', '>=2024-01-01').",
      "period"
    );
  }

  return (
    tryParseOperator(trimmed) ??
    tryParseRange(trimmed) ??
    tryParseRelative(trimmed) ??
    throwInvalidPeriod(trimmed)
  );
}

/** Throw a helpful error for unrecognized period values. */
function throwInvalidPeriod(value: string): never {
  throw new ValidationError(
    `Invalid period '${value}'. Use a relative duration (e.g., '7d', '24h'), ` +
      "a date range (e.g., '2024-01-01..2024-02-01'), " +
      "or a comparison operator (e.g., '>=2024-01-01', '<2024-02-01').",
    "period"
  );
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

/**
 * Convert a parsed TimeRange to Sentry API query parameters.
 *
 * - Relative → `{ statsPeriod: "7d" }`
 * - Absolute → `{ start: "...", end: "..." }` (either may be omitted)
 *
 * `statsPeriod` and `start`/`end` are mutually exclusive in the Sentry API.
 */
export function timeRangeToApiParams(range: TimeRange): TimeRangeApiParams {
  if (range.type === "relative") {
    return { statsPeriod: range.period };
  }
  const params: TimeRangeApiParams = {};
  if (range.start) {
    params.start = range.start;
  }
  if (range.end) {
    params.end = range.end;
  }
  return params;
}

/**
 * Serialize a TimeRange to a stable string for use in pagination context keys.
 *
 * All absolute dates are normalized to UTC (via `.toISOString()`) to ensure
 * deterministic keys regardless of local timezone. Different user syntaxes that
 * resolve to the same boundary produce the same key.
 *
 * - Relative: `"rel:7d"`
 * - Absolute: `"abs:<utc-start>..<utc-end>"`
 * - Open-ended: `"abs:<utc-start>.."` or `"abs:..<utc-end>"`
 */
export function serializeTimeRange(range: TimeRange): string {
  if (range.type === "relative") {
    return `rel:${range.period}`;
  }
  const startUtc = range.start ? new Date(range.start).toISOString() : "";
  const endUtc = range.end ? new Date(range.end).toISOString() : "";
  return `abs:${startUtc}..${endUtc}`;
}

/**
 * Compute the total duration in seconds for a TimeRange.
 *
 * - Relative: parses "7d" → 604800
 * - Absolute with both bounds: (end - start) in seconds
 * - Open-ended: returns undefined (cannot compute)
 *
 * Used by dashboard interval computation to select optimal bucket sizes.
 */
export function timeRangeToSeconds(range: TimeRange): number | undefined {
  if (range.type === "relative") {
    return relativeToSeconds(range.period);
  }

  if (range.start && range.end) {
    return absoluteRangeToSeconds(range.start, range.end);
  }

  // Open-ended range — cannot compute duration
  return;
}

/** Parse a relative period string into seconds. */
function relativeToSeconds(period: string): number | undefined {
  const parts = parseRelativeParts(period);
  if (!parts) {
    return;
  }
  const seconds = UNIT_SECONDS[parts.unit];
  return seconds ? parts.value * seconds : undefined;
}

/** Compute seconds between two ISO-8601 datetime strings. */
function absoluteRangeToSeconds(
  start: string,
  end: string
): number | undefined {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return;
  }
  return Math.max(0, (endMs - startMs) / 1000);
}
