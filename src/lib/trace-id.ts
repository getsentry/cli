/**
 * Trace ID Validation
 *
 * Re-exports shared hex ID validation specialized for trace IDs.
 * Used by `trace logs` and `log list --trace` commands.
 */

import { HEX_ID_RE, validateHexId } from "./hex-id.js";

/**
 * Regex for a valid 32-character hexadecimal trace ID.
 * Alias for `HEX_ID_RE` — both trace IDs and log IDs share the same format.
 */
export const TRACE_ID_RE = HEX_ID_RE;

/**
 * Validate that a string looks like a 32-character hex trace ID.
 *
 * Returns the validated trace ID so it can be used as a Stricli `parse`
 * function directly.
 *
 * @param traceId - The trace ID string to validate
 * @returns The validated trace ID (trimmed)
 * @throws {ValidationError} If the trace ID format is invalid
 */
export function validateTraceId(traceId: string): string {
  return validateHexId(traceId, "trace ID");
}
