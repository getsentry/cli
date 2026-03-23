/**
 * Shared Hex ID Validation
 *
 * Provides regex and validation for hexadecimal identifiers used across
 * the CLI (trace IDs, log IDs, span IDs, etc.).
 */

import { ValidationError } from "./errors.js";

/** Regex for a valid 32-character hexadecimal ID */
export const HEX_ID_RE = /^[0-9a-f]{32}$/i;

/** Regex for a valid 16-character hexadecimal span ID */
export const SPAN_ID_RE = /^[0-9a-f]{16}$/i;

/**
 * Regex for UUID format with dashes: 8-4-4-4-12 hex groups.
 * Users often copy trace/log IDs from tools that display them in UUID format.
 * Stripping the dashes yields a valid 32-character hex ID.
 */
export const UUID_DASH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max display length for invalid IDs in error messages before truncation */
const MAX_DISPLAY_LENGTH = 40;

/** Matches any character that is NOT a lowercase hex digit (used for slug detection in error hints) */
const NON_HEX_RE = /[^0-9a-f]/;

/**
 * Normalize a potential hex ID: trim, lowercase, strip UUID dashes.
 * Does NOT validate — call this before checking {@link HEX_ID_RE}.
 *
 * Extracted so that both {@link validateHexId} and non-throwing predicates
 * (like `isTraceId`) share identical normalization logic.
 *
 * @param value - The raw string to normalize
 * @returns The trimmed, lowercased string with UUID dashes stripped if applicable
 */
export function normalizeHexId(value: string): string {
  let trimmed = value.trim().toLowerCase();
  if (UUID_DASH_RE.test(trimmed)) {
    trimmed = trimmed.replace(/-/g, "");
  }
  return trimmed;
}

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
  const normalized = normalizeHexId(value);

  if (!HEX_ID_RE.test(normalized)) {
    const display =
      normalized.length > MAX_DISPLAY_LENGTH
        ? `${normalized.slice(0, MAX_DISPLAY_LENGTH - 3)}...`
        : normalized;

    let message =
      `Invalid ${label} "${display}". Expected a 32-character hexadecimal string.\n\n` +
      "Example: abc123def456abc123def456abc123de";

    // Detect common misidentified entity types and add helpful hints
    if (SPAN_ID_RE.test(normalized)) {
      // 16-char hex looks like a span ID
      message +=
        "\n\nThis looks like a span ID (16 characters). " +
        `If you have the trace ID, try: sentry span view <trace-id> ${display}`;
    } else if (NON_HEX_RE.test(normalized)) {
      // Contains non-hex characters — likely a slug or name
      message +=
        `\n\nThis doesn't look like a hex ID. If this is a project, ` +
        `specify it before the ID: <org>/<project> <${label}>`;
    }

    throw new ValidationError(message);
  }

  return normalized;
}

/**
 * Validate that a string is a 16-character hexadecimal span ID.
 * Trims whitespace and normalizes to lowercase before validation.
 *
 * Dashes are stripped automatically so users can paste IDs in dash-separated
 * formats (e.g., from debugging tools that format span IDs with dashes).
 *
 * @param value - The string to validate
 * @returns The trimmed, lowercased, validated span ID
 * @throws {ValidationError} If the format is invalid
 */
export function validateSpanId(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/-/g, "");

  if (!SPAN_ID_RE.test(trimmed)) {
    const display =
      trimmed.length > MAX_DISPLAY_LENGTH
        ? `${trimmed.slice(0, MAX_DISPLAY_LENGTH - 3)}...`
        : trimmed;

    let message =
      `Invalid span ID "${display}". Expected a 16-character hexadecimal string.\n\n` +
      "Example: a1b2c3d4e5f67890";

    // Detect 32-char hex (trace/log ID) passed as span ID
    if (HEX_ID_RE.test(trimmed)) {
      message +=
        "\n\nThis looks like a trace ID (32 characters), not a span ID.";
    }

    throw new ValidationError(message);
  }

  return trimmed;
}
