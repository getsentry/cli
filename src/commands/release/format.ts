/**
 * Shared formatting utilities for release commands.
 *
 * Small helpers used by both `list.ts` and `view.ts` to format
 * health/adoption metrics consistently.
 */

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
 * Format an integer count with thousands separators, or "—" when absent.
 *
 * @example fmtCount(52000) // "52,000"
 * @example fmtCount(null)  // "—"
 */
export function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return value.toLocaleString("en-US");
}
