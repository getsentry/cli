/**
 * Tests for sentry cli fix command.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fixCommand } from "../../../src/commands/cli/fix.js";
import {
  CONFIG_DIR_ENV_VAR,
  closeDatabase,
} from "../../../src/lib/db/index.js";
import {
  EXPECTED_TABLES,
  generatePreMigrationTableDDL,
  initSchema,
} from "../../../src/lib/db/schema.js";

/**
 * Generate DDL for creating a database with pre-migration tables.
 * This simulates a database that was created before certain migrations ran.
 */
function createPreMigrationDatabase(db: Database): void {
  // Create all tables, but use pre-migration versions for tables with migrated columns
  const preMigrationTables = ["dsn_cache", "user_info"];
  const statements: string[] = [];

  for (const tableName of Object.keys(EXPECTED_TABLES)) {
    if (preMigrationTables.includes(tableName)) {
      statements.push(generatePreMigrationTableDDL(tableName));
    } else {
      statements.push(EXPECTED_TABLES[tableName] as string);
    }
  }

  db.exec(statements.join(";\n"));
  db.query("INSERT INTO schema_version (version) VALUES (4)").run();
  db.query(
    "INSERT INTO metadata (key, value) VALUES ('json_migration_completed', 'true')"
  ).run();
}

/**
 * Generate DDL for creating a database with specific tables omitted.
 * This simulates a database that is missing certain tables.
 */
function createDatabaseWithMissingTables(
  db: Database,
  missingTables: string[]
): void {
  const statements: string[] = [];

  for (const tableName of Object.keys(EXPECTED_TABLES)) {
    if (!missingTables.includes(tableName)) {
      statements.push(EXPECTED_TABLES[tableName] as string);
    }
  }

  db.exec(statements.join(";\n"));
  db.query("INSERT INTO schema_version (version) VALUES (4)").run();
  db.query(
    "INSERT INTO metadata (key, value) VALUES ('json_migration_completed', 'true')"
  ).run();
}

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
    `fix-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

describe("sentry cli fix", () => {
  test("reports no issues for healthy database", async () => {
    // Create healthy database
    const db = new Database(join(testDir, "cli.db"));
    initSchema(db);
    db.close();

    const stdoutWrite = mock(() => true);
    const mockContext = {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      process: { exitCode: 0 },
    };

    const func = await fixCommand.loader();
    func.call(mockContext, { "dry-run": false });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No issues found");
    expect(output).toContain("up to date");
  });

  test("detects and reports missing columns in dry-run mode", async () => {
    // Create database with pre-migration tables (missing v4 columns)
    const db = new Database(join(testDir, "cli.db"));
    createPreMigrationDatabase(db);
    db.close();

    const stdoutWrite = mock(() => true);
    const mockContext = {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      process: { exitCode: 0 },
    };

    const func = await fixCommand.loader();
    func.call(mockContext, { "dry-run": true });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Found");
    expect(output).toContain("issue(s)");
    expect(output).toContain("Missing column");
    expect(output).toContain("dsn_cache.fingerprint");
    expect(output).toContain("Run 'sentry cli fix' to apply fixes");
  });

  test("fixes missing columns when not in dry-run mode", async () => {
    // Create database with pre-migration tables (missing v4 columns)
    const db = new Database(join(testDir, "cli.db"));
    createPreMigrationDatabase(db);
    db.close();

    const stdoutWrite = mock(() => true);
    const mockContext = {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      process: { exitCode: 0 },
    };

    const func = await fixCommand.loader();
    func.call(mockContext, { "dry-run": false });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Repairing");
    expect(output).toContain("Added column dsn_cache.fingerprint");
    expect(output).toContain("repaired successfully");

    // Verify the column was actually added
    closeDatabase();
    const verifyDb = new Database(join(testDir, "cli.db"));
    const cols = verifyDb.query("PRAGMA table_info(dsn_cache)").all() as Array<{
      name: string;
    }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("fingerprint");
    expect(colNames).toContain("dir_mtimes_json");
    verifyDb.close();
  });

  // Note: Testing missing tables via the command is tricky because getDatabase()
  // runs initSchema() which creates missing tables automatically. This is actually
  // the intended auto-repair behavior! The underlying repairSchema() function is
  // tested directly in test/lib/db/schema.test.ts which verifies table creation works.
  //
  // Here we just verify the command doesn't crash when run against a healthy database
  // that was previously missing tables (now fixed by auto-repair at startup).
  test("handles database that was auto-repaired at startup", async () => {
    // Create database missing dsn_cache - initSchema will create it when command runs
    const db = new Database(join(testDir, "cli.db"));
    createDatabaseWithMissingTables(db, ["dsn_cache"]);
    db.close();

    const stdoutWrite = mock(() => true);
    const mockContext = {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      process: { exitCode: 0 },
    };

    const func = await fixCommand.loader();
    // When getRawDatabase() is called, it triggers getDatabase() which runs initSchema()
    // This auto-creates the missing dsn_cache table, so the fix command sees no issues
    func.call(mockContext, { "dry-run": false });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    // Auto-repair at startup means command sees healthy database
    expect(output).toContain("No issues found");

    // Verify the table was created (by initSchema auto-repair)
    closeDatabase();
    const verifyDb = new Database(join(testDir, "cli.db"));
    const tables = verifyDb
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dsn_cache'"
      )
      .all();
    expect(tables.length).toBe(1);
    verifyDb.close();
  });

  test("shows database path in output", async () => {
    const db = new Database(join(testDir, "cli.db"));
    initSchema(db);
    db.close();

    const stdoutWrite = mock(() => true);
    const mockContext = {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      process: { exitCode: 0 },
    };

    const func = await fixCommand.loader();
    func.call(mockContext, { "dry-run": false });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Database:");
    expect(output).toContain(testDir);
  });
});
