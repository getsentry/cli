/**
 * Sentry search query sanitization.
 *
 * Handles boolean operator rewriting for `--query` flags across all
 * commands that accept Sentry search syntax. Centralised here so every
 * command benefits from the same auto-recovery logic.
 *
 * - **AND**: Sentry search implicitly ANDs space-separated terms, so
 *   explicit `AND` is redundant. Stripped with a warning.
 * - **OR**: Attempted rewrite to in-list syntax (`key:[val1,val2]`)
 *   when all OR operands share the same qualifier key. Throws a
 *   {@link ValidationError} when the rewrite is not possible.
 *
 * The canonical Sentry search grammar lives at:
 *   https://github.com/getsentry/sentry/blob/master/static/app/components/searchSyntax/grammar.pegjs
 *
 * The backend's simpler tokenizer that issue search actually uses:
 *   https://github.com/getsentry/sentry/blob/master/src/sentry/search/utils.py
 *   (see `split_query_into_tokens` and `tokenize_query`)
 */

import { ValidationError } from "./errors.js";
import { logger } from "./logger.js";

const log = logger.withTag("search-query");

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a Sentry search query respecting quoted strings.
 *
 * This regex is functionally equivalent to `split_query_into_tokens()` in
 * the Sentry backend (`src/sentry/search/utils.py`) for the purpose of
 * detecting standalone boolean operators. It splits on whitespace while
 * keeping `key:"quoted value with spaces"` as a single token.
 *
 * Minor differences from the backend tokenizer (acceptable for our use case):
 * - Does not handle single-quoted strings (`'value'`) — rare in CLI context
 * - Does not join `key: value` (colon-space) into one token — irrelevant
 *   since AND/OR are never qualifier values with a preceding colon
 * - Does not handle escaped quotes (`\"`) inside strings — edge case
 */
export const QUERY_TOKEN_RE = /(?:[^\s"]*"[^"]*"[^\s"]*)|[^\s]+/g;

// ---------------------------------------------------------------------------
// Qualifier parsing
// ---------------------------------------------------------------------------

/**
 * Matches a Sentry search qualifier token: `key:value` or `!key:value`.
 *
 * Captures:
 * - Group 1: `!` prefix (negation, may be empty)
 * - Group 2: key name (alphanumeric, dots, brackets, dashes)
 * - Group 3: value (everything after the first colon)
 */
const QUALIFIER_RE = /^(!?)([a-zA-Z0-9_.[\]-]+):(.+)$/;

/**
 * Detects an existing in-list value: `[val1,val2,...]`.
 * Captures the raw comma-separated content inside the brackets.
 */
const IN_LIST_VALUE_RE = /^\[(.+)\]$/;

/**
 * Keys that do not support in-list syntax in Sentry search.
 *
 * - `is`: Explicitly documented as unsupported by Sentry docs
 * - `has`: Uses `search_value` not `text_in_list` in the PEG grammar
 */
const INVALID_INLIST_KEYS = new Set(["is", "has"]);

/** Parsed qualifier token. */
type ParsedQualifier = {
  negated: boolean;
  key: string;
  value: string;
};

/**
 * Parse a token as a Sentry search qualifier (`key:value`).
 *
 * @returns The parsed qualifier, or `null` for free-text tokens.
 */
function parseQualifier(token: string): ParsedQualifier | null {
  const match = token.match(QUALIFIER_RE);
  if (!match) {
    return null;
  }
  return {
    negated: !!match[1],
    key: match[2] as string,
    value: match[3] as string,
  };
}

// ---------------------------------------------------------------------------
// In-list value handling
// ---------------------------------------------------------------------------

/**
 * Split an in-list value string into individual values, respecting quotes.
 *
 * Handles `["a,b",c]` correctly by not splitting on commas inside `"..."`.
 * The input should be the raw content inside the brackets (without `[` / `]`).
 *
 * @example
 * ```ts
 * splitInListValues('"foo bar",baz,"a,b"')
 * // → ['"foo bar"', 'baz', '"a,b"']
 * ```
 */
function splitInListValues(raw: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuote = false;
  for (const ch of raw) {
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === "," && !inQuote) {
      values.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) {
    values.push(current);
  }
  return values;
}

/**
 * Extract individual values from a qualifier value, flattening in-list brackets.
 *
 * - `"plain"` → `["plain"]`
 * - `"[a,b,c]"` → `["a", "b", "c"]`
 * - `'["foo bar",baz]'` → `['"foo bar"', 'baz']`
 */
function extractValues(value: string): string[] {
  const listMatch = value.match(IN_LIST_VALUE_RE);
  if (listMatch?.[1]) {
    return splitInListValues(listMatch[1]);
  }
  return [value];
}

// ---------------------------------------------------------------------------
// OR → in-list rewriting
// ---------------------------------------------------------------------------

/**
 * Try to merge a group of qualifier tokens into in-list syntax.
 *
 * All tokens must be qualifiers with the same key (case-insensitive),
 * the key must support in-list syntax, and no token may be negated or
 * contain wildcards.
 *
 * @returns The merged token (e.g. `key:[a,b,c]`), or `null` if merging
 *   is not possible.
 */
function tryMergeQualifiers(group: string[]): string | null {
  const parsed: ParsedQualifier[] = [];
  for (const token of group) {
    const q = parseQualifier(token);
    if (!q) {
      return null;
    }
    parsed.push(q);
  }

  const first = parsed[0];
  if (!first) {
    return null;
  }
  if (!canMergeQualifiers(parsed)) {
    return null;
  }

  // Collect and flatten all values (handles existing in-list brackets)
  const allValues: string[] = [];
  for (const q of parsed) {
    allValues.push(...extractValues(q.value));
  }

  // Preserve the key casing from the first token
  return `${first.key}:[${allValues.join(",")}]`;
}

/**
 * Check whether a set of parsed qualifiers can be merged into in-list syntax.
 *
 * Rejects when keys differ, the key is invalid for in-list, any qualifier
 * is negated, or any value contains wildcards.
 */
function canMergeQualifiers(parsed: ParsedQualifier[]): boolean {
  const first = parsed[0];
  if (!first) {
    return false;
  }

  // All must have the same key (case-insensitive)
  const keyLower = first.key.toLowerCase();
  for (const q of parsed) {
    if (q.key.toLowerCase() !== keyLower) {
      return false;
    }
  }

  // Key must be valid for in-list
  if (INVALID_INLIST_KEYS.has(keyLower)) {
    return false;
  }

  // No negation allowed (negated in-list has different semantics)
  if (parsed.some((q) => q.negated)) {
    return false;
  }

  // No wildcards in values
  if (parsed.some((q) => q.value.includes("*"))) {
    return false;
  }

  return true;
}

/** Check whether a token is a standalone OR operator (case-insensitive). */
function isOrToken(token: string): boolean {
  return token.toUpperCase() === "OR";
}

/**
 * Collect a single OR-chain starting at index `start`.
 *
 * An OR-chain is a sequence of non-OR tokens connected by OR tokens:
 * `tok OR tok OR tok`. Returns the group of non-OR tokens and the
 * index past the end of the chain.
 *
 * @param tokens - Full token list
 * @param start - Index of the first non-OR token in the chain
 * @returns `[group, nextIndex]`
 */
function collectOrChain(tokens: string[], start: number): [string[], number] {
  // start is always a valid index (caller guarantees)
  const group = [tokens[start] as string];
  let j = start + 1;

  while (j < tokens.length && isOrToken(tokens[j] as string)) {
    j += 1; // skip the OR
    // Skip consecutive ORs (e.g. "a OR OR b")
    while (j < tokens.length && isOrToken(tokens[j] as string)) {
      j += 1;
    }
    if (j < tokens.length) {
      group.push(tokens[j] as string);
      j += 1;
    }
  }

  return [group, j];
}

/**
 * Attempt to rewrite all OR groups in the token list to in-list syntax.
 *
 * OR binds the immediately adjacent non-OR tokens into chains.
 * Each chain is passed to {@link tryMergeQualifiers}. If every chain
 * rewrites successfully, the result is returned; otherwise `null`.
 *
 * @param tokens - Token list with AND already stripped but OR preserved
 * @returns The fully rewritten query, or `null` if any OR group can't
 *   be rewritten.
 */
/**
 * Merge an OR group into a single token, or return `null` if not possible.
 * Single-element groups pass through unchanged.
 */
function mergeOrGroup(group: string[]): string | null {
  const first = group[0];
  if (group.length === 1 && first) {
    return first;
  }
  return tryMergeQualifiers(group);
}

function tryRewriteOr(tokens: string[]): string | null {
  const result: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const current = tokens[i] as string;

    // Skip stray leading/consecutive OR tokens
    if (isOrToken(current)) {
      i += 1;
      continue;
    }

    // Check if this token starts an OR chain
    const next = tokens[i + 1];
    if (next && isOrToken(next)) {
      const [group, nextIndex] = collectOrChain(tokens, i);
      const merged = mergeOrGroup(group);
      if (!merged) {
        return null;
      }
      result.push(merged);
      i = nextIndex;
    } else {
      // Regular token — pass through
      result.push(current);
      i += 1;
    }
  }

  return result.join(" ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a `--query` value before sending to the Sentry API.
 *
 * Tokenizes the query respecting quoted strings, then handles boolean
 * operators:
 *
 * - **AND**: Stripped (implicit in Sentry search). Warns via stderr.
 * - **OR**: Attempted rewrite to in-list syntax (`key:[val1,val2]`).
 *   Succeeds when all OR operands share the same valid qualifier key.
 *   Throws {@link ValidationError} when the rewrite is not possible.
 *
 * Tokens inside quoted values (`message:"error OR timeout"`) or qualifier
 * values (`tag:OR`) are never standalone and are not matched.
 *
 * @param query - Raw query string from `--query` flag
 * @returns The sanitized query string with AND stripped and OR rewritten
 * @throws {ValidationError} When OR cannot be rewritten to in-list syntax
 */
export function sanitizeQuery(query: string): string {
  const tokens = query.match(QUERY_TOKEN_RE) ?? [];

  let hasOr = false;
  let hasAnd = false;
  const withOrPreserved: string[] = [];

  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (upper === "OR") {
      hasOr = true;
      withOrPreserved.push(token); // preserve for rewrite attempt
    } else if (upper === "AND") {
      hasAnd = true;
      // strip AND (implicit in Sentry search)
    } else {
      withOrPreserved.push(token);
    }
  }

  if (hasOr) {
    return handleOr(withOrPreserved, hasAnd);
  }

  if (hasAnd) {
    const sanitized = withOrPreserved.join(" ");
    log.warn(
      "Sentry search implicitly ANDs terms — removed explicit AND operator. " +
        `Running query: "${sanitized}"`
    );
    return sanitized;
  }

  return query;
}

/**
 * Handle the OR rewrite path — extracted to keep `sanitizeQuery` under
 * the cognitive complexity limit.
 */
function handleOr(tokens: string[], hasAnd: boolean): string {
  const rewritten = tryRewriteOr(tokens);
  if (rewritten !== null) {
    const notes: string[] = [];
    notes.push("Rewrote OR using in-list syntax: key:[val1,val2].");
    if (hasAnd) {
      notes.push("Also removed explicit AND (implicit in Sentry search).");
    }
    notes.push(`Running query: "${rewritten}"`);
    log.warn(notes.join(" "));
    return rewritten;
  }

  throw new ValidationError(
    "Could not rewrite OR into Sentry search syntax.\n\n" +
      "OR can be auto-rewritten when all terms share the same qualifier key:\n" +
      "  level:error OR level:warning  →  level:[error,warning]\n\n" +
      "Patterns that cannot be rewritten:\n" +
      "  - Free-text terms without a key (error OR timeout)\n" +
      "  - Different keys (level:error OR assigned:me)\n" +
      "  - is: or has: qualifiers (not supported with in-list)\n" +
      "  - Negated qualifiers (!key:val1 OR !key:val2)\n\n" +
      "Alternatives:\n" +
      '  - Write in-list syntax directly: --query "key:[val1,val2]"\n' +
      "  - Run separate queries for each term\n\n" +
      "Search syntax: https://docs.sentry.io/concepts/search/",
    "query"
  );
}

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------

/**
 * @internal Exported for testing only. Not part of the public API.
 */
export const __testing = {
  parseQualifier,
  splitInListValues,
  extractValues,
  tryMergeQualifiers,
  tryRewriteOr,
};
