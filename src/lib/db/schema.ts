/**
 * Database Schema
 *
 * DDL statements and schema version management for the SQLite database.
 * Schema changes should be added as migrations with incrementing version numbers.
 */

import type { Database } from "bun:sqlite";

/** Current schema version - increment when adding migrations */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Initialize the database schema.
 * Creates all tables if they don't exist.
 */
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
  `);

  // Initialize schema version if not set
  const versionRow = db.query("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | null;

  if (!versionRow) {
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(
      CURRENT_SCHEMA_VERSION
    );
  }
}

/**
 * Get the current schema version from the database.
 */
export function getSchemaVersion(db: Database): number {
  const row = db.query("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | null;
  return row?.version ?? 0;
}

/**
 * Run any pending migrations.
 * Each migration should be idempotent and increment the version.
 */
export function runMigrations(db: Database): void {
  const currentVersion = getSchemaVersion(db);

  // Future migrations go here, e.g.:
  // if (currentVersion < 2) {
  //   db.exec("ALTER TABLE auth ADD COLUMN new_field TEXT");
  //   db.query("UPDATE schema_version SET version = ?").run(2);
  // }

  // Placeholder for future migrations
  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    db.query("UPDATE schema_version SET version = ?").run(CURRENT_SCHEMA_VERSION);
  }
}
