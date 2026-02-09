/**
 * Transaction aliases storage for profile commands.
 * Enables short references like "1" or "i" for transactions from `profile list`.
 */

import type { TransactionAliasEntry } from "../../types/index.js";
import { getDatabase } from "./index.js";

type TransactionAliasRow = {
  idx: number;
  alias: string;
  transaction_name: string;
  org_slug: string;
  project_slug: string;
  fingerprint: string;
  cached_at: number;
};

/**
 * Build a fingerprint for cache validation.
 * Format: "orgSlug:projectSlug:period" or "orgSlug:*:period" for multi-project.
 */
export function buildTransactionFingerprint(
  orgSlug: string,
  projectSlug: string | null,
  period: string
): string {
  return `${orgSlug}:${projectSlug ?? "*"}:${period}`;
}

/**
 * Store transaction aliases from a profile list command.
 * Replaces any existing aliases for the same fingerprint.
 */
export function setTransactionAliases(
  aliases: TransactionAliasEntry[],
  fingerprint: string
): void {
  const db = getDatabase();
  const now = Date.now();

  db.exec("BEGIN TRANSACTION");

  try {
    // Delete only aliases with the same fingerprint
    db.query("DELETE FROM transaction_aliases WHERE fingerprint = ?").run(
      fingerprint
    );

    const insertStmt = db.query(`
      INSERT INTO transaction_aliases 
      (idx, alias, transaction_name, org_slug, project_slug, fingerprint, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const entry of aliases) {
      insertStmt.run(
        entry.idx,
        entry.alias.toLowerCase(),
        entry.transaction,
        entry.orgSlug,
        entry.projectSlug,
        fingerprint,
        now
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Look up transaction by numeric index.
 * Returns null if not found or fingerprint doesn't match.
 */
export function getTransactionByIndex(
  idx: number,
  fingerprint: string
): TransactionAliasEntry | null {
  const db = getDatabase();

  const row = db
    .query(
      "SELECT * FROM transaction_aliases WHERE idx = ? AND fingerprint = ?"
    )
    .get(idx, fingerprint) as TransactionAliasRow | undefined;

  if (!row) {
    return null;
  }

  return {
    idx: row.idx,
    alias: row.alias,
    transaction: row.transaction_name,
    orgSlug: row.org_slug,
    projectSlug: row.project_slug,
  };
}

/**
 * Look up transaction by alias.
 * Returns null if not found or fingerprint doesn't match.
 */
export function getTransactionByAlias(
  alias: string,
  fingerprint: string
): TransactionAliasEntry | null {
  const db = getDatabase();

  const row = db
    .query(
      "SELECT * FROM transaction_aliases WHERE alias = ? AND fingerprint = ?"
    )
    .get(alias.toLowerCase(), fingerprint) as TransactionAliasRow | undefined;

  if (!row) {
    return null;
  }

  return {
    idx: row.idx,
    alias: row.alias,
    transaction: row.transaction_name,
    orgSlug: row.org_slug,
    projectSlug: row.project_slug,
  };
}

/**
 * Get all cached aliases for a fingerprint.
 */
export function getTransactionAliases(
  fingerprint: string
): TransactionAliasEntry[] {
  const db = getDatabase();

  const rows = db
    .query(
      "SELECT * FROM transaction_aliases WHERE fingerprint = ? ORDER BY idx"
    )
    .all(fingerprint) as TransactionAliasRow[];

  return rows.map((row) => ({
    idx: row.idx,
    alias: row.alias,
    transaction: row.transaction_name,
    orgSlug: row.org_slug,
    projectSlug: row.project_slug,
  }));
}

/**
 * Check if an alias exists for a different fingerprint (stale check).
 * Excludes the current fingerprint so we only find entries from other contexts.
 *
 * @param alias - The alias to look up
 * @param currentFingerprint - The fingerprint to exclude from results
 * @returns The stale fingerprint if found, null otherwise
 */
export function getStaleFingerprint(
  alias: string,
  currentFingerprint: string
): string | null {
  const db = getDatabase();

  const row = db
    .query(
      "SELECT fingerprint FROM transaction_aliases WHERE alias = ? AND fingerprint != ? LIMIT 1"
    )
    .get(alias.toLowerCase(), currentFingerprint) as
    | { fingerprint: string }
    | undefined;

  return row?.fingerprint ?? null;
}

/**
 * Check if an index exists for a different fingerprint (stale check).
 * Excludes the current fingerprint so we only find entries from other contexts.
 *
 * @param idx - The numeric index to look up
 * @param currentFingerprint - The fingerprint to exclude from results
 * @returns The stale fingerprint if found, null otherwise
 */
export function getStaleIndexFingerprint(
  idx: number,
  currentFingerprint: string
): string | null {
  const db = getDatabase();

  const row = db
    .query(
      "SELECT fingerprint FROM transaction_aliases WHERE idx = ? AND fingerprint != ? LIMIT 1"
    )
    .get(idx, currentFingerprint) as { fingerprint: string } | undefined;

  return row?.fingerprint ?? null;
}

/**
 * Clear all transaction aliases.
 */
export function clearTransactionAliases(): void {
  const db = getDatabase();
  db.query("DELETE FROM transaction_aliases").run();
}
