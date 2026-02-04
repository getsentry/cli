/**
 * Cached DSN detection results storage (per directory).
 *
 * Supports two cache modes:
 * 1. Single DSN cache (original) - Used by detectDsn()
 * 2. Full detection cache (v4) - Used by detectAllDsns() with mtime validation
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  CachedDsnEntry,
  DetectedDsn,
  ResolvedProjectInfo,
} from "../dsn/types.js";
import { getDatabase, maybeCleanupCaches } from "./index.js";
import { runUpsert } from "./utils.js";

/** Cache TTL in milliseconds (24 hours) */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Row type matching the dsn_cache table schema (including v4 columns) */
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
  // v4 columns for full detection caching
  fingerprint: string | null;
  all_dsns_json: string | null;
  source_mtimes_json: string | null;
  root_dir_mtime: number | null;
  ttl_expires_at: number | null;
  cached_at: number;
  last_accessed: number;
};

/** Full detection cache entry (v4) */
export type CachedDetection = {
  /** Pre-computed fingerprint for alias validation */
  fingerprint: string;
  /** All detected DSNs */
  allDsns: DetectedDsn[];
  /** Map of source file paths to their mtimes */
  sourceMtimes: Record<string, number>;
  /** mtime of the project root directory */
  rootDirMtime: number;
  /** When the cache expires (TTL) */
  ttlExpiresAt: number;
};

/** Input for storing a full detection result */
export type DetectionCacheEntry = {
  /** Pre-computed fingerprint */
  fingerprint: string;
  /** All detected DSNs */
  allDsns: DetectedDsn[];
  /** Map of source file paths to their mtimes */
  sourceMtimes: Record<string, number>;
  /** mtime of the project root directory */
  rootDirMtime: number;
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

  runUpsert(
    db,
    "dsn_cache",
    {
      directory,
      dsn: entry.dsn,
      project_id: entry.projectId,
      org_id: entry.orgId ?? null,
      source: entry.source,
      source_path: entry.sourcePath ?? null,
      resolved_org_slug: entry.resolved?.orgSlug ?? null,
      resolved_org_name: entry.resolved?.orgName ?? null,
      resolved_project_slug: entry.resolved?.projectSlug ?? null,
      resolved_project_name: entry.resolved?.projectName ?? null,
      cached_at: now,
      last_accessed: now,
    },
    ["directory"]
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

// =============================================================================
// Full Detection Cache (v4) - mtime-based validation
// =============================================================================

/**
 * Validate a single directory mtime.
 * @returns True if mtime matches, false if changed or missing
 */
async function validateDirMtime(
  fullPath: string,
  cachedMtime: number
): Promise<boolean> {
  try {
    const stats = await stat(fullPath);
    return Math.floor(stats.mtimeMs) === cachedMtime;
  } catch {
    return false;
  }
}

/**
 * Validate a single file mtime.
 * @returns True if mtime matches, false if changed or missing
 */
async function validateFileMtime(
  fullPath: string,
  cachedMtime: number
): Promise<boolean> {
  try {
    const file = Bun.file(fullPath);
    if (!(await file.exists())) {
      return false;
    }
    return file.lastModified === cachedMtime;
  } catch {
    return false;
  }
}

/**
 * Validate that cached source file and directory mtimes still match.
 *
 * Entries ending with "/" are directories (for detecting new files added to subdirs).
 * Other entries are files (for detecting modified DSN files).
 *
 * @param projectRoot - Project root directory
 * @param sourceMtimes - Map of relative paths to cached mtimes
 * @returns True if all mtimes match, false if any changed or missing
 */
async function validateSourceMtimes(
  projectRoot: string,
  sourceMtimes: Record<string, number>
): Promise<boolean> {
  for (const [relativePath, cachedMtime] of Object.entries(sourceMtimes)) {
    // Check if this is a directory entry (ends with "/")
    const isDir = relativePath.endsWith("/");
    const cleanPath = isDir ? relativePath.slice(0, -1) : relativePath;
    const fullPath = join(projectRoot, cleanPath);

    const isValid = isDir
      ? await validateDirMtime(fullPath, cachedMtime)
      : await validateFileMtime(fullPath, cachedMtime);

    if (!isValid) {
      return false;
    }
  }
  return true;
}

/**
 * Get cached full detection result if valid.
 *
 * Validation checks (in order):
 * 1. Cache entry exists with full detection data
 * 2. TTL not expired (24h max age)
 * 3. Project root directory mtime unchanged (no new files)
 * 4. All source file mtimes unchanged
 *
 * @param projectRoot - Project root directory
 * @returns Cached detection or undefined if not cached/invalid
 */
export async function getCachedDetection(
  projectRoot: string
): Promise<CachedDetection | undefined> {
  const db = getDatabase();

  const row = db
    .query("SELECT * FROM dsn_cache WHERE directory = ?")
    .get(projectRoot) as DsnCacheRow | undefined;

  if (!row) {
    return;
  }

  // Check if full detection data exists (v4 columns)
  if (
    !(row.fingerprint && row.all_dsns_json && row.source_mtimes_json) ||
    row.root_dir_mtime === null ||
    row.ttl_expires_at === null
  ) {
    // Old cache entry without full detection data
    return;
  }

  const now = Date.now();

  // Check TTL expiration
  if (now > row.ttl_expires_at) {
    return;
  }

  // Check project root directory mtime
  if (!(await validateDirMtime(projectRoot, row.root_dir_mtime))) {
    return;
  }

  // Parse source mtimes and validate
  const sourceMtimes = JSON.parse(row.source_mtimes_json) as Record<
    string,
    number
  >;
  if (!(await validateSourceMtimes(projectRoot, sourceMtimes))) {
    return;
  }

  // Cache is valid - update last access time
  touchCacheEntry(projectRoot);

  // Parse and return cached detection
  const allDsns = JSON.parse(row.all_dsns_json) as DetectedDsn[];

  return {
    fingerprint: row.fingerprint,
    allDsns,
    sourceMtimes,
    rootDirMtime: row.root_dir_mtime,
    ttlExpiresAt: row.ttl_expires_at,
  };
}

/**
 * Store full detection result in cache.
 *
 * This updates the existing cache entry (if any) with full detection data.
 * The primary DSN from allDsns[0] is used for the single-DSN fields.
 *
 * @param projectRoot - Project root directory
 * @param entry - Detection result to cache
 */
export async function setCachedDetection(
  projectRoot: string,
  entry: DetectionCacheEntry
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  // Use primary DSN for backwards-compatible single-DSN fields
  const primaryDsn = entry.allDsns[0];

  runUpsert(
    db,
    "dsn_cache",
    {
      directory: projectRoot,
      // Single-DSN fields (for backwards compatibility)
      dsn: primaryDsn?.raw ?? "",
      project_id: primaryDsn?.projectId ?? "",
      org_id: primaryDsn?.orgId ?? null,
      source: primaryDsn?.source ?? "code",
      source_path: primaryDsn?.sourcePath ?? null,
      resolved_org_slug: null,
      resolved_org_name: null,
      resolved_project_slug: null,
      resolved_project_name: null,
      // Full detection fields (v4)
      fingerprint: entry.fingerprint,
      all_dsns_json: JSON.stringify(entry.allDsns),
      source_mtimes_json: JSON.stringify(entry.sourceMtimes),
      root_dir_mtime: entry.rootDirMtime,
      ttl_expires_at: now + CACHE_TTL_MS,
      // Timestamps
      cached_at: now,
      last_accessed: now,
    },
    ["directory"]
  );

  maybeCleanupCaches();
}
