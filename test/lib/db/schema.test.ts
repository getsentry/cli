/**
 * Tests for database schema repair functions.
 */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  CURRENT_SCHEMA_VERSION,
  EXPECTED_COLUMNS,
  EXPECTED_TABLES,
  generatePreMigrationTableDDL,
  getSchemaIssues,
  hasColumn,
  initSchema,
  repairSchema,
  tableExists,
} from "../../../src/lib/db/schema.js";
import { useTestConfigDir } from "../../helpers.js";

/**
 * Create a database with all tables but some missing (for testing repair).
 */
function createDatabaseWithMissingTables(
  db: Database,
  missingTables: string[]
): void {
  const statements: string[] = [];
  for (const tableName of Object.keys(EXPECTED_TABLES)) {
    if (missingTables.includes(tableName)) continue;
    statements.push(EXPECTED_TABLES[tableName] as string);
  }
  db.exec(statements.join(";\n"));
  db.query("INSERT INTO schema_version (version) VALUES (?)").run(
    CURRENT_SCHEMA_VERSION
  );
}

/**
 * Create a database with pre-migration versions of specified tables.
 * Tables with migrated columns will be created without those columns.
 */
function createPreMigrationDatabase(
  db: Database,
  preMigrationTables: string[]
): void {
  const statements: string[] = [];
  for (const tableName of Object.keys(EXPECTED_TABLES)) {
    if (preMigrationTables.includes(tableName)) {
      statements.push(generatePreMigrationTableDDL(tableName));
    } else {
      statements.push(EXPECTED_TABLES[tableName] as string);
    }
  }
  db.exec(statements.join(";\n"));
  db.query("INSERT INTO schema_version (version) VALUES (?)").run(
    CURRENT_SCHEMA_VERSION
  );
}

const getTestDir = useTestConfigDir("schema-test-");

describe("tableExists", () => {
  test("returns true for existing table", () => {
    const db = new Database(join(getTestDir(), "test.db"));
    db.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY)");

    expect(tableExists(db, "test_table")).toBe(true);
    db.close();
  });

  test("returns false for non-existent table", () => {
    const db = new Database(join(getTestDir(), "test.db"));

    expect(tableExists(db, "nonexistent")).toBe(false);
    db.close();
  });
});

describe("hasColumn", () => {
  test("returns true for existing column", () => {
    const db = new Database(join(getTestDir(), "test.db"));
    db.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)");

    expect(hasColumn(db, "test_table", "id")).toBe(true);
    expect(hasColumn(db, "test_table", "name")).toBe(true);
    db.close();
  });

  test("returns false for non-existent column", () => {
    const db = new Database(join(getTestDir(), "test.db"));
    db.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY)");

    expect(hasColumn(db, "test_table", "missing_column")).toBe(false);
    db.close();
  });
});

describe("getSchemaIssues", () => {
  test("returns empty array for healthy database", () => {
    const db = new Database(join(getTestDir(), "test.db"));
    initSchema(db);

    const issues = getSchemaIssues(db);
    expect(issues).toEqual([]);
    db.close();
  });

  test("detects missing table", () => {
    const db = new Database(join(getTestDir(), "test.db"));
    // Create schema without dsn_cache using the helper
    createDatabaseWithMissingTables(db, ["dsn_cache"]);

    const issues = getSchemaIssues(db);
    const missingTables = issues.filter((i) => i.type === "missing_table");

    expect(missingTables).toContainEqual({
      type: "missing_table",
      table: "dsn_cache",
    });
    db.close();
  });

  test("detects missing column", () => {
    const db = new Database(join(getTestDir(), "test.db"));
    // Create dsn_cache without v4 columns (pre-migration state)
    createPreMigrationDatabase(db, ["dsn_cache"]);

    const issues = getSchemaIssues(db);
    const missingColumns = issues.filter((i) => i.type === "missing_column");

    // Should detect all v4 columns are missing from dsn_cache
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
    const db = new Database(join(getTestDir(), "test.db"));
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
    const db = new Database(join(getTestDir(), "test.db"));
    initSchema(db);

    // Remove migrated columns by recreating the table in pre-migration state
    db.exec("DROP TABLE dsn_cache");
    db.exec(generatePreMigrationTableDDL("dsn_cache"));

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
    const db = new Database(join(getTestDir(), "test.db"));
    initSchema(db);

    const result = repairSchema(db);

    expect(result.fixed).toEqual([]);
    expect(result.failed).toEqual([]);
    db.close();
  });

  test("updates schema version after repair", () => {
    const db = new Database(join(getTestDir(), "test.db"));
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
      "pagination_cursors",
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
