/**
 * Time and duration utility functions for formatters.
 *
 * Extracted to break the circular import between `human.ts` and `trace.ts`:
 * both modules need these utilities but neither should depend on the other.
 */

import type { TraceSpan } from "../../types/index.js";
import { colorTag } from "./markdown.js";

/**
 * Format a date string as a relative time label.
 *
 * - Under 60 minutes: "5m ago"
 * - Under 24 hours: "3h ago"
 * - Under 3 days: "2d ago"
 * - Otherwise: short date like "Jan 18"
 *
 * Returns a muted "—" when the input is undefined.
 *
 * @param dateString - ISO date string or undefined
 * @returns Human-readable relative time string
 */
export function formatRelativeTime(dateString: string | undefined): string {
  if (!dateString) {
    return colorTag("muted", "—");
  }

  const date = new Date(dateString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  let text: string;
  if (diffMins < 60) {
    text = `${diffMins}m ago`;
  } else if (diffHours < 24) {
    text = `${diffHours}h ago`;
  } else if (diffDays < 3) {
    text = `${diffDays}d ago`;
  } else {
    // Short date: "Jan 18"
    text = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return text;
}

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
