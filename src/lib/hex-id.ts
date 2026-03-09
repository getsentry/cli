/**
 * Shared Hex ID Validation
 *
 * Provides regex and validation for 32-character hexadecimal identifiers
 * used across the CLI (log IDs, trace IDs, etc.).
 */

import { ValidationError } from "./errors.js";

/** Regex for a valid 32-character hexadecimal ID */
export const HEX_ID_RE = /^[0-9a-f]{32}$/i;

/**
 * Regex for UUID format with dashes: 8-4-4-4-12 hex groups.
 * Users often copy trace/log IDs from tools that display them in UUID format.
 * Stripping the dashes yields a valid 32-character hex ID.
 */
export const UUID_DASH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max display length for invalid IDs in error messages before truncation */
const MAX_DISPLAY_LENGTH = 40;

/**
 * Validate that a string is a 32-character hexadecimal ID.
 * Trims whitespace and normalizes to lowercase before validation.
 *
 * When the input matches UUID format (8-4-4-4-12 hex with dashes), the dashes
 * are automatically stripped. This is a common copy-paste mistake — the
 * underlying hex content is valid, just formatted differently.
 *
 * Normalization to lowercase ensures consistent comparison with API responses,
 * which return lowercase hex IDs regardless of input casing.
 *
 * Returns the trimmed, lowercased, validated ID so it can be used as a Stricli
 * `parse` function directly.
 *
 * @param value - The string to validate
 * @param label - Human-readable name for error messages (e.g., "log ID", "trace ID")
 * @returns The trimmed, lowercased, validated ID
 * @throws {ValidationError} If the format is invalid
 */
export function validateHexId(value: string, label: string): string {
  let trimmed = value.trim().toLowerCase();

  // Auto-correct UUID format: strip dashes (8-4-4-4-12 → 32 hex chars)
  if (UUID_DASH_RE.test(trimmed)) {
    trimmed = trimmed.replace(/-/g, "");
  }

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
