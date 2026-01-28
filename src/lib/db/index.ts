/**
 * SQLite database connection manager for CLI configuration storage.
 * Uses bun:sqlite natively; Node.js uses a polyfill in node-polyfills.ts.
 */

import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { migrateFromJson } from "./migration.js";
import { initSchema, runMigrations } from "./schema.js";

export const CONFIG_DIR_ENV_VAR = "SENTRY_CONFIG_DIR";

export const DEFAULT_CONFIG_DIR_NAME = ".sentry";

export const DB_FILENAME = "cli.db";

/** 7-day TTL for cache entries (milliseconds) */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Probability of running cleanup on write operations */
export const CLEANUP_PROBABILITY = 0.1;

let db: Database | null = null;
let dbOpenedPath: string | null = null;

export function getConfigDir(): string {
  const { homedir } = require("node:os");
  return (
    process.env[CONFIG_DIR_ENV_VAR] || join(homedir(), DEFAULT_CONFIG_DIR_NAME)
  );
}

export function getDbPath(): string {
  return join(getConfigDir(), DB_FILENAME);
}

function ensureConfigDir(): void {
  mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
}

function setDbPermissions(): void {
  try {
    chmodSync(getDbPath(), 0o600);
  } catch {
    // Windows doesn't support chmod
  }
}

/** Get or initialize the database connection. */
export function getDatabase(): Database {
  const dbPath = getDbPath();

  // Auto-invalidate if config directory changed (for tests)
  if (db && dbOpenedPath !== dbPath) {
    db.close();
    db = null;
    dbOpenedPath = null;
  }

  if (db) {
    return db;
  }

  ensureConfigDir();

  db = new Database(dbPath);

  // 5000ms busy_timeout prevents SQLITE_BUSY errors during concurrent CLI access.
  // When multiple CLI instances run simultaneously (e.g., parallel terminals, CI jobs),
  // SQLite needs time to acquire locks. WAL mode allows concurrent reads, but writers
  // must wait. Without sufficient timeout, concurrent processes fail immediately.
  // Set busy_timeout FIRST - before WAL mode - to handle lock contention during init.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");

  setDbPermissions();
  initSchema(db);
  runMigrations(db);
  migrateFromJson(db);

  dbOpenedPath = dbPath;

  return db;
}

/** Close the database connection (used for testing). */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    dbOpenedPath = null;
  }
}

function shouldRunCleanup(): boolean {
  return Math.random() < CLEANUP_PROBABILITY;
}

function cleanupExpiredCaches(): void {
  const database = getDatabase();
  const expiryTime = Date.now() - CACHE_TTL_MS;

  database
    .query("DELETE FROM project_cache WHERE last_accessed < ?")
    .run(expiryTime);
  database
    .query("DELETE FROM dsn_cache WHERE last_accessed < ?")
    .run(expiryTime);
  database
    .query("DELETE FROM project_aliases WHERE last_accessed < ?")
    .run(expiryTime);
}

export function maybeCleanupCaches(): void {
  if (shouldRunCleanup()) {
    cleanupExpiredCaches();
  }
}
