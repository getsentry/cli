/**
 * Database schema DDL and version management.
 */

import type { Database } from "bun:sqlite";

const CURRENT_SCHEMA_VERSION = 3;

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
  if (currentVersion < 3 && currentVersion >= 2) {
    const hasNameColumn =
      (
        db
          .query(
            "SELECT COUNT(*) as count FROM pragma_table_info('user_info') WHERE name='name'"
          )
          .get() as { count: number }
      ).count > 0;

    if (!hasNameColumn) {
      db.exec("ALTER TABLE user_info ADD COLUMN name TEXT");
    }
  }

  // Update schema version if needed
  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    db.query("UPDATE schema_version SET version = ?").run(
      CURRENT_SCHEMA_VERSION
    );
  }
}
