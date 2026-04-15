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
 * Parsing uses a pre-compiled PEG parser generated from
 * `src/lib/search-query.pegjs` (a simplified version of Sentry's
 * canonical grammar). The parser classifies every term structurally —
 * comparison operators, in-list values, paren groups, etc. — so the
 * rewriting logic doesn't need regex-based reject-lists.
 *
 * @see {@link https://github.com/getsentry/sentry/blob/master/static/app/components/searchSyntax/grammar.pegjs | Canonical Sentry PEG grammar}
 */

import type { SearchNode } from "../generated/search-parser.js";
import { parse } from "../generated/search-parser.js";
import { ValidationError } from "./errors.js";
import { logger } from "./logger.js";

const log = logger.withTag("search-query");

/**
 * Keys that do not support in-list syntax in Sentry search.
 *
 * - `is`: Explicitly documented as unsupported by Sentry docs
 * - `has`: Uses `search_value` not `text_in_list` in the PEG grammar
 */
const INVALID_INLIST_KEYS = new Set(["is", "has"]);

// ---------------------------------------------------------------------------
// AST → string serialization
// ---------------------------------------------------------------------------

/** Serialize a single AST node back to query string form. */
function serializeNode(node: SearchNode): string {
  switch (node.type) {
    case "boolean_op": {
      return node.op;
    }
    case "free_text": {
      return node.value;
    }
    case "paren_group": {
      return node.raw;
    }
    case "text_filter": {
      const prefix = node.negated ? "!" : "";
      return `${prefix}${node.key}:${node.value}`;
    }
    case "text_in_filter": {
      const prefix = node.negated ? "!" : "";
      return `${prefix}${node.key}:[${node.values.join(",")}]`;
    }
    case "comparison_filter": {
      const prefix = node.negated ? "!" : "";
      return `${prefix}${node.key}:${node.op}${node.value}`;
    }
    default: {
      return "";
    }
  }
}

/** Serialize a list of AST nodes back to a query string. */
function serializeNodes(nodes: SearchNode[]): string {
  return nodes.map(serializeNode).join(" ");
}

// ---------------------------------------------------------------------------
// OR → in-list rewriting
// ---------------------------------------------------------------------------

/**
 * Check whether an AST node can participate in an in-list merge.
 *
 * Only `text_filter` and `text_in_filter` nodes with valid keys (not
 * `is:`/`has:`), no negation, and no wildcards are eligible.
 * Comparison filters, free text, paren groups, and boolean ops cannot.
 */
function isMergeableFilter(
  node: SearchNode
): node is
  | (SearchNode & { type: "text_filter" })
  | (SearchNode & { type: "text_in_filter" }) {
  if (node.type === "text_filter") {
    if (node.negated) {
      return false;
    }
    if (INVALID_INLIST_KEYS.has(node.key.toLowerCase())) {
      return false;
    }
    return !node.value.includes("*");
  }
  if (node.type === "text_in_filter") {
    if (node.negated) {
      return false;
    }
    return !INVALID_INLIST_KEYS.has(node.key.toLowerCase());
  }
  return false;
}

/** Extract all values from a mergeable filter node. */
function valuesFromNode(
  node: SearchNode & { type: "text_filter" | "text_in_filter" }
): string[] {
  if (node.type === "text_in_filter") {
    return node.values;
  }
  return [node.value];
}

/**
 * Try to merge a group of AST nodes (OR-connected) into a single
 * in-list filter node. Returns the merged node or `null`.
 */
function tryMergeGroup(group: SearchNode[]): SearchNode | null {
  // All must be mergeable filters
  for (const node of group) {
    if (!isMergeableFilter(node)) {
      return null;
    }
  }

  const filters = group as Array<
    SearchNode & { type: "text_filter" | "text_in_filter" }
  >;
  const first = filters[0];
  if (!first) {
    return null;
  }

  // All must have the same key (case-insensitive)
  const keyLower = first.key.toLowerCase();
  for (const f of filters) {
    if (f.key.toLowerCase() !== keyLower) {
      return null;
    }
  }

  // Collect and flatten all values
  const allValues: string[] = [];
  for (const f of filters) {
    allValues.push(...valuesFromNode(f));
  }

  return {
    type: "text_in_filter",
    negated: false,
    key: first.key,
    values: allValues,
  };
}

/**
 * Walk the AST node list and attempt to rewrite all OR groups to
 * in-list syntax. Returns the rewritten node list, or `null` if
 * any OR group cannot be merged.
 */
/**
 * Merge an OR group into a single node. Single-element groups pass through.
 * Returns `null` if the group cannot be merged.
 */
function mergeOrGroup(group: SearchNode[]): SearchNode | null {
  if (group.length === 1) {
    return group[0] ?? null;
  }
  return tryMergeGroup(group);
}

function tryRewriteOr(nodes: SearchNode[]): SearchNode[] | null {
  const result: SearchNode[] = [];
  let i = 0;

  while (i < nodes.length) {
    const current = nodes[i] as SearchNode;

    // Skip stray OR tokens
    if (isOrNode(nodes, i)) {
      i += 1;
      continue;
    }

    // Check if next node is OR → collect and merge the chain
    if (isOrNode(nodes, i + 1)) {
      const [group, nextIndex] = collectOrChain(nodes, i);
      const merged = mergeOrGroup(group);
      if (!merged) {
        return null;
      }
      result.push(merged);
      i = nextIndex;
    } else {
      result.push(current);
      i += 1;
    }
  }

  return result;
}

/** Check whether the node at index `j` is an OR operator. */
function isOrNode(nodes: SearchNode[], j: number): boolean {
  const node = nodes[j];
  return node?.type === "boolean_op" && node.op === "OR";
}

/**
 * Collect an OR-chain starting at `start`. Returns the group of
 * non-OR nodes and the index past the end of the chain.
 */
function collectOrChain(
  nodes: SearchNode[],
  start: number
): [SearchNode[], number] {
  const group = [nodes[start] as SearchNode];
  let j = start + 1;

  while (isOrNode(nodes, j)) {
    j += 1; // skip OR
    // Skip consecutive ORs
    while (isOrNode(nodes, j)) {
      j += 1;
    }
    if (j < nodes.length) {
      group.push(nodes[j] as SearchNode);
      j += 1;
    }
  }

  return [group, j];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a `--query` value before sending to the Sentry API.
 *
 * Parses the query using a PEG grammar, then handles boolean operators:
 *
 * - **AND**: Stripped (implicit in Sentry search). Warns via stderr.
 * - **OR**: Attempted rewrite to in-list syntax (`key:[val1,val2]`).
 *   Succeeds when all OR operands share the same valid qualifier key.
 *   Throws {@link ValidationError} when the rewrite is not possible.
 *
 * Paren groups, quoted values, and comparison operators are handled
 * correctly by the grammar — no regex-based reject-lists needed.
 *
 * Accepts `undefined` for convenience — commands can pass `flags.query`
 * directly without a conditional guard.
 *
 * @param query - Raw query string from `--query` flag, or `undefined`
 * @returns The sanitized query, or `undefined` if input was `undefined`
 * @throws {ValidationError} When OR cannot be rewritten to in-list syntax
 */
export function sanitizeQuery(query: string): string;
export function sanitizeQuery(query: undefined): undefined;
export function sanitizeQuery(query: string | undefined): string | undefined;
export function sanitizeQuery(query: string | undefined): string | undefined {
  if (!query) {
    return query;
  }

  const nodes = parse(query);

  let hasOr = false;
  let hasAnd = false;

  for (const node of nodes) {
    if (node.type === "boolean_op") {
      if (node.op === "OR") {
        hasOr = true;
      } else {
        hasAnd = true;
      }
    }
  }

  if (hasOr) {
    // Strip AND nodes before OR rewrite
    const withoutAnd = hasAnd
      ? nodes.filter((n) => !(n.type === "boolean_op" && n.op === "AND"))
      : nodes;
    return handleOr(withoutAnd, hasAnd);
  }

  if (hasAnd) {
    const withoutAnd = nodes.filter(
      (n) => !(n.type === "boolean_op" && n.op === "AND")
    );
    const sanitized = serializeNodes(withoutAnd);
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
function handleOr(nodes: SearchNode[], hasAnd: boolean): string {
  const rewritten = tryRewriteOr(nodes);
  if (rewritten) {
    const result = serializeNodes(rewritten);
    const notes: string[] = [];
    notes.push("Rewrote OR using in-list syntax: key:[val1,val2].");
    if (hasAnd) {
      notes.push("Also removed explicit AND (implicit in Sentry search).");
    }
    notes.push(`Running query: "${result}"`);
    log.warn(notes.join(" "));
    return result;
  }

  throw new ValidationError(
    "Could not rewrite OR into Sentry search syntax.\n\n" +
      "OR can be auto-rewritten when all terms share the same qualifier key:\n" +
      "  level:error OR level:warning  →  level:[error,warning]\n\n" +
      "Patterns that cannot be rewritten:\n" +
      "  - Free-text terms without a key (error OR timeout)\n" +
      "  - Different keys (level:error OR assigned:me)\n" +
      "  - is: or has: qualifiers (not supported with in-list)\n" +
      "  - Negated qualifiers (!key:val1 OR !key:val2)\n" +
      "  - Comparison values (age:>24h OR age:>7d)\n" +
      "  - Parenthesized groups\n\n" +
      "Alternatives:\n" +
      '  - Write in-list syntax directly: --query "key:[val1,val2]"\n' +
      "  - Run separate queries for each term\n\n" +
      "Search syntax: https://docs.sentry.io/concepts/search/",
    "query"
  );
}

// ---------------------------------------------------------------------------
// Search syntax reference
// ---------------------------------------------------------------------------

/**
 * Compact search syntax reference for JSON output.
 *
 * Gives agents and power users a machine-readable summary of Sentry's
 * search syntax without needing to consult external docs. Derived from the
 * PEG grammar at:
 *   https://github.com/getsentry/sentry/blob/master/static/app/components/searchSyntax/grammar.pegjs
 *
 * Injected into `--json` envelopes when the result set is empty — that's
 * when users/agents most likely need query help (bad query, wrong syntax).
 */
export const SEARCH_SYNTAX_REFERENCE = {
  _type: "sentry_search_syntax",
  docs: "https://docs.sentry.io/concepts/search/",
  grammar:
    "https://github.com/getsentry/sentry/blob/master/static/app/components/searchSyntax/grammar.pegjs",
  behavior: "Terms are space-separated and implicitly ANDed.",
  operators: {
    and: "NOT supported — implicit (space-separated terms are all required)",
    or: "NOT supported — use key:[val1,val2] in-list syntax instead",
    not: "!key:value (prefix with !)",
    comparison: [">=", "<=", ">", "<", "=", "!="],
    wildcard: "* in values (e.g., message:*timeout*)",
    inList: "key:[val1,val2] — matches any value in the list",
  },
  filterTypes: [
    "text (key:value)",
    "text_in (key:[val1,val2])",
    "numeric (key:>100, key:<=50)",
    "boolean (key:true, key:false)",
    "date (key:>2024-01-01)",
    "relative_date (key:-24h, key:+7d)",
    "duration (key:>1s, key:<500ms)",
    "has (has:key — not null check)",
    "is (is:unresolved, is:resolved, is:ignored)",
  ],
  commonFilters: [
    "is:unresolved",
    "is:resolved",
    "is:ignored",
    "assigned:me",
    "assigned:[me,none]",
    "has:user",
    "level:error",
    "level:warning",
    "!browser:Chrome",
    "firstSeen:-24h",
    "lastSeen:-1h",
    "age:-7d",
    "times_seen:>100",
  ],
};

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------

/**
 * @internal Exported for testing only. Not part of the public API.
 */
export const __testing = {
  isMergeableFilter,
  tryMergeGroup,
  tryRewriteOr,
  serializeNode,
  serializeNodes,
};
