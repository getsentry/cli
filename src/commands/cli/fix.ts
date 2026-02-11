/**
 * sentry cli fix
 *
 * Diagnose and repair CLI database issues (schema and permissions).
 */

import { chmodSync, statSync } from "node:fs";
import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { getConfigDir, getDbPath, getRawDatabase } from "../../lib/db/index.js";
import {
  CURRENT_SCHEMA_VERSION,
  getSchemaIssues,
  repairSchema,
  type SchemaIssue,
} from "../../lib/db/schema.js";

type FixFlags = {
  readonly "dry-run": boolean;
};

/** Format a schema issue as a human-readable string for display. */
function formatIssue(issue: SchemaIssue): string {
  if (issue.type === "missing_table") {
    return `Missing table: ${issue.table}`;
  }
  return `Missing column: ${issue.table}.${issue.column}`;
}

/** Expected permissions for the config directory (owner rwx) */
const EXPECTED_DIR_MODE = 0o700;
/** Expected permissions for the database file (owner rw) */
const EXPECTED_FILE_MODE = 0o600;

type PermissionIssue = {
  path: string;
  /** What kind of file this is (for display) */
  kind: "directory" | "database" | "journal";
  currentMode: number;
  expectedMode: number;
};

/**
 * Check if a path has the required permission bits set.
 *
 * @param path - Filesystem path to check
 * @param expectedMode - Bitmask of required permission bits (e.g., 0o700)
 * @returns Object with the actual mode if permissions are insufficient, or null if OK.
 *          Returns null if the path doesn't exist (missing files aren't a permission problem).
 */
function checkMode(
  path: string,
  expectedMode: number
): { actualMode: number } | null {
  try {
    const st = statSync(path);
    // biome-ignore lint/suspicious/noBitwiseOperators: extracting permission bits with bitmask
    const mode = st.mode & 0o777;
    // biome-ignore lint/suspicious/noBitwiseOperators: checking required permission bits are set
    if ((mode & expectedMode) !== expectedMode) {
      return { actualMode: mode };
    }
  } catch {
    // File/dir doesn't exist — not a permission issue
  }
  return null;
}

/**
 * Check if the database file and its directory have correct permissions.
 * Inspects the config directory (needs rwx), the DB file, and SQLite's
 * WAL/SHM journal files (need rw). Missing files are silently skipped
 * since WAL/SHM are created on demand.
 *
 * @param dbPath - Absolute path to the database file
 * @returns List of permission issues found (empty if everything is OK)
 */
function checkPermissions(dbPath: string): PermissionIssue[] {
  const issues: PermissionIssue[] = [];
  const configDir = getConfigDir();

  // Check config directory permissions
  const dirCheck = checkMode(configDir, EXPECTED_DIR_MODE);
  if (dirCheck) {
    issues.push({
      path: configDir,
      kind: "directory",
      currentMode: dirCheck.actualMode,
      expectedMode: EXPECTED_DIR_MODE,
    });
  }

  // Check database file and associated WAL/SHM files
  const filesToCheck: Array<{ path: string; kind: "database" | "journal" }> = [
    { path: dbPath, kind: "database" },
    { path: `${dbPath}-wal`, kind: "journal" },
    { path: `${dbPath}-shm`, kind: "journal" },
  ];

  for (const { path, kind } of filesToCheck) {
    const fileCheck = checkMode(path, EXPECTED_FILE_MODE);
    if (fileCheck) {
      issues.push({
        path,
        kind,
        currentMode: fileCheck.actualMode,
        expectedMode: EXPECTED_FILE_MODE,
      });
    }
  }

  return issues;
}

/**
 * Format a permission mode as an octal string (e.g., "0644").
 *
 * @param mode - Unix permission bits (0-0o777)
 */
function formatMode(mode: number): string {
  return `0${mode.toString(8)}`;
}

/**
 * Attempt to fix file/directory permissions via chmod.
 * Repairs may fail if the current user doesn't own the file.
 *
 * @param issues - Permission issues to repair
 * @returns Separate lists of human-readable repair successes and failures
 */
function repairPermissions(issues: PermissionIssue[]): {
  fixed: string[];
  failed: string[];
} {
  const fixed: string[] = [];
  const failed: string[] = [];

  for (const issue of issues) {
    try {
      chmodSync(issue.path, issue.expectedMode);
      fixed.push(
        `${issue.kind} ${issue.path}: ${formatMode(issue.currentMode)} -> ${formatMode(issue.expectedMode)}`
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "permission denied";
      failed.push(`${issue.kind} ${issue.path}: ${reason}`);
    }
  }

  return { fixed, failed };
}

type Output = {
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
};

/** Result of diagnosing a category of issues */
type DiagnoseResult = {
  /** Number of issues found */
  found: number;
  /** Whether any repairs failed (only meaningful when not dry-run) */
  repairFailed: boolean;
};

/**
 * Diagnose permission issues and optionally repair them.
 * Writes findings and repair results to stdout/stderr as a side effect.
 *
 * @param dbPath - Absolute path to the database file
 * @param dryRun - If true, report issues without repairing
 * @param output - Streams for user-facing output
 * @returns Count of issues found and whether any repairs failed
 */
function handlePermissionIssues(
  dbPath: string,
  dryRun: boolean,
  { stdout, stderr }: Output
): DiagnoseResult {
  const permIssues = checkPermissions(dbPath);
  if (permIssues.length === 0) {
    return { found: 0, repairFailed: false };
  }

  stdout.write(`Found ${permIssues.length} permission issue(s):\n`);
  for (const issue of permIssues) {
    stdout.write(
      `  - ${issue.kind} ${issue.path}: ${formatMode(issue.currentMode)} (expected ${formatMode(issue.expectedMode)})\n`
    );
  }
  stdout.write("\n");

  if (dryRun) {
    return { found: permIssues.length, repairFailed: false };
  }

  stdout.write("Repairing permissions...\n");
  const { fixed, failed } = repairPermissions(permIssues);
  for (const fix of fixed) {
    stdout.write(`  + ${fix}\n`);
  }
  if (failed.length > 0) {
    stderr.write("\nSome permission repairs failed:\n");
    for (const fail of failed) {
      stderr.write(`  ! ${fail}\n`);
    }
    stderr.write(
      "\nYou may need to fix permissions manually:\n" +
        `  chmod 700 "${getConfigDir()}"\n` +
        `  chmod 600 "${dbPath}"\n`
    );
  }
  stdout.write("\n");

  return { found: permIssues.length, repairFailed: failed.length > 0 };
}

/**
 * Diagnose schema issues (missing tables/columns) and optionally repair them.
 * Writes findings and repair results to stdout/stderr as a side effect.
 *
 * @param dbPath - Absolute path to the database file (used in error messages)
 * @param dryRun - If true, report issues without repairing
 * @param output - Streams for user-facing output
 * @returns Count of issues found and whether any repairs failed
 */
function handleSchemaIssues(
  dbPath: string,
  dryRun: boolean,
  { stdout, stderr }: Output
): DiagnoseResult {
  const db = getRawDatabase();
  const issues = getSchemaIssues(db);
  if (issues.length === 0) {
    return { found: 0, repairFailed: false };
  }

  stdout.write(`Found ${issues.length} schema issue(s):\n`);
  for (const issue of issues) {
    stdout.write(`  - ${formatIssue(issue)}\n`);
  }
  stdout.write("\n");

  if (dryRun) {
    return { found: issues.length, repairFailed: false };
  }

  stdout.write("Repairing schema...\n");
  const { fixed, failed } = repairSchema(db);
  for (const fix of fixed) {
    stdout.write(`  + ${fix}\n`);
  }
  if (failed.length > 0) {
    stderr.write("\nSome schema repairs failed:\n");
    for (const fail of failed) {
      stderr.write(`  ! ${fail}\n`);
    }
    stderr.write(
      `\nTry deleting the database and restarting: rm "${dbPath}"\n`
    );
  }
  stdout.write("\n");

  return { found: issues.length, repairFailed: failed.length > 0 };
}

/**
 * Entry point for `sentry cli fix`. Runs permission and schema checks
 * in sequence, repairs what it can, and reports results.
 */
function fixFunc(this: SentryContext, flags: FixFlags): void {
  const { stdout, process: proc } = this;
  const dbPath = getDbPath();
  const dryRun = flags["dry-run"];
  const out = { stdout, stderr: this.stderr };

  stdout.write(`Database: ${dbPath}\n`);
  stdout.write(`Expected schema version: ${CURRENT_SCHEMA_VERSION}\n\n`);

  const perm = handlePermissionIssues(dbPath, dryRun, out);
  const schema = handleSchemaIssues(dbPath, dryRun, out);
  const totalFound = perm.found + schema.found;

  if (totalFound === 0) {
    stdout.write(
      "No issues found. Database schema and permissions are correct.\n"
    );
    return;
  }

  if (dryRun) {
    stdout.write("Run 'sentry cli fix' to apply fixes.\n");
    return;
  }

  if (perm.repairFailed || schema.repairFailed) {
    proc.exitCode = 1;
  } else {
    stdout.write("All issues repaired successfully.\n");
  }
}

export const fixCommand = buildCommand({
  docs: {
    brief: "Diagnose and repair CLI database issues",
    fullDescription:
      "Check the CLI's local SQLite database for schema and permission issues and repair them.\n\n" +
      "This is useful when upgrading from older CLI versions, if the database\n" +
      "becomes inconsistent due to interrupted operations, or if file permissions\n" +
      "prevent the CLI from writing to its local database.\n\n" +
      "The command performs non-destructive repairs only - it adds missing tables\n" +
      "and columns, and fixes file permissions, but never deletes data.\n\n" +
      "Examples:\n" +
      "  sentry cli fix              # Fix database issues\n" +
      "  sentry cli fix --dry-run    # Show what would be fixed without making changes",
  },
  parameters: {
    flags: {
      "dry-run": {
        kind: "boolean",
        brief: "Show what would be fixed without making changes",
        default: false,
      },
    },
  },
  func: fixFunc,
});
