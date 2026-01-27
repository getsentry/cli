/**
 * Project Aliases Storage
 *
 * CRUD operations for project aliases (A, B, C -> org/project mapping) in SQLite.
 * Used for short issue ID resolution in monorepos.
 *
 * Features:
 * - DSN fingerprint validation for cache scoping
 * - 7-day TTL with touch-on-read
 * - Lazy cleanup of expired entries
 */

import type { ProjectAliasEntry } from "../../types/index.js";
import { getDatabase, maybeCleanupCaches } from "./index.js";

/** Project aliases row shape from database */
type ProjectAliasRow = {
  alias: string;
  org_slug: string;
  project_slug: string;
  dsn_fingerprint: string | null;
  cached_at: number;
  last_accessed: number;
};

/**
 * Touch alias entries to update their last_accessed timestamp.
 */
function touchAliasEntries(): void {
  const db = getDatabase();
  db.query("UPDATE project_aliases SET last_accessed = ?").run(Date.now());
}

/**
 * Set project aliases for short issue ID resolution.
 * Called by `issue list` when multiple projects are detected.
 *
 * This replaces all existing aliases (not a merge).
 *
 * @param aliases - Map of alias letter (A, B, C...) to org/project
 * @param dsnFingerprint - Fingerprint of detected DSNs for cache validation
 */
export async function setProjectAliases(
  aliases: Record<string, ProjectAliasEntry>,
  dsnFingerprint?: string
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  // Use a transaction to replace all aliases atomically
  db.exec("BEGIN TRANSACTION");

  try {
    // Clear existing aliases
    db.query("DELETE FROM project_aliases").run();

    // Insert new aliases
    const insertStmt = db.query(`
      INSERT INTO project_aliases 
      (alias, org_slug, project_slug, dsn_fingerprint, cached_at, last_accessed)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const [alias, entry] of Object.entries(aliases)) {
      // Store aliases lowercase for case-insensitive lookup
      insertStmt.run(
        alias.toLowerCase(),
        entry.orgSlug,
        entry.projectSlug,
        dsnFingerprint ?? null,
        now,
        now
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  // Probabilistic cleanup
  maybeCleanupCaches();
}

/**
 * Get project aliases for short issue ID resolution.
 *
 * @returns Map of alias letter to org/project, or undefined if not set
 */
export async function getProjectAliases(): Promise<
  Record<string, ProjectAliasEntry> | undefined
> {
  const db = getDatabase();

  const rows = db.query("SELECT * FROM project_aliases").all() as ProjectAliasRow[];

  if (rows.length === 0) {
    return;
  }

  // Touch on read to extend TTL
  touchAliasEntries();

  const aliases: Record<string, ProjectAliasEntry> = {};
  for (const row of rows) {
    aliases[row.alias] = {
      orgSlug: row.org_slug,
      projectSlug: row.project_slug,
    };
  }

  return aliases;
}

/**
 * Get a specific project by its alias.
 * Validates DSN fingerprint when both current and cached fingerprints are present.
 *
 * @param alias - The alias letter (A, B, C...)
 * @param currentFingerprint - Optional current DSN fingerprint for validation
 * @returns Project entry or undefined if not found or fingerprint mismatch
 */
export async function getProjectByAlias(
  alias: string,
  currentFingerprint?: string
): Promise<ProjectAliasEntry | undefined> {
  const db = getDatabase();

  // Case-insensitive lookup (aliases are stored lowercase)
  const row = db
    .query("SELECT * FROM project_aliases WHERE alias = ?")
    .get(alias.toLowerCase()) as ProjectAliasRow | undefined;

  if (!row) {
    return;
  }

  // Validate fingerprint: reject if current DSNs don't match cached context
  // Note: empty string is a valid fingerprint (means no SaaS DSNs detected),
  // so we use explicit undefined check rather than truthy check
  if (
    currentFingerprint !== undefined &&
    row.dsn_fingerprint !== null &&
    currentFingerprint !== row.dsn_fingerprint
  ) {
    return; // DSN fingerprint mismatch - don't use cache
  }

  // Touch on read to extend TTL
  db.query("UPDATE project_aliases SET last_accessed = ? WHERE alias = ?").run(
    Date.now(),
    alias.toLowerCase()
  );

  return {
    orgSlug: row.org_slug,
    projectSlug: row.project_slug,
  };
}

/**
 * Clear project aliases.
 */
export async function clearProjectAliases(): Promise<void> {
  const db = getDatabase();
  db.query("DELETE FROM project_aliases").run();
}
