/** Validated Authorization values for the selected Sentry credential. */

import { MalformedAuthTokenError } from "./errors.js";

/** Bearer tokens are opaque, but cannot contain whitespace or non-ASCII bytes. */
const INVALID_TOKEN_CHARACTER_PATTERN = /[^\x21-\x7e]/;

/** Remove surrounding whitespace and validate the remaining credential. */
export function normalizeAuthToken(token: string): string {
  const normalized = token.trim();
  if (!normalized || INVALID_TOKEN_CHARACTER_PATTERN.test(normalized)) {
    throw new MalformedAuthTokenError();
  }
  return normalized;
}

/** Normalize and validate a credential before constructing its Authorization value. */
export function formatAuthHeader(token: string): string {
  return `Bearer ${normalizeAuthToken(token)}`;
}
