/**
 * Extract Sentry scope identifiers from a 403 response, so we can hint
 * at the specific missing scope instead of a hardcoded default
 * (getsentry/cli#785 #9).
 *
 * Sentry's standard 403 path is a DRF `PermissionDenied` with no
 * structured scope info, but some endpoints include the scope in the
 * free-text `detail`. We also peek at a few plausible structured field
 * names (`required` / `requiredScopes` / `scopes`) in case they're
 * added later. Empty result → callers fall back to their defaults.
 */

/**
 * Canonical Sentry scopes, mirrored from getsentry/sentry
 * `src/sentry/conf/server.py` SENTRY_SCOPES. Excludes OIDC scopes
 * (`openid`/`profile`/`email`) and internal-only `org:superuser`.
 *
 * Exported so `auth login --scope` can validate user-supplied scope values
 * against the authoritative set rather than the narrower subset the CLI
 * requests by default ({@link OAUTH_SCOPES}).
 */
export const SENTRY_SCOPES = [
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

const OAUTH_SCOPE_TOKEN_RE = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const BEARER_CHALLENGE_RE = /^Bearer\s+(.+)$/i;
const AUTH_SCHEME_TOKEN_CHAR_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]$/;
const SCOPE_SEPARATOR_RE = /\s+/;
const MISSING_BEFORE_SCOPE_RE =
  /(?:missing|lacks?|without|insufficient|required)[^.\n]{0,80}scopes?/;
const SCOPE_BEFORE_MISSING_RE =
  /scopes?[^.\n]{0,80}(?:missing|required|insufficient)/;
const TOKEN_MISSING_RE =
  /(?:token|authorization|oauth)[^.\n]{0,120}(?:missing|lacks?|without|insufficient)/;
const EXPLICIT_SCOPE_REQUIREMENT_RE =
  /(?:required\s*:|obtaining[^.\n]{0,80}scope)/;

// Explicit alternation (not `<ns>:<action>` product) rejects nonexistent
// combinations like `release:write` or `alerts:admin`. `:` is not a
// regex metachar so no escaping needed.
const KNOWN_SCOPE_RE = new RegExp(`\\b(?:${SENTRY_SCOPES.join("|")})\\b`, "gi");

const SCOPE_FIELD_NAMES = ["required", "requiredScopes", "scopes"] as const;

/**
 * Extract Sentry scope identifiers from a 403 response detail.
 *
 * @param detail - ApiError.detail value; string, object, or undefined
 * @returns Deduplicated, source-ordered scope identifiers. Empty when none found.
 */
export function extractRequiredScopes(detail: unknown): string[] {
  if (!detail) {
    return [];
  }
  const serializedDetail =
    typeof detail === "string" ? detail : JSON.stringify(detail);
  if (isMemberProjectCreationPolicy(serializedDetail)) {
    return [];
  }
  if (typeof detail === "object") {
    const fromFields = extractFromRecord(detail as Record<string, unknown>);
    if (fromFields.length > 0) {
      return fromFields;
    }
    // Fall back to scanning the serialized form to catch non-standard keys.
    return extractFromText(JSON.stringify(detail));
  }
  if (typeof detail === "string") {
    return extractFromText(detail);
  }
  return [];
}

/**
 * Extract required scopes from an RFC 6750 Bearer challenge.
 *
 * Unlike the legacy response-body parser above, this accepts valid scopes
 * that a newer Sentry server may introduce after this CLI was released. The
 * challenge is authoritative, so recovery can remain generic when the CLI's
 * standard OAuth scope set grows in the future.
 *
 * @param header - The `WWW-Authenticate` response header
 * @returns Deduplicated, source-ordered scopes for `insufficient_scope`
 */
export function extractRequiredScopesFromWwwAuthenticate(
  header: string | null | undefined
): string[] {
  if (!header) {
    return [];
  }
  for (const challenge of splitAuthenticateChallenges(header)) {
    const bearer = BEARER_CHALLENGE_RE.exec(challenge);
    if (!bearer?.[1]) {
      continue;
    }
    const params = bearer[1];
    const error = extractAuthParam(params, "error");
    if (error?.toLowerCase() !== "insufficient_scope") {
      continue;
    }
    const scope = extractAuthParam(params, "scope");
    if (!scope) {
      continue;
    }
    return [
      ...new Set(
        scope
          .split(SCOPE_SEPARATOR_RE)
          .filter((candidate) => OAUTH_SCOPE_TOKEN_RE.test(candidate))
      ),
    ];
  }
  return [];
}

function splitAuthenticateChallenges(header: string): string[] {
  const challenges: string[] = [];
  let challengeStart = 0;
  let inQuotes = false;
  let escaped = false;

  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inQuotes) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char !== "," || inQuotes) {
      continue;
    }

    const nextSchemeStart = findNextAuthSchemeStart(header, index + 1);
    if (nextSchemeStart === undefined) {
      continue;
    }
    challenges.push(header.slice(challengeStart, index).trim());
    challengeStart = nextSchemeStart;
  }

  challenges.push(header.slice(challengeStart).trim());
  return challenges.filter(Boolean);
}

function findNextAuthSchemeStart(
  header: string,
  offset: number
): number | undefined {
  let cursor = offset;
  while (header[cursor] === " " || header[cursor] === "\t") {
    cursor += 1;
  }
  const tokenStart = cursor;
  while (
    cursor < header.length &&
    AUTH_SCHEME_TOKEN_CHAR_RE.test(header[cursor] as string)
  ) {
    cursor += 1;
  }
  if (
    cursor > tokenStart &&
    (header[cursor] === " " || header[cursor] === "\t")
  ) {
    return tokenStart;
  }
  return;
}

function extractAuthParam(header: string, name: string): string | undefined {
  const pattern = new RegExp(
    `(?:^|[,\\s])${name}\\s*=\\s*(?:"([^"]*)"|([^,\\s]+))`,
    "i"
  );
  const match = pattern.exec(header);
  return match?.[1] ?? match?.[2];
}

/** A role/policy denial can mention scope names without a token lacking them. */
function isMemberProjectCreationPolicy(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("disabled this feature for members") ||
    normalized.includes("org-level policy setting, not an auth issue")
  );
}

function extractFromRecord(record: Record<string, unknown>): string[] {
  for (const field of SCOPE_FIELD_NAMES) {
    const value = record[field];
    if (!Array.isArray(value)) {
      continue;
    }
    const scopes = collectScopesFromArray(value);
    if (scopes.length > 0) {
      return [...new Set(scopes)];
    }
  }
  return [];
}

/** Accepts both bare strings and `{scope: "..."}` objects. */
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

/** Tests + resets the shared `g`-flagged regex. */
function matchesKnownScope(scope: string): boolean {
  const matched = KNOWN_SCOPE_RE.test(scope);
  KNOWN_SCOPE_RE.lastIndex = 0;
  return matched;
}

function extractFromText(text: string): string[] {
  if (!describesMissingTokenScope(text)) {
    return [];
  }
  const matches = text.match(KNOWN_SCOPE_RE);
  if (!matches) {
    return [];
  }
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

function describesMissingTokenScope(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    MISSING_BEFORE_SCOPE_RE.test(normalized) ||
    SCOPE_BEFORE_MISSING_RE.test(normalized) ||
    TOKEN_MISSING_RE.test(normalized) ||
    EXPLICIT_SCOPE_REQUIREMENT_RE.test(normalized)
  );
}
