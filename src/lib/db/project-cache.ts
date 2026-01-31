/**
 * Cached project information storage (by orgId:projectId or DSN public key).
 */

import type { CachedProject } from "../../types/index.js";
import { getDatabase, maybeCleanupCaches } from "./index.js";
import { runUpsert } from "./utils.js";

type ProjectCacheRow = {
  cache_key: string;
  org_slug: string;
  org_name: string;
  project_slug: string;
  project_name: string;
  cached_at: number;
  last_accessed: number;
};

function projectCacheKey(orgId: string, projectId: string): string {
  return `${orgId}:${projectId}`;
}

function dsnCacheKey(publicKey: string): string {
  return `dsn:${publicKey}`;
}

function rowToCachedProject(row: ProjectCacheRow): CachedProject {
  return {
    orgSlug: row.org_slug,
    orgName: row.org_name,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    cachedAt: row.cached_at,
  };
}

function touchCacheEntry(cacheKey: string): void {
  const db = getDatabase();
  db.query(
    "UPDATE project_cache SET last_accessed = ? WHERE cache_key = ?"
  ).run(Date.now(), cacheKey);
}

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

  touchCacheEntry(key);
  return rowToCachedProject(row);
}

export async function setCachedProject(
  orgId: string,
  projectId: string,
  info: Omit<CachedProject, "cachedAt">
): Promise<void> {
  const db = getDatabase();
  const key = projectCacheKey(orgId, projectId);
  const now = Date.now();

  runUpsert(
    db,
    "project_cache",
    {
      cache_key: key,
      org_slug: info.orgSlug,
      org_name: info.orgName,
      project_slug: info.projectSlug,
      project_name: info.projectName,
      cached_at: now,
      last_accessed: now,
    },
    ["cache_key"]
  );

  maybeCleanupCaches();
}

/** Get cached project by DSN public key (for self-hosted or SaaS DSNs without org ID). */
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

  touchCacheEntry(key);
  return rowToCachedProject(row);
}

/** Cache project by DSN public key (for self-hosted or SaaS DSNs without org ID). */
export async function setCachedProjectByDsnKey(
  publicKey: string,
  info: Omit<CachedProject, "cachedAt">
): Promise<void> {
  const db = getDatabase();
  const key = dsnCacheKey(publicKey);
  const now = Date.now();

  runUpsert(
    db,
    "project_cache",
    {
      cache_key: key,
      org_slug: info.orgSlug,
      org_name: info.orgName,
      project_slug: info.projectSlug,
      project_name: info.projectName,
      cached_at: now,
      last_accessed: now,
    },
    ["cache_key"]
  );

  maybeCleanupCaches();
}

export async function clearProjectCache(): Promise<void> {
  const db = getDatabase();
  db.query("DELETE FROM project_cache").run();
}
