/**
 * Tests for database schema repair functions.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_ENV_VAR,
  closeDatabase,
} from "../../../src/lib/db/index.js";
import {
  CURRENT_SCHEMA_VERSION,
  EXPECTED_COLUMNS,
  EXPECTED_TABLES,
  getSchemaIssues,
  hasColumn,
  initSchema,
  repairSchema,
  tableExists,
} from "../../../src/lib/db/schema.js";

let testDir: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  // Save original config dir
  originalConfigDir = process.env[CONFIG_DIR_ENV_VAR];

  // Close any existing database connection
  closeDatabase();

  // Create unique test directory
  const baseDir = originalConfigDir ?? "/tmp/sentry-cli-test";
  testDir = join(
    baseDir,
    `schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testDir, { recursive: true });
  process.env[CONFIG_DIR_ENV_VAR] = testDir;
});

afterEach(() => {
  closeDatabase();
  // Restore original config dir
  if (originalConfigDir) {
    process.env[CONFIG_DIR_ENV_VAR] = originalConfigDir;
  } else {
    delete process.env[CONFIG_DIR_ENV_VAR];
  }
  // Clean up test directory
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("tableExists", () => {
  test("returns true for existing table", () => {
    const db = new Database(join(testDir, "test.db"));
    db.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY)");

    expect(tableExists(db, "test_table")).toBe(true);
    db.close();
  });

  test("returns false for non-existent table", () => {
    const db = new Database(join(testDir, "test.db"));

    expect(tableExists(db, "nonexistent")).toBe(false);
    db.close();
  });
});

describe("hasColumn", () => {
  test("returns true for existing column", () => {
    const db = new Database(join(testDir, "test.db"));
    db.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)");

    expect(hasColumn(db, "test_table", "id")).toBe(true);
    expect(hasColumn(db, "test_table", "name")).toBe(true);
    db.close();
  });

  test("returns false for non-existent column", () => {
    const db = new Database(join(testDir, "test.db"));
    db.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY)");

    expect(hasColumn(db, "test_table", "missing_column")).toBe(false);
    db.close();
  });
});

describe("getSchemaIssues", () => {
  test("returns empty array for healthy database", () => {
    const db = new Database(join(testDir, "test.db"));
    initSchema(db);

    const issues = getSchemaIssues(db);
    expect(issues).toEqual([]);
    db.close();
  });

  test("detects missing table", () => {
    const db = new Database(join(testDir, "test.db"));
    // Create minimal schema without dsn_cache
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      CREATE TABLE auth (id INTEGER PRIMARY KEY);
      CREATE TABLE defaults (id INTEGER PRIMARY KEY);
      CREATE TABLE project_cache (cache_key TEXT PRIMARY KEY);
      CREATE TABLE project_aliases (alias TEXT PRIMARY KEY);
      CREATE TABLE metadata (key TEXT PRIMARY KEY);
      CREATE TABLE org_regions (org_slug TEXT PRIMARY KEY);
      CREATE TABLE user_info (id INTEGER PRIMARY KEY);
      CREATE TABLE instance_info (id INTEGER PRIMARY KEY);
      CREATE TABLE project_root_cache (cwd TEXT PRIMARY KEY);
    `);
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(
      CURRENT_SCHEMA_VERSION
    );

    const issues = getSchemaIssues(db);
    const missingTables = issues.filter((i) => i.type === "missing_table");

    expect(missingTables).toContainEqual({
      type: "missing_table",
      table: "dsn_cache",
    });
    db.close();
  });

  test("detects missing column", () => {
    const db = new Database(join(testDir, "test.db"));
    // Create dsn_cache table without v4 columns
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      CREATE TABLE auth (id INTEGER PRIMARY KEY);
      CREATE TABLE defaults (id INTEGER PRIMARY KEY);
      CREATE TABLE project_cache (cache_key TEXT PRIMARY KEY);
      CREATE TABLE dsn_cache (
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
      CREATE TABLE project_aliases (alias TEXT PRIMARY KEY);
      CREATE TABLE metadata (key TEXT PRIMARY KEY);
      CREATE TABLE org_regions (org_slug TEXT PRIMARY KEY);
      CREATE TABLE user_info (id INTEGER PRIMARY KEY, user_id TEXT, email TEXT, username TEXT, name TEXT);
      CREATE TABLE instance_info (id INTEGER PRIMARY KEY);
      CREATE TABLE project_root_cache (cwd TEXT PRIMARY KEY);
    `);
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(
      CURRENT_SCHEMA_VERSION
    );

    const issues = getSchemaIssues(db);
    const missingColumns = issues.filter((i) => i.type === "missing_column");

    // Should detect all v4 columns are missing
    expect(missingColumns).toContainEqual({
      type: "missing_column",
      table: "dsn_cache",
      column: "fingerprint",
    });
    expect(missingColumns).toContainEqual({
      type: "missing_column",
      table: "dsn_cache",
      column: "dir_mtimes_json",
    });
    db.close();
  });
});

describe("repairSchema", () => {
  test("creates missing tables", () => {
    const db = new Database(join(testDir, "test.db"));
    db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY)");
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(1);

    // Verify table is missing
    expect(tableExists(db, "dsn_cache")).toBe(false);

    const result = repairSchema(db);

    // Should have created the table
    expect(tableExists(db, "dsn_cache")).toBe(true);
    expect(
      result.fixed.some((f) => f.includes("Created table dsn_cache"))
    ).toBe(true);
    expect(result.failed).toEqual([]);
    db.close();
  });

  test("adds missing columns", () => {
    const db = new Database(join(testDir, "test.db"));
    initSchema(db);

    // Remove a column by recreating the table without it
    db.exec(`
      DROP TABLE dsn_cache;
      CREATE TABLE dsn_cache (
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
    `);

    // Verify column is missing
    expect(hasColumn(db, "dsn_cache", "fingerprint")).toBe(false);
    expect(hasColumn(db, "dsn_cache", "dir_mtimes_json")).toBe(false);

    const result = repairSchema(db);

    // Should have added the columns
    expect(hasColumn(db, "dsn_cache", "fingerprint")).toBe(true);
    expect(hasColumn(db, "dsn_cache", "dir_mtimes_json")).toBe(true);
    expect(result.fixed.some((f) => f.includes("dsn_cache.fingerprint"))).toBe(
      true
    );
    expect(result.failed).toEqual([]);
    db.close();
  });

  test("returns empty result for healthy database", () => {
    const db = new Database(join(testDir, "test.db"));
    initSchema(db);

    const result = repairSchema(db);

    expect(result.fixed).toEqual([]);
    expect(result.failed).toEqual([]);
    db.close();
  });

  test("updates schema version after repair", () => {
    const db = new Database(join(testDir, "test.db"));
    db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY)");
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(1);

    repairSchema(db);

    const version = (
      db.query("SELECT version FROM schema_version").get() as {
        version: number;
      }
    ).version;
    expect(version).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });
});

describe("EXPECTED_TABLES", () => {
  test("contains all required tables", () => {
    const expectedTableNames = [
      "schema_version",
      "auth",
      "defaults",
      "project_cache",
      "dsn_cache",
      "project_aliases",
      "metadata",
      "org_regions",
      "user_info",
      "instance_info",
      "project_root_cache",
    ];

    for (const table of expectedTableNames) {
      expect(EXPECTED_TABLES).toHaveProperty(table);
    }
  });
});

describe("EXPECTED_COLUMNS", () => {
  test("dsn_cache includes v4 columns", () => {
    const dsnCacheColumns = EXPECTED_COLUMNS.dsn_cache;
    const columnNames = dsnCacheColumns?.map((c) => c.name) ?? [];

    expect(columnNames).toContain("fingerprint");
    expect(columnNames).toContain("all_dsns_json");
    expect(columnNames).toContain("source_mtimes_json");
    expect(columnNames).toContain("dir_mtimes_json");
    expect(columnNames).toContain("root_dir_mtime");
    expect(columnNames).toContain("ttl_expires_at");
  });

  test("user_info includes v3 column", () => {
    const userInfoColumns = EXPECTED_COLUMNS.user_info;
    const columnNames = userInfoColumns?.map((c) => c.name) ?? [];

    expect(columnNames).toContain("name");
  });
});
