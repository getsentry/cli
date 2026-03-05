/**
 * Shared Trace ID Validation
 *
 * Provides trace ID regex and validation used by both `trace logs` and
 * `log list --trace` commands.
 */

import { ValidationError } from "./errors.js";

/** Regex for a valid 32-character hexadecimal trace ID */
export const TRACE_ID_RE = /^[0-9a-f]{32}$/i;

/**
 * Validate that a string looks like a 32-character hex trace ID.
 *
 * Returns the validated trace ID so it can be used as a Stricli `parse`
 * function directly.
 *
 * @param traceId - The trace ID string to validate
 * @returns The validated trace ID (unchanged)
 * @throws {ValidationError} If the trace ID format is invalid
 */
export function validateTraceId(traceId: string): string {
  if (!TRACE_ID_RE.test(traceId)) {
    throw new ValidationError(
      `Invalid trace ID "${traceId}". Expected a 32-character hexadecimal string.\n\n` +
        "Example: abc123def456abc123def456abc123de"
    );
  }
  return traceId;
}
