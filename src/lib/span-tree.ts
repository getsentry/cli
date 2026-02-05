/**
 * Span tree utilities
 *
 * Shared helper for fetching and formatting span trees from trace data.
 */

import type { SentryEvent } from "../types/index.js";
import { getDetailedTrace } from "./api-client.js";
import { formatSimpleSpanTree, muted } from "./formatters/index.js";

/**
 * Result from fetching span tree lines.
 */
type SpanTreeResult = {
  /** Formatted lines ready for display */
  lines: string[];
  /** Whether the fetch was successful */
  success: boolean;
};

/**
 * Fetch and format span tree lines for an event.
 * Returns formatted lines ready for display, with error messages for failure cases.
 *
 * @param orgSlug - Organization slug for API routing
 * @param event - The event to get trace from
 * @param maxDepth - Maximum nesting depth to display
 * @returns Formatted lines and success status
 */
export async function getSpanTreeLines(
  orgSlug: string,
  event: SentryEvent,
  maxDepth: number
): Promise<SpanTreeResult> {
  const traceId = event.contexts?.trace?.trace_id;
  const dateCreated = (event as { dateCreated?: string }).dateCreated;
  const timestamp = dateCreated
    ? new Date(dateCreated).getTime() / 1000
    : undefined;

  if (!traceId) {
    return {
      lines: [muted("\nNo trace data available for this event.")],
      success: false,
    };
  }
  if (!timestamp) {
    return {
      lines: [muted("\nNo timestamp available to fetch span tree.")],
      success: false,
    };
  }

  try {
    const spans = await getDetailedTrace(orgSlug, traceId, timestamp);
    const lines = formatSimpleSpanTree(traceId, spans, maxDepth);
    return { lines, success: true };
  } catch {
    return {
      lines: [muted("\nUnable to fetch span tree for this event.")],
      success: false,
    };
  }
}
