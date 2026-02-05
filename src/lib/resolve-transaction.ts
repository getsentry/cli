/**
 * Transaction resolver for profile commands.
 *
 * Resolves transaction references (numbers, aliases, or full names) to full transaction names.
 * Works with the cached transaction aliases from `profile list`.
 */

import {
  buildTransactionFingerprint,
  getStaleFingerprint,
  getStaleIndexFingerprint,
  getTransactionByAlias,
  getTransactionByIndex,
} from "./db/transaction-aliases.js";
import { ConfigError } from "./errors.js";

/** Resolved transaction with full name and context */
export type ResolvedTransaction = {
  /** Full transaction name */
  transaction: string;
  /** Organization slug */
  orgSlug: string;
  /** Project slug */
  projectSlug: string;
};

/** Options for transaction resolution */
export type ResolveTransactionOptions = {
  /** Organization slug (required for fingerprint) */
  org: string;
  /** Project slug (null for multi-project lists) */
  project: string | null;
  /** Time period (required for fingerprint validation) */
  period: string;
};

/** Pattern to detect numeric-only input */
const NUMERIC_PATTERN = /^\d+$/;

/**
 * Check if input is a full transaction name (contains / or .).
 * Full names are passed through without alias lookup.
 */
function isFullTransactionName(input: string): boolean {
  return input.includes("/") || input.includes(".");
}

/**
 * Parse the stale fingerprint to extract period for error messages.
 * Fingerprint format: "orgSlug:projectSlug:period"
 */
function parseFingerprint(fingerprint: string): {
  org: string;
  project: string | null;
  period: string;
} {
  const parts = fingerprint.split(":");
  return {
    org: parts[0] ?? "",
    project: parts[1] === "*" ? null : (parts[1] ?? null),
    period: parts[2] ?? "",
  };
}

/**
 * Build a helpful error message for stale alias references.
 */
function buildStaleAliasError(
  ref: string,
  staleFingerprint: string,
  currentFingerprint: string
): ConfigError {
  const stale = parseFingerprint(staleFingerprint);
  const current = parseFingerprint(currentFingerprint);

  let reason = "";
  if (stale.period !== current.period) {
    reason = `different time period (cached: ${stale.period}, requested: ${current.period})`;
  } else if (stale.project !== current.project) {
    reason = `different project (cached: ${stale.project ?? "all"}, requested: ${current.project ?? "all"})`;
  } else if (stale.org !== current.org) {
    reason = `different organization (cached: ${stale.org}, requested: ${current.org})`;
  } else {
    reason = "different context";
  }

  const isNumeric = NUMERIC_PATTERN.test(ref);
  const refType = isNumeric ? "index" : "alias";
  const listCmd = current.project
    ? `sentry profile list ${current.org}/${current.project} --period ${current.period}`
    : `sentry profile list --org ${current.org} --period ${current.period}`;

  return new ConfigError(
    `Transaction ${refType} '${ref}' is from a ${reason}.`,
    `Run '${listCmd}' to refresh aliases.`
  );
}

/**
 * Build error for unknown alias/index.
 */
function buildUnknownRefError(
  ref: string,
  options: ResolveTransactionOptions
): ConfigError {
  const isNumeric = NUMERIC_PATTERN.test(ref);
  const refType = isNumeric ? "index" : "alias";
  const listCmd = options.project
    ? `sentry profile list ${options.org}/${options.project} --period ${options.period}`
    : `sentry profile list --org ${options.org} --period ${options.period}`;

  return new ConfigError(
    `Unknown transaction ${refType} '${ref}'.`,
    `Run '${listCmd}' to see available transactions.`
  );
}

/**
 * Resolve a transaction reference to its full name.
 *
 * Accepts:
 *   - Numeric index: "1", "2", "10" → looks up by cached index
 *   - Alias: "i", "e", "iu" → looks up by cached alias
 *   - Full transaction name: "/api/0/..." or "tasks.process" → passed through
 *
 * @throws ConfigError if alias/index not found or stale
 */
export function resolveTransaction(
  input: string,
  options: ResolveTransactionOptions
): ResolvedTransaction {
  // Full transaction names pass through directly
  if (isFullTransactionName(input)) {
    return {
      transaction: input,
      orgSlug: options.org,
      projectSlug: options.project ?? "",
    };
  }

  const currentFingerprint = buildTransactionFingerprint(
    options.org,
    options.project,
    options.period
  );

  // Numeric input → look up by index
  if (NUMERIC_PATTERN.test(input)) {
    const idx = Number.parseInt(input, 10);
    const entry = getTransactionByIndex(idx, currentFingerprint);

    if (entry) {
      return {
        transaction: entry.transaction,
        orgSlug: entry.orgSlug,
        projectSlug: entry.projectSlug,
      };
    }

    // Check if there's a stale entry for this index
    const staleFingerprint = getStaleIndexFingerprint(idx);
    if (staleFingerprint) {
      throw buildStaleAliasError(input, staleFingerprint, currentFingerprint);
    }

    throw buildUnknownRefError(input, options);
  }

  // Non-numeric input → look up by alias
  const entry = getTransactionByAlias(input, currentFingerprint);

  if (entry) {
    return {
      transaction: entry.transaction,
      orgSlug: entry.orgSlug,
      projectSlug: entry.projectSlug,
    };
  }

  // Check if there's a stale entry for this alias
  const staleFingerprint = getStaleFingerprint(input);
  if (staleFingerprint) {
    throw buildStaleAliasError(input, staleFingerprint, currentFingerprint);
  }

  throw buildUnknownRefError(input, options);
}
