/**
 * Scope extraction helpers for Sentry 403 responses.
 *
 * Sentry's 403 responses occasionally include the specific permission
 * scope the token is missing — either as an explicit field on the JSON
 * body or embedded in the `detail` message string. This module pulls
 * that information out so we can surface it to users instead of the
 * hardcoded generic "org:read, project:read" list referenced in
 * getsentry/cli#785 item #9.
 *
 * Response shapes observed in the wild:
 *
 * 1. `{"detail": "You do not have permission to perform this action."}`
 *    Plain — nothing to extract.
 *
 * 2. `{"detail": "You do not have the required scope to perform this
 *    action. Required scopes: event:read"}`
 *    Scope named in the detail string.
 *
 * 3. Top-level `required` / `requiredScopes` arrays on some endpoints:
 *    `{"detail": "...", "required": ["event:read"]}`
 *
 * This module's sole contract is: given an API-response detail value,
 * return the subset of Sentry scope identifiers that appear in it, in
 * source order, deduplicated. Callers decide how to render them.
 */

/**
 * Matches a Sentry scope identifier of the form `<resource>:<action>`.
 *
 * The scope namespace is short and well-known — we match only the
 * resources the CLI's OAuth flow requests plus the small set of
 * adjacent scopes users commonly need. Unrecognized pairs stay out of
 * the match list so random `foo:bar` substrings in error messages
 * don't get surfaced as scopes.
 */
const KNOWN_SCOPE_RE =
  /\b(?:org|project|team|member|event|release|alerts)(?::(?:read|write|admin))\b/gi;

/**
 * Extract Sentry scope identifiers from a 403 response detail value.
 *
 * The detail may be a plain string, a structured record with a
 * `required` / `requiredScopes` / `scopes` array, or `undefined`. All
 * three shapes are handled. Returns an empty array when no scopes are
 * identifiable — callers should fall back to their hardcoded defaults
 * in that case.
 *
 * @param detail - The ApiError.detail value from a 403 response
 * @returns Deduplicated, source-ordered list of scope identifiers
 *   (e.g. `["event:read"]`)
 */
export function extractRequiredScopes(detail: unknown): string[] {
  if (!detail) {
    return [];
  }

  // Structured shapes: look for common field names used by Sentry.
  if (typeof detail === "object") {
    const scopes = extractFromRecord(detail as Record<string, unknown>);
    if (scopes.length > 0) {
      return scopes;
    }
    // Fall through to serializing the object and scanning the text
    // form — still catches cases where the detail carries scope info
    // under a non-standard key name.
    return extractFromText(JSON.stringify(detail));
  }

  if (typeof detail === "string") {
    return extractFromText(detail);
  }

  return [];
}

/** Candidate field names carrying scope arrays on Sentry API responses. */
const SCOPE_FIELD_NAMES = ["required", "requiredScopes", "scopes"] as const;

/**
 * Look for a scope-like string array on any of the known field names.
 *
 * Accepts both plain arrays and arrays of `{scope: "..."}` objects —
 * both shapes have appeared historically in Sentry's responses.
 */
function extractFromRecord(record: Record<string, unknown>): string[] {
  for (const field of SCOPE_FIELD_NAMES) {
    const value = record[field];
    if (!Array.isArray(value)) {
      continue;
    }
    const scopes = collectScopesFromArray(value);
    if (scopes.length > 0) {
      return dedupe(scopes);
    }
  }
  return [];
}

/**
 * Normalize a heterogeneous array of scope-like entries into a flat
 * lowercase scope list. Entries that aren't strings or
 * `{scope: string}` objects are silently dropped.
 */
function collectScopesFromArray(entries: unknown[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const scope = extractScopeCandidate(entry);
    if (scope && matchesKnownScope(scope)) {
      out.push(scope.toLowerCase());
    }
  }
  return out;
}

/** Extract a string scope candidate from either a bare string or a `{scope}` object. */
function extractScopeCandidate(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry;
  }
  if (
    entry &&
    typeof entry === "object" &&
    "scope" in entry &&
    typeof (entry as { scope: unknown }).scope === "string"
  ) {
    return (entry as { scope: string }).scope;
  }
  return;
}

/** Test + reset lastIndex on the shared `g`-flagged regex. */
function matchesKnownScope(scope: string): boolean {
  const matched = KNOWN_SCOPE_RE.test(scope);
  KNOWN_SCOPE_RE.lastIndex = 0;
  return matched;
}

/** Pull scope identifiers out of a free-text detail message. */
function extractFromText(text: string): string[] {
  const matches = text.match(KNOWN_SCOPE_RE);
  if (!matches) {
    return [];
  }
  return dedupe(matches.map((m) => m.toLowerCase()));
}

/** Deduplicate while preserving insertion order. */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}
