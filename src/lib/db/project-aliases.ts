/**
 * Project aliases storage (A, B, C -> org/project) for short issue ID resolution.
 */

import type { ProjectAliasEntry } from "../../types/index.js";
import { getDatabase, maybeCleanupCaches } from "./index.js";

type ProjectAliasRow = {
  alias: string;
  org_slug: string;
  project_slug: string;
  dsn_fingerprint: string | null;
  cached_at: number;
  last_accessed: number;
};

function touchAliasEntries(): void {
  const db = getDatabase();
  db.query("UPDATE project_aliases SET last_accessed = ?").run(Date.now());
}

/** Set project aliases, replacing all existing ones. */
export async function setProjectAliases(
  aliases: Record<string, ProjectAliasEntry>,
  dsnFingerprint?: string
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  db.exec("BEGIN TRANSACTION");

  try {
    db.query("DELETE FROM project_aliases").run();

    const insertStmt = db.query(`
      INSERT INTO project_aliases 
      (alias, org_slug, project_slug, dsn_fingerprint, cached_at, last_accessed)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const [alias, entry] of Object.entries(aliases)) {
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

  maybeCleanupCaches();
}

export async function getProjectAliases(): Promise<
  Record<string, ProjectAliasEntry> | undefined
> {
  const db = getDatabase();

  const rows = db
    .query("SELECT * FROM project_aliases")
    .all() as ProjectAliasRow[];

  if (rows.length === 0) {
    return;
  }

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

/** Get project by alias. Validates DSN fingerprint if both current and cached are present. */
export async function getProjectByAlias(
  alias: string,
  currentFingerprint?: string
): Promise<ProjectAliasEntry | undefined> {
  const db = getDatabase();

  const row = db
    .query("SELECT * FROM project_aliases WHERE alias = ?")
    .get(alias.toLowerCase()) as ProjectAliasRow | undefined;

  if (!row) {
    return;
  }

  // Empty string is a valid fingerprint (no SaaS DSNs)
  if (
    currentFingerprint !== undefined &&
    row.dsn_fingerprint !== null &&
    currentFingerprint !== row.dsn_fingerprint
  ) {
    return;
  }

  db.query("UPDATE project_aliases SET last_accessed = ? WHERE alias = ?").run(
    Date.now(),
    alias.toLowerCase()
  );

  return {
    orgSlug: row.org_slug,
    projectSlug: row.project_slug,
  };
}

export async function clearProjectAliases(): Promise<void> {
  const db = getDatabase();
  db.query("DELETE FROM project_aliases").run();
}
