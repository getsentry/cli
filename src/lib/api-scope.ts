/**
 * Scope extraction helpers for Sentry 403 responses.
 *
 * The primary goal is to surface the specific permission scope a token
 * is missing, instead of the hardcoded generic "org:read, project:read"
 * list referenced in getsentry/cli#785 item #9.
 *
 * Reality check against the Sentry codebase (getsentry/sentry
 * `src/sentry/api/bases/organization.py` and `src/sentry/api/base.py`):
 * the standard 403 path is a DRF `PermissionDenied` with the default
 * `"You do not have permission to perform this action."` string — no
 * structured scope field, no scope identifier in the text. A handful
 * of sites pass a custom `detail` string (for example
 * `src/sentry/api/helpers/teams.py` and `src/sentry/api/endpoints/
 * rule_snooze.py`), and those strings are free-form but sometimes
 * mention scope identifiers verbatim.
 *
 * This module therefore:
 *
 * - Scans the detail text for exact scope identifiers from the
 *   canonical {@link SENTRY_SCOPES} set. Matches are only real
 *   identifiers; arbitrary `foo:bar` substrings in error text never
 *   get surfaced as scopes.
 * - Also peeks at a few structured field names
 *   (`required` / `requiredScopes` / `scopes`) that Sentry could
 *   reasonably start emitting in the future. These paths are zero-cost
 *   when absent and future-proof the CLI against a backend change that
 *   adds them.
 *
 * Callers that receive an empty array should fall back to their own
 * hardcoded defaults (mirrors the pre-fix behavior).
 */

/**
 * Canonical Sentry scope identifiers, mirrored from
 * `src/sentry/conf/server.py` `SENTRY_SCOPES` (and its hierarchy
 * mapping). Kept as a single source of truth so the regex and tests
 * agree on what is and isn't a real scope.
 *
 * Deliberately excluded:
 * - `openid` / `profile` / `email` — OIDC scopes, never part of a
 *   CLI 403 response.
 * - `org:superuser` — internal-only, never returned to clients.
 */
const SENTRY_SCOPES = [
  "org:read",
  "org:write",
  "org:admin",
  "org:integrations",
  "org:ci",
  "member:invite",
  "member:read",
  "member:write",
  "member:admin",
  "team:read",
  "team:write",
  "team:admin",
  "project:read",
  "project:write",
  "project:admin",
  "project:releases",
  "project:distribution",
  "event:read",
  "event:write",
  "event:admin",
  "alerts:read",
  "alerts:write",
] as const;

/**
 * Build a word-bounded alternation regex from {@link SENTRY_SCOPES}.
 *
 * Using an explicit alternation (rather than a `<ns>:<action>` product)
 * avoids matching nonexistent combinations like `release:write` or
 * `alerts:admin`, which `SENTRY_SCOPES` doesn't list. `:` is not a
 * regex metacharacter so the scope strings need no escaping.
 */
const KNOWN_SCOPE_RE = new RegExp(`\\b(?:${SENTRY_SCOPES.join("|")})\\b`, "gi");

/**
 * Extract Sentry scope identifiers from a 403 response detail value.
 *
 * Current Sentry API responses rarely name the missing scope (see the
 * module-level notes), so this function usually returns `[]` and
 * callers fall back to their hardcoded default hint. It DOES fire
 * correctly when the scope appears in a custom DRF `PermissionDenied`
 * detail string, and remains future-proof for structured response
 * shapes that could be added later.
 *
 * @param detail - The ApiError.detail value from a 403 response.
 *   May be a plain string, a structured record, or `undefined`.
 * @returns Deduplicated, source-ordered list of known Sentry scope
 *   identifiers (e.g. `["event:read"]`). Empty when none found.
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
