/**
 * Cached DSN detection results storage (per directory).
 */

import type { CachedDsnEntry, ResolvedProjectInfo } from "../dsn/types.js";
import { getDatabase, maybeCleanupCaches } from "./index.js";

type DsnCacheRow = {
  directory: string;
  dsn: string;
  project_id: string;
  org_id: string | null;
  source: string;
  source_path: string | null;
  resolved_org_slug: string | null;
  resolved_org_name: string | null;
  resolved_project_slug: string | null;
  resolved_project_name: string | null;
  cached_at: number;
  last_accessed: number;
};

function rowToCachedDsnEntry(row: DsnCacheRow): CachedDsnEntry {
  const entry: CachedDsnEntry = {
    dsn: row.dsn,
    projectId: row.project_id,
    orgId: row.org_id ?? undefined,
    source: row.source as CachedDsnEntry["source"],
    sourcePath: row.source_path ?? undefined,
    cachedAt: row.cached_at,
  };

  if (row.resolved_org_slug && row.resolved_project_slug) {
    entry.resolved = {
      orgSlug: row.resolved_org_slug,
      orgName: row.resolved_org_name ?? "",
      projectSlug: row.resolved_project_slug,
      projectName: row.resolved_project_name ?? "",
    };
  }

  return entry;
}

function touchCacheEntry(directory: string): void {
  const db = getDatabase();
  db.query("UPDATE dsn_cache SET last_accessed = ? WHERE directory = ?").run(
    Date.now(),
    directory
  );
}

export async function getCachedDsn(
  directory: string
): Promise<CachedDsnEntry | undefined> {
  const db = getDatabase();

  const row = db
    .query("SELECT * FROM dsn_cache WHERE directory = ?")
    .get(directory) as DsnCacheRow | undefined;

  if (!row) {
    return;
  }

  touchCacheEntry(directory);
  return rowToCachedDsnEntry(row);
}

export async function setCachedDsn(
  directory: string,
  entry: Omit<CachedDsnEntry, "cachedAt">
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  db.query(`
    INSERT INTO dsn_cache 
    (directory, dsn, project_id, org_id, source, source_path,
     resolved_org_slug, resolved_org_name, resolved_project_slug, resolved_project_name,
     cached_at, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(directory) DO UPDATE SET
      dsn = excluded.dsn,
      project_id = excluded.project_id,
      org_id = excluded.org_id,
      source = excluded.source,
      source_path = excluded.source_path,
      resolved_org_slug = excluded.resolved_org_slug,
      resolved_org_name = excluded.resolved_org_name,
      resolved_project_slug = excluded.resolved_project_slug,
      resolved_project_name = excluded.resolved_project_name,
      cached_at = excluded.cached_at,
      last_accessed = excluded.last_accessed
  `).run(
    directory,
    entry.dsn,
    entry.projectId,
    entry.orgId ?? null,
    entry.source,
    entry.sourcePath ?? null,
    entry.resolved?.orgSlug ?? null,
    entry.resolved?.orgName ?? null,
    entry.resolved?.projectSlug ?? null,
    entry.resolved?.projectName ?? null,
    now,
    now
  );

  maybeCleanupCaches();
}

/** Update resolved org/project info after API resolution. */
export async function updateCachedResolution(
  directory: string,
  resolved: ResolvedProjectInfo
): Promise<void> {
  const db = getDatabase();

  const exists = db
    .query("SELECT 1 FROM dsn_cache WHERE directory = ?")
    .get(directory);
  if (!exists) {
    return;
  }

  db.query(`
    UPDATE dsn_cache SET
      resolved_org_slug = ?,
      resolved_org_name = ?,
      resolved_project_slug = ?,
      resolved_project_name = ?,
      last_accessed = ?
    WHERE directory = ?
  `).run(
    resolved.orgSlug,
    resolved.orgName,
    resolved.projectSlug,
    resolved.projectName,
    Date.now(),
    directory
  );
}

export async function clearDsnCache(directory?: string): Promise<void> {
  const db = getDatabase();

  if (directory) {
    db.query("DELETE FROM dsn_cache WHERE directory = ?").run(directory);
  } else {
    db.query("DELETE FROM dsn_cache").run();
  }
}

export function isCacheValid(entry: CachedDsnEntry | undefined): boolean {
  return !!entry;
}
