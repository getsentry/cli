/**
 * Database Connection Manager
 *
 * Manages the SQLite database connection for CLI configuration storage.
 * Uses bun:sqlite natively; Node.js uses a polyfill in node-polyfills.ts.
 *
 * Features:
 * - Lazy initialization (database created on first access)
 * - WAL mode for better concurrency
 * - File permissions (0o600) to protect sensitive data
 * - Automatic schema initialization and migration
 */

import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initSchema, runMigrations } from "./schema.js";
import { migrateFromJson } from "./migration.js";

/** Environment variable to override the config directory path */
export const CONFIG_DIR_ENV_VAR = "SENTRY_CONFIG_DIR";

/** Default config directory name (relative to home directory) */
export const DEFAULT_CONFIG_DIR_NAME = ".sentry";

/** Database filename */
export const DB_FILENAME = "cli.db";

/** 7-day TTL for cache entries in milliseconds */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Probability of running cleanup on write operations (10%) */
export const CLEANUP_PROBABILITY = 0.1;

/** Singleton database instance */
let db: Database | null = null;

/** Path the database was opened at (for detecting config dir changes) */
let dbOpenedPath: string | null = null;

/**
 * Get the config directory path.
 * Reads env var at runtime for test isolation.
 */
export function getConfigDir(): string {
  const { homedir } = require("node:os");
  return (
    process.env[CONFIG_DIR_ENV_VAR] || join(homedir(), DEFAULT_CONFIG_DIR_NAME)
  );
}

/**
 * Get the database file path.
 */
export function getDbPath(): string {
  return join(getConfigDir(), DB_FILENAME);
}

/**
 * Ensure the config directory exists with secure permissions.
 *
 * Directory: 0o700 (drwx------)
 * Database file: 0o600 (-rw-------)
 */
function ensureConfigDir(): void {
  mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
}

/**
 * Set secure permissions on the database file.
 * Called after database creation to ensure 0o600 permissions.
 */
function setDbPermissions(): void {
  try {
    chmodSync(getDbPath(), 0o600);
  } catch {
    // Ignore errors (e.g., on Windows where chmod may not work as expected)
  }
}

/**
 * Get the database connection, initializing if necessary.
 *
 * This is the main entry point for all database operations.
 * The database is lazily initialized on first access.
 *
 * Note: If the config directory changes (e.g., during tests), the
 * existing connection is closed and a new one is opened automatically.
 */
export function getDatabase(): Database {
  const dbPath = getDbPath();

  // Auto-invalidate if config directory changed (happens in tests)
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

  // Configure SQLite for robustness and responsiveness
  db.exec("PRAGMA journal_mode = WAL"); // Better concurrency
  db.exec("PRAGMA busy_timeout = 100"); // 100ms - fast fail for CLI
  db.exec("PRAGMA foreign_keys = ON"); // Enforce referential integrity
  db.exec("PRAGMA synchronous = NORMAL"); // Good balance of safety/speed

  // Set secure file permissions
  setDbPermissions();

  // Initialize schema and run migrations
  initSchema(db);
  runMigrations(db);

  // One-time migration from JSON config (if exists)
  migrateFromJson(db);

  // Track which path this database was opened for
  dbOpenedPath = dbPath;

  return db;
}

/**
 * Close the database connection.
 * Primarily used for testing to ensure clean state between tests.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    dbOpenedPath = null;
  }
}

/**
 * Check if it's time to run cache cleanup (probabilistic).
 * Returns true ~10% of the time to avoid cleanup on every write.
 */
export function shouldRunCleanup(): boolean {
  return Math.random() < CLEANUP_PROBABILITY;
}

/**
 * Clean up expired cache entries.
 * Called probabilistically on write operations.
 */
export function cleanupExpiredCaches(): void {
  const database = getDatabase();
  const expiryTime = Date.now() - CACHE_TTL_MS;

  // Clean up all cache tables
  database.query("DELETE FROM project_cache WHERE last_accessed < ?").run(expiryTime);
  database.query("DELETE FROM dsn_cache WHERE last_accessed < ?").run(expiryTime);
  database.query("DELETE FROM project_aliases WHERE last_accessed < ?").run(expiryTime);
}

/**
 * Run cleanup if probability check passes.
 * Call this after write operations to cache tables.
 */
export function maybeCleanupCaches(): void {
  if (shouldRunCleanup()) {
    cleanupExpiredCaches();
  }
}

// Re-export all public APIs from submodules
export * from "./auth.js";
export * from "./defaults.js";
export * from "./project-cache.js";
export * from "./dsn-cache.js";
export * from "./project-aliases.js";
