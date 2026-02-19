/**
 * Transaction alias generation utilities.
 *
 * Generates short, unique aliases from transaction names for use in profile commands.
 * Similar to project aliases but for transaction names like "/api/0/organizations/{org}/issues/".
 */

import type { TransactionAliasEntry } from "../types/index.js";
import { findShortestUniquePrefixes } from "./alias.js";

/** Characters that separate segments in transaction names */
const SEGMENT_SEPARATORS = /[/.]/;

/** Pattern for URL parameter placeholders like {org}, {project_id}, etc. */
const PLACEHOLDER_PATTERN = /^\{[^}]+\}$/;

/** Numeric-only segments to filter out (like "0" in "/api/0/...") */
const NUMERIC_PATTERN = /^\d+$/;

/**
 * Extract the last meaningful segment from a transaction name.
 * Filters out parameter placeholders like {org}, {project_id}, and numeric segments.
 *
 * @example
 * extractTransactionSegment("/api/0/organizations/{org}/issues/")
 * // => "issues"
 *
 * @example
 * extractTransactionSegment("/extensions/jira/issue-updated/")
 * // => "issueupdated"
 *
 * @example
 * extractTransactionSegment("tasks.sentry.process_event")
 * // => "processevent"
 */
export function extractTransactionSegment(transaction: string): string {
  // Split on / and . to handle both URL paths and dotted task names
  const segments = transaction
    .split(SEGMENT_SEPARATORS)
    .filter((s) => s.length > 0);

  // Find the last meaningful segment (not a placeholder, not numeric)
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment) {
      continue;
    }

    // Skip placeholders like {org}, {project_id}
    if (PLACEHOLDER_PATTERN.test(segment)) {
      continue;
    }

    // Skip pure numeric segments like "0" in "/api/0/..."
    if (NUMERIC_PATTERN.test(segment)) {
      continue;
    }

    // Normalize: remove hyphens/underscores, lowercase
    const normalized = segment.replace(/[-_]/g, "").toLowerCase();
    if (normalized.length > 0) {
      return normalized;
    }
    // Segment was entirely hyphens/underscores (e.g. "---"), skip it
  }

  // Fallback: use first non-empty, non-numeric segment if no meaningful one found
  const firstSegment = segments.find(
    (s) =>
      s.length > 0 && !NUMERIC_PATTERN.test(s) && !PLACEHOLDER_PATTERN.test(s)
  );
  const fallback = firstSegment?.replace(/[-_]/g, "").toLowerCase();
  return fallback && fallback.length > 0 ? fallback : "txn";
}

/** Input for alias generation */
type TransactionInput = {
  /** Full transaction name */
  transaction: string;
  /** Organization slug */
  orgSlug: string;
  /** Project slug */
  projectSlug: string;
};

/**
 * Disambiguate duplicate segments by prepending "x" characters.
 * e.g., ["issues", "events", "issues"] → ["issues", "events", "xissues"]
 *
 * Uses a prefix ("x", "xx", "xxx", ...) instead of a numeric suffix to avoid
 * creating prefix relationships between the original and disambiguated strings.
 * A numeric suffix like "issues2" shares a prefix with "issues", which causes
 * findShortestUniquePrefixes to degrade both to full-length strings. Prepending
 * "x" breaks the prefix relationship, enabling short aliases (e.g., "i" and "x").
 *
 * Handles edge case where a prefixed name collides with an existing raw segment:
 * e.g., ["issues", "xissues", "issues"] → ["issues", "xissues", "xxissues"]
 *
 * @param segments - Array of extracted segments (may contain duplicates)
 * @returns Array of unique segments with "x" prefixes for duplicates
 */
function disambiguateSegments(segments: string[]): string[] {
  const result: string[] = [];
  const resultSet = new Set<string>();

  for (const segment of segments) {
    if (resultSet.has(segment)) {
      // Need a prefixed version - find next available
      let prefix = "x";
      let candidate = `${prefix}${segment}`;
      while (resultSet.has(candidate)) {
        prefix += "x";
        candidate = `${prefix}${segment}`;
      }
      result.push(candidate);
      resultSet.add(candidate);
    } else {
      // Raw segment name is available
      result.push(segment);
      resultSet.add(segment);
    }
  }

  return result;
}

/**
 * Build aliases for a list of transactions.
 * Uses shortest unique prefix algorithm on extracted segments.
 * Handles duplicate segments by appending numeric suffixes.
 *
 * @param transactions - Array of transaction inputs with org/project context
 * @returns Array of TransactionAliasEntry with idx, alias, and transaction
 *
 * @example
 * buildTransactionAliases([
 *   { transaction: "/api/0/organizations/{org}/issues/", orgSlug: "sentry", projectSlug: "sentry" },
 *   { transaction: "/api/0/projects/{org}/{proj}/events/", orgSlug: "sentry", projectSlug: "sentry" },
 * ])
 * // => [
 * //   { idx: 1, alias: "i", transaction: "/api/0/organizations/{org}/issues/", ... },
 * //   { idx: 2, alias: "e", transaction: "/api/0/projects/{org}/{proj}/events/", ... },
 * // ]
 *
 * @example
 * // Duplicate segments get "x" prefix for disambiguation
 * buildTransactionAliases([
 *   { transaction: "/api/v1/issues/", ... },
 *   { transaction: "/api/v2/issues/", ... },
 * ])
 * // => [
 * //   { idx: 1, alias: "i", ... },   // from "issues"
 * //   { idx: 2, alias: "x", ... },   // from "xissues" (disambiguated)
 * // ]
 */
export function buildTransactionAliases(
  transactions: TransactionInput[]
): TransactionAliasEntry[] {
  if (transactions.length === 0) {
    return [];
  }

  // Extract segments from each transaction
  const rawSegments = transactions.map((t) =>
    extractTransactionSegment(t.transaction)
  );

  // Disambiguate duplicate segments with numeric suffixes
  const segments = disambiguateSegments(rawSegments);

  // Find shortest unique prefixes for the disambiguated segments
  const prefixMap = findShortestUniquePrefixes(segments);

  // Build result with 1-based indices
  return transactions.map((t, index) => {
    const segment = segments[index] ?? "txn";
    const alias = prefixMap.get(segment) ?? segment.charAt(0);

    return {
      idx: index + 1,
      alias,
      transaction: t.transaction,
      orgSlug: t.orgSlug,
      projectSlug: t.projectSlug,
    };
  });
}
