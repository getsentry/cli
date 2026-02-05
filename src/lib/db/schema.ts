/**
 * Database schema DDL and version management.
 *
 * This module defines the canonical schema for the CLI's SQLite database,
 * handles migrations between versions, and provides repair utilities for
 * fixing schema inconsistencies.
 */

import type { Database } from "bun:sqlite";

export const CURRENT_SCHEMA_VERSION = 4;

/** User identity for telemetry (single row, id=1) */
const USER_INFO_TABLE = `
  CREATE TABLE IF NOT EXISTS user_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_id TEXT NOT NULL,
    email TEXT,
    username TEXT,
    name TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`;

/** Instance identifier for telemetry (single row, id=1) */
const INSTANCE_INFO_TABLE = `
  CREATE TABLE IF NOT EXISTS instance_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    instance_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`;

/** Organization region cache for multi-region support */
const ORG_REGIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS org_regions (
    org_slug TEXT PRIMARY KEY,
    region_url TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`;

/** Project root cache for cwd → projectRoot mapping with mtime-based invalidation */
const PROJECT_ROOT_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS project_root_cache (
    cwd TEXT PRIMARY KEY,
    project_root TEXT NOT NULL,
    reason TEXT NOT NULL,
    cwd_mtime INTEGER NOT NULL,
    cached_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    ttl_expires_at INTEGER NOT NULL
  )
`;

// =============================================================================
// Schema Definitions for Repair
// =============================================================================

/**
 * Expected table DDL statements.
 * Used to create missing tables during repair.
 */
export const EXPECTED_TABLES: Record<string, string> = {
  schema_version: `
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `,
  auth: `
    CREATE TABLE IF NOT EXISTS auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      issued_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `,
  defaults: `
    CREATE TABLE IF NOT EXISTS defaults (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      organization TEXT,
      project TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `,
  project_cache: `
    CREATE TABLE IF NOT EXISTS project_cache (
      cache_key TEXT PRIMARY KEY,
      org_slug TEXT NOT NULL,
      org_name TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      project_name TEXT NOT NULL,
      cached_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_accessed INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `,
  dsn_cache: `
    CREATE TABLE IF NOT EXISTS dsn_cache (
      directory TEXT PRIMARY KEY,
      dsn TEXT NOT NULL,
      project_id TEXT NOT NULL,
      org_id TEXT,
      source TEXT NOT NULL,
      source_path TEXT,
      resolved_org_slug TEXT,
      resolved_org_name TEXT,
      resolved_project_slug TEXT,
      resolved_project_name TEXT,
      fingerprint TEXT,
      all_dsns_json TEXT,
      source_mtimes_json TEXT,
      dir_mtimes_json TEXT,
      root_dir_mtime INTEGER,
      ttl_expires_at INTEGER,
      cached_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_accessed INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `,
  project_aliases: `
    CREATE TABLE IF NOT EXISTS project_aliases (
      alias TEXT PRIMARY KEY,
      org_slug TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      dsn_fingerprint TEXT,
      cached_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_accessed INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `,
  metadata: `
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `,
  org_regions: ORG_REGIONS_TABLE,
  user_info: USER_INFO_TABLE,
  instance_info: INSTANCE_INFO_TABLE,
  project_root_cache: PROJECT_ROOT_CACHE_TABLE,
};

/** Column definition for schema repair */
type ColumnDef = { name: string; type: string };

/**
 * Expected columns per table.
 * Used to add missing columns during repair.
 * Only includes columns that might be missing due to migrations.
 */
export const EXPECTED_COLUMNS: Record<string, ColumnDef[]> = {
  // dsn_cache: v4 added fingerprint, all_dsns_json, source_mtimes_json, dir_mtimes_json, root_dir_mtime, ttl_expires_at
  dsn_cache: [
    { name: "fingerprint", type: "TEXT" },
    { name: "all_dsns_json", type: "TEXT" },
    { name: "source_mtimes_json", type: "TEXT" },
    { name: "dir_mtimes_json", type: "TEXT" },
    { name: "root_dir_mtime", type: "INTEGER" },
    { name: "ttl_expires_at", type: "INTEGER" },
  ],
  // user_info: v3 added name column
  user_info: [{ name: "name", type: "TEXT" }],
};

// =============================================================================
// Schema Utilities
// =============================================================================

/** Check if a table exists in the database */
export function tableExists(db: Database, table: string): boolean {
  const result = db
    .query(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?"
    )
    .get(table) as { count: number };
  return result.count > 0;
}

/** Check if a column exists in a table */
export function hasColumn(
  db: Database,
  table: string,
  column: string
): boolean {
  const result = db
    .query(
      `SELECT COUNT(*) as count FROM pragma_table_info('${table}') WHERE name='${column}'`
    )
    .get() as { count: number };
  return result.count > 0;
}

/** Add a column to a table if it doesn't exist */
function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  type: string
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// =============================================================================
// Schema Repair
// =============================================================================

/** Schema issue types for diagnostics */
export type SchemaIssue =
  | { type: "missing_table"; table: string }
  | { type: "missing_column"; table: string; column: string };

/**
 * Check schema and return list of issues.
 * Used for diagnostics and dry-run mode in `sentry cli fix`.
 */
export function getSchemaIssues(db: Database): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  // Check for missing tables
  for (const tableName of Object.keys(EXPECTED_TABLES)) {
    if (!tableExists(db, tableName)) {
      issues.push({ type: "missing_table", table: tableName });
      continue; // Can't check columns if table doesn't exist
    }

    // Check for missing columns in this table
    const columns = EXPECTED_COLUMNS[tableName];
    if (columns) {
      for (const col of columns) {
        if (!hasColumn(db, tableName, col.name)) {
          issues.push({
            type: "missing_column",
            table: tableName,
            column: col.name,
          });
        }
      }
    }
  }

  return issues;
}

/** Result of a schema repair operation */
export type RepairResult = {
  fixed: string[];
  failed: string[];
};

/** Create missing tables and record results */
function repairMissingTables(db: Database, result: RepairResult): void {
  for (const [tableName, ddl] of Object.entries(EXPECTED_TABLES)) {
    if (tableExists(db, tableName)) {
      continue;
    }
    try {
      db.exec(ddl);
      result.fixed.push(`Created table ${tableName}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.failed.push(`Failed to create table ${tableName}: ${msg}`);
    }
  }
}

/** Add missing columns to existing tables and record results */
function repairMissingColumns(db: Database, result: RepairResult): void {
  for (const [tableName, columns] of Object.entries(EXPECTED_COLUMNS)) {
    // Skip if table doesn't exist (would have been created above or failed)
    if (!tableExists(db, tableName)) {
      continue;
    }
    for (const col of columns) {
      if (hasColumn(db, tableName, col.name)) {
        continue;
      }
      try {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}`);
        result.fixed.push(`Added column ${tableName}.${col.name}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.failed.push(
          `Failed to add column ${tableName}.${col.name}: ${msg}`
        );
      }
    }
  }
}

/**
 * Repair schema issues by creating missing tables and adding missing columns.
 * This is a non-destructive operation that only adds missing schema elements.
 *
 * @param db - The raw database connection (not the traced wrapper)
 * @returns Lists of fixed and failed repairs
 */
export function repairSchema(db: Database): RepairResult {
  const result: RepairResult = { fixed: [], failed: [] };

  repairMissingTables(db, result);
  repairMissingColumns(db, result);

  // Update schema version if we fixed anything
  if (result.fixed.length > 0) {
    try {
      db.query("UPDATE schema_version SET version = ?").run(
        CURRENT_SCHEMA_VERSION
      );
    } catch {
      // Ignore version update failures - schema is still fixed
    }
  }

  return result;
}

// =============================================================================
// Schema Initialization
// =============================================================================

export function initSchema(db: Database): void {
  db.exec(`
    -- Schema version for future migrations
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );

    -- Authentication credentials (single row, id=1)
    CREATE TABLE IF NOT EXISTS auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      issued_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Default org/project settings (single row, id=1)
    CREATE TABLE IF NOT EXISTS defaults (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      organization TEXT,
      project TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Project cache (org:project -> project info)
    -- cache_key format: "orgId:projectId" or "dsn:publicKey"
    CREATE TABLE IF NOT EXISTS project_cache (
      cache_key TEXT PRIMARY KEY,
      org_slug TEXT NOT NULL,
      org_name TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      project_name TEXT NOT NULL,
      cached_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_accessed INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- DSN cache (directory -> detected DSN info)
    -- Extended in v4 with fingerprint, all_dsns_json, source_mtimes_json, dir_mtimes_json for full detection caching
    CREATE TABLE IF NOT EXISTS dsn_cache (
      directory TEXT PRIMARY KEY,
      dsn TEXT NOT NULL,
      project_id TEXT NOT NULL,
      org_id TEXT,
      source TEXT NOT NULL,
      source_path TEXT,
      resolved_org_slug TEXT,
      resolved_org_name TEXT,
      resolved_project_slug TEXT,
      resolved_project_name TEXT,
      fingerprint TEXT,
      all_dsns_json TEXT,
      source_mtimes_json TEXT,
      dir_mtimes_json TEXT,
      root_dir_mtime INTEGER,
      ttl_expires_at INTEGER,
      cached_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_accessed INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Project aliases for short issue ID resolution (A, B, C -> org/project)
    CREATE TABLE IF NOT EXISTS project_aliases (
      alias TEXT PRIMARY KEY,
      org_slug TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      dsn_fingerprint TEXT,
      cached_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_accessed INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Key-value metadata for internal tracking (e.g., migration status)
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    ${ORG_REGIONS_TABLE};
    ${USER_INFO_TABLE};
    ${INSTANCE_INFO_TABLE};
    ${PROJECT_ROOT_CACHE_TABLE};
  `);

  const versionRow = db
    .query("SELECT version FROM schema_version LIMIT 1")
    .get() as { version: number } | null;

  if (!versionRow) {
    // Use INSERT OR IGNORE to handle race condition when multiple CLI processes
    // start simultaneously on fresh install - both may see no rows and try to insert
    db.query("INSERT OR IGNORE INTO schema_version (version) VALUES (?)").run(
      CURRENT_SCHEMA_VERSION
    );
  }
}

function getSchemaVersion(db: Database): number {
  const row = db.query("SELECT version FROM schema_version LIMIT 1").get() as {
    version: number;
  } | null;
  return row?.version ?? 0;
}

export function runMigrations(db: Database): void {
  const currentVersion = getSchemaVersion(db);

  // Migration 1 -> 2: Add org_regions, user_info, and instance_info tables
  if (currentVersion < 2) {
    db.exec(`
      ${ORG_REGIONS_TABLE};
      ${USER_INFO_TABLE};
      ${INSTANCE_INFO_TABLE};
    `);
  }

  // Migration 2 -> 3: Add name column to user_info table
  // Check if column exists first to handle concurrent CLI processes
  // (SQLite lacks ADD COLUMN IF NOT EXISTS)
  if (currentVersion < 3) {
    addColumnIfMissing(db, "user_info", "name", "TEXT");
  }

  // Migration 3 -> 4: Add detection caching columns to dsn_cache and project_root_cache table
  if (currentVersion < 4) {
    // Add new columns to dsn_cache for full detection caching
    addColumnIfMissing(db, "dsn_cache", "fingerprint", "TEXT");
    addColumnIfMissing(db, "dsn_cache", "all_dsns_json", "TEXT");
    addColumnIfMissing(db, "dsn_cache", "source_mtimes_json", "TEXT");
    addColumnIfMissing(db, "dsn_cache", "dir_mtimes_json", "TEXT");
    addColumnIfMissing(db, "dsn_cache", "root_dir_mtime", "INTEGER");
    addColumnIfMissing(db, "dsn_cache", "ttl_expires_at", "INTEGER");

    // Create project_root_cache table
    db.exec(PROJECT_ROOT_CACHE_TABLE);
  }

  // Update schema version if needed
  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    db.query("UPDATE schema_version SET version = ?").run(
      CURRENT_SCHEMA_VERSION
    );
  }
}
