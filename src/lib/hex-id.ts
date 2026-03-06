/**
 * Shared Hex ID Validation
 *
 * Provides regex and validation for 32-character hexadecimal identifiers
 * used across the CLI (log IDs, trace IDs, etc.).
 */

import { ValidationError } from "./errors.js";

/** Regex for a valid 32-character hexadecimal ID */
export const HEX_ID_RE = /^[0-9a-f]{32}$/i;

/** Max display length for invalid IDs in error messages before truncation */
const MAX_DISPLAY_LENGTH = 40;

/**
 * Validate that a string is a 32-character hexadecimal ID.
 * Trims whitespace before validation.
 *
 * Returns the trimmed, validated ID so it can be used as a Stricli `parse`
 * function directly.
 *
 * @param value - The string to validate
 * @param label - Human-readable name for error messages (e.g., "log ID", "trace ID")
 * @returns The trimmed, validated ID
 * @throws {ValidationError} If the format is invalid
 */
export function validateHexId(value: string, label: string): string {
  const trimmed = value.trim();

  if (!HEX_ID_RE.test(trimmed)) {
    const display =
      trimmed.length > MAX_DISPLAY_LENGTH
        ? `${trimmed.slice(0, MAX_DISPLAY_LENGTH - 3)}...`
        : trimmed;
    throw new ValidationError(
      `Invalid ${label} "${display}". Expected a 32-character hexadecimal string.\n\n` +
        "Example: abc123def456abc123def456abc123de"
    );
  }

  return trimmed;
}
