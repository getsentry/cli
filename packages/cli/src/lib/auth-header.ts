/** Validated Authorization values for the selected Sentry credential. */

import { AuthError } from "./errors.js";

/** Bearer tokens are opaque, but cannot contain whitespace or non-ASCII bytes. */
const INVALID_TOKEN_CHARACTER_PATTERN = /[^\x21-\x7e]/;

/** Validate a selected credential before constructing its Authorization value. */
export function formatAuthHeader(token: string): string {
  if (!token || INVALID_TOKEN_CHARACTER_PATTERN.test(token)) {
    throw new AuthError(
      "invalid",
      "Invalid authentication token. Copy it again as a single line without spaces or control characters, " +
        "or run 'sentry auth login' to replace stored credentials."
    );
  }
  return `Bearer ${token}`;
}
