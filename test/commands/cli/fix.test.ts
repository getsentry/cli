/**
 * Tests for sentry cli fix command.
 */

import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { fixCommand } from "../../../src/commands/cli/fix.js";
import { closeDatabase, getDatabase } from "../../../src/lib/db/index.js";
import {
  EXPECTED_TABLES,
  generatePreMigrationTableDDL,
  initSchema,
} from "../../../src/lib/db/schema.js";
import { useTestConfigDir } from "../../helpers.js";

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

const getTestDir = useTestConfigDir("fix-test-");

/**
 * Run the fix command with the given flags and return captured output.
 * Reduces boilerplate across test cases.
 */
async function runFix(dryRun: boolean) {
  const stdoutWrite = mock(() => true);
  const stderrWrite = mock(() => true);
  const mockContext = {
    stdout: { write: stdoutWrite },
    stderr: { write: stderrWrite },
    process: { exitCode: 0 },
  };

  const func = await fixCommand.loader();
  func.call(mockContext, { "dry-run": dryRun });

  return {
    stdout: stdoutWrite.mock.calls.map((c) => c[0]).join(""),
    stderr: stderrWrite.mock.calls.map((c) => c[0]).join(""),
    exitCode: mockContext.process.exitCode,
  };
}

describe("sentry cli fix", () => {
  test("reports no issues for healthy database", async () => {
    const db = new Database(join(getTestDir(), "cli.db"));
    initSchema(db);
    db.close();

    const { stdout } = await runFix(false);
    expect(stdout).toContain("No issues found");
    expect(stdout).toContain("permissions are correct");
  });

  test("detects and reports missing columns in dry-run mode", async () => {
    // Create database with pre-migration tables (missing v4 columns)
    const db = new Database(join(getTestDir(), "cli.db"));
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
    const db = new Database(join(getTestDir(), "cli.db"));
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
    const verifyDb = new Database(join(getTestDir(), "cli.db"));
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
    const db = new Database(join(getTestDir(), "cli.db"));
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
    const verifyDb = new Database(join(getTestDir(), "cli.db"));
    const tables = verifyDb
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dsn_cache'"
      )
      .all();
    expect(tables.length).toBe(1);
    verifyDb.close();
  });

  test("shows database path in output", async () => {
    const db = new Database(join(getTestDir(), "cli.db"));
    initSchema(db);
    db.close();

    const { stdout } = await runFix(false);
    expect(stdout).toContain("Database:");
    expect(stdout).toContain(getTestDir());
  });

  test("detects permission issues on readonly database file", async () => {
    // Warm the DB cache so getRawDatabase() won't try to reinitialize
    // after we break permissions (PRAGMAs like WAL need write access)
    getDatabase();
    const dbPath = join(getTestDir(), "cli.db");

    chmodSync(dbPath, 0o444);
    const { stdout } = await runFix(true);

    expect(stdout).toContain("permission issue(s)");
    expect(stdout).toContain("0444");
    expect(stdout).toContain("Run 'sentry cli fix' to apply fixes");

    chmodSync(dbPath, 0o644);
  });

  test("repairs database file permissions", async () => {
    getDatabase();
    const dbPath = join(getTestDir(), "cli.db");

    chmodSync(dbPath, 0o444);
    const { stdout, exitCode } = await runFix(false);

    expect(stdout).toContain("Repairing permissions");
    expect(stdout).toContain("0444");
    expect(stdout).toContain("0600");
    expect(stdout).toContain("repaired successfully");
    expect(exitCode).toBe(0);

    // biome-ignore lint/suspicious/noBitwiseOperators: verifying permission bits
    const repairedMode = statSync(dbPath).mode & 0o777;
    // biome-ignore lint/suspicious/noBitwiseOperators: verifying permission bits
    expect(repairedMode & 0o600).toBe(0o600);
  });

  test("detects directory permission issues", async () => {
    getDatabase();

    // Remove write bit from config directory — WAL/SHM files can't be created
    chmodSync(getTestDir(), 0o500);
    const { stdout } = await runFix(true);

    expect(stdout).toContain("permission issue(s)");
    expect(stdout).toContain("directory");
    expect(stdout).toContain(getTestDir());

    chmodSync(getTestDir(), 0o700);
  });

  test("dry-run reports permission issues without repairing", async () => {
    getDatabase();
    const dbPath = join(getTestDir(), "cli.db");

    chmodSync(dbPath, 0o444);
    const { stdout } = await runFix(true);

    expect(stdout).toContain("permission issue(s)");
    expect(stdout).not.toContain("Repairing");

    // File should still be readonly — dry-run didn't touch it
    // biome-ignore lint/suspicious/noBitwiseOperators: verifying permission bits
    const mode = statSync(dbPath).mode & 0o777;
    expect(mode).toBe(0o444);

    chmodSync(dbPath, 0o644);
  });

  test("handles both permission and schema issues together", async () => {
    // Create a pre-migration DB (missing columns) then break permissions.
    // The fix command repairs permissions first, which unblocks schema repair.
    const dbPath = join(getTestDir(), "cli.db");
    const db = new Database(dbPath);
    createPreMigrationDatabase(db);
    db.close();

    // Warm the cache with this pre-migration DB so getRawDatabase() works
    getDatabase();

    chmodSync(dbPath, 0o444);
    const { stdout, exitCode } = await runFix(false);

    expect(stdout).toContain("permission issue(s)");
    expect(stdout).toContain("Repairing permissions");
    expect(stdout).toContain("schema issue(s)");
    expect(stdout).toContain("Repairing schema");
    expect(stdout).toContain("repaired successfully");
    expect(exitCode).toBe(0);
  });
});
