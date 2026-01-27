/**
 * Project Cache Storage
 *
 * CRUD operations for cached project information in SQLite.
 * Supports caching by orgId:projectId and by DSN public key.
 *
 * Features:
 * - 7-day TTL with touch-on-read
 * - Lazy cleanup of expired entries
 */

import type { CachedProject } from "../../types/index.js";
import { getDatabase, maybeCleanupCaches } from "./index.js";

/** Project cache row shape from database */
type ProjectCacheRow = {
  cache_key: string;
  org_slug: string;
  org_name: string;
  project_slug: string;
  project_name: string;
  cached_at: number;
  last_accessed: number;
};

/**
 * Generate cache key for a project by orgId and projectId.
 */
function projectCacheKey(orgId: string, projectId: string): string {
  return `${orgId}:${projectId}`;
}

/**
 * Generate cache key for a project by DSN public key.
 */
function dsnCacheKey(publicKey: string): string {
  return `dsn:${publicKey}`;
}

/**
 * Convert database row to CachedProject type.
 */
function rowToCachedProject(row: ProjectCacheRow): CachedProject {
  return {
    orgSlug: row.org_slug,
    orgName: row.org_name,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    cachedAt: row.cached_at,
  };
}

/**
 * Touch a cache entry to update its last_accessed timestamp.
 */
function touchCacheEntry(cacheKey: string): void {
  const db = getDatabase();
  db.query(
    "UPDATE project_cache SET last_accessed = ? WHERE cache_key = ?"
  ).run(Date.now(), cacheKey);
}

/**
 * Get cached project information by orgId and projectId.
 *
 * @param orgId - Organization ID (numeric)
 * @param projectId - Project ID (numeric)
 * @returns Cached project info or undefined if not cached
 */
export async function getCachedProject(
  orgId: string,
  projectId: string
): Promise<CachedProject | undefined> {
  const db = getDatabase();
  const key = projectCacheKey(orgId, projectId);

  const row = db
    .query("SELECT * FROM project_cache WHERE cache_key = ?")
    .get(key) as ProjectCacheRow | undefined;

  if (!row) {
    return;
  }

  // Touch on read to extend TTL
  touchCacheEntry(key);

  return rowToCachedProject(row);
}

/**
 * Cache project information by orgId and projectId.
 *
 * @param orgId - Organization ID (numeric)
 * @param projectId - Project ID (numeric)
 * @param info - Project information to cache
 */
export async function setCachedProject(
  orgId: string,
  projectId: string,
  info: Omit<CachedProject, "cachedAt">
): Promise<void> {
  const db = getDatabase();
  const key = projectCacheKey(orgId, projectId);
  const now = Date.now();

  db.query(`
    INSERT INTO project_cache 
    (cache_key, org_slug, org_name, project_slug, project_name, cached_at, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      org_slug = excluded.org_slug,
      org_name = excluded.org_name,
      project_slug = excluded.project_slug,
      project_name = excluded.project_name,
      cached_at = excluded.cached_at,
      last_accessed = excluded.last_accessed
  `).run(
    key,
    info.orgSlug,
    info.orgName,
    info.projectSlug,
    info.projectName,
    now,
    now
  );

  // Probabilistic cleanup
  maybeCleanupCaches();
}

/**
 * Get cached project information by DSN public key.
 * Used for DSNs without an embedded org ID (self-hosted or some SaaS patterns).
 *
 * @param publicKey - The DSN public key
 * @returns Cached project info or undefined if not cached
 */
export async function getCachedProjectByDsnKey(
  publicKey: string
): Promise<CachedProject | undefined> {
  const db = getDatabase();
  const key = dsnCacheKey(publicKey);

  const row = db
    .query("SELECT * FROM project_cache WHERE cache_key = ?")
    .get(key) as ProjectCacheRow | undefined;

  if (!row) {
    return;
  }

  // Touch on read to extend TTL
  touchCacheEntry(key);

  return rowToCachedProject(row);
}

/**
 * Cache project information by DSN public key.
 * Used for DSNs without an embedded org ID (self-hosted or some SaaS patterns).
 *
 * @param publicKey - The DSN public key
 * @param info - Project information to cache
 */
export async function setCachedProjectByDsnKey(
  publicKey: string,
  info: Omit<CachedProject, "cachedAt">
): Promise<void> {
  const db = getDatabase();
  const key = dsnCacheKey(publicKey);
  const now = Date.now();

  db.query(`
    INSERT INTO project_cache 
    (cache_key, org_slug, org_name, project_slug, project_name, cached_at, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      org_slug = excluded.org_slug,
      org_name = excluded.org_name,
      project_slug = excluded.project_slug,
      project_name = excluded.project_name,
      cached_at = excluded.cached_at,
      last_accessed = excluded.last_accessed
  `).run(
    key,
    info.orgSlug,
    info.orgName,
    info.projectSlug,
    info.projectName,
    now,
    now
  );

  // Probabilistic cleanup
  maybeCleanupCaches();
}

/**
 * Clear the project cache.
 */
export async function clearProjectCache(): Promise<void> {
  const db = getDatabase();
  db.query("DELETE FROM project_cache").run();
}
