/**
 * Shared number formatting utilities.
 *
 * Provides compact notation (K/M/B), percentage formatting, and unit
 * suffixing used across dashboard, release, and other command formatters.
 *
 * Uses `Intl.NumberFormat` for locale-aware compact notation.
 */

/**
 * Compact notation formatter: 52000 → "52K", 1.2M, etc.
 * One fractional digit maximum.
 */
export const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Standard notation formatter with thousands separators.
 * Two fractional digits maximum: 1234.5 → "1,234.5".
 */
export const standardFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

/**
 * Format a number with standard notation, switching to compact above 1M.
 *
 * - Below 1M: standard grouping (e.g., "52,000", "1,234.5")
 * - At or above 1M: compact (e.g., "1.2M", "52M")
 *
 * @example formatNumber(1234)    // "1,234"
 * @example formatNumber(1500000) // "1.5M"
 */
export function formatNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return compactFormatter.format(value);
  }
  return standardFormatter.format(value);
}

/**
 * Format a number in compact notation (always uses K/M/B suffixes).
 *
 * @example formatCompactCount(500)     // "500"
 * @example formatCompactCount(52000)   // "52K"
 * @example formatCompactCount(1200000) // "1.2M"
 */
export function formatCompactCount(value: number): string {
  return compactFormatter.format(value);
}

/**
 * Append a unit suffix to a pre-formatted number string.
 *
 * Handles common Sentry unit names: "millisecond" → "ms",
 * "second" → "s", "byte" → "B". Unknown units are appended with a space.
 * Returns the number unchanged for "none"/"null"/empty units.
 */
export function appendUnitSuffix(
  formatted: string,
  unit?: string | null
): string {
  if (!unit || unit === "none" || unit === "null") {
    return formatted;
  }
  if (unit === "millisecond") {
    return `${formatted}ms`;
  }
  if (unit === "second") {
    return `${formatted}s`;
  }
  if (unit === "byte") {
    return `${formatted}B`;
  }
  return `${formatted} ${unit}`;
}

/**
 * Format a number with its unit, using standard/compact notation.
 *
 * @example formatWithUnit(1234, "millisecond") // "1,234ms"
 * @example formatWithUnit(1500000, "byte")     // "1.5MB"
 */
export function formatWithUnit(value: number, unit?: string | null): string {
  return appendUnitSuffix(formatNumber(value), unit);
}

/**
 * Format a number with its unit, always using compact notation.
 *
 * @example formatCompactWithUnit(52000, "byte") // "52KB"
 */
export function formatCompactWithUnit(
  value: number,
  unit?: string | null
): string {
  return appendUnitSuffix(compactFormatter.format(Math.round(value)), unit);
}

/**
 * Format a percentage value with one decimal place, or "—" when absent.
 *
 * @example fmtPct(42.3) // "42.3%"
 * @example fmtPct(null) // "—"
 */
export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

/**
 * Format an integer count in compact notation, or "—" when absent.
 *
 * Values below 1000 are shown as-is. Above that, uses K/M/B suffixes.
 *
 * @example fmtCount(500)     // "500"
 * @example fmtCount(52000)   // "52K"
 * @example fmtCount(1200000) // "1.2M"
 * @example fmtCount(null)    // "—"
 */
export function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return compactFormatter.format(value);
}
