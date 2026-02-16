/**
 * sentry cli fix
 *
 * Diagnose and repair CLI database issues (schema and permissions).
 */

import { chmod, stat } from "node:fs/promises";
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
 * Check if a path has the exact expected permission mode.
 *
 * Uses exact match (not bitmask) so extra bits like group/other read (e.g.,
 * 0o644 instead of 0o600) are flagged as issues — the CLI's local database
 * may contain auth tokens and should not be accessible to other users.
 *
 * @param path - Filesystem path to check
 * @param expectedMode - Exact permission mode (e.g., 0o700, 0o600)
 * @returns Object with the actual mode if permissions differ, or null if OK.
 *          Returns null if the path doesn't exist (ENOENT). Re-throws unexpected errors
 *          so they propagate to the user and get captured by Sentry's error handling.
 */
async function checkMode(
  path: string,
  expectedMode: number
): Promise<{ actualMode: number } | null> {
  try {
    const st = await stat(path);
    // biome-ignore lint/suspicious/noBitwiseOperators: extracting permission bits with bitmask
    const mode = st.mode & 0o777;
    if (mode !== expectedMode) {
      return { actualMode: mode };
    }
  } catch (error: unknown) {
    // Missing files aren't a permission problem (WAL/SHM created on demand)
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    // Unexpected filesystem error — re-throw so it surfaces to the user
    // and gets captured by the top-level Sentry error handler in bin.ts
    throw error;
  }
  return null;
}

/**
 * Check if the database file and its directory have correct permissions.
 * Inspects the config directory (needs rwx), the DB file, and SQLite's
 * WAL/SHM journal files (need rw) in parallel. Missing files are silently
 * skipped since WAL/SHM are created on demand.
 *
 * @param dbPath - Absolute path to the database file
 * @returns List of permission issues found (empty if everything is OK)
 */
async function checkPermissions(dbPath: string): Promise<PermissionIssue[]> {
  const configDir = getConfigDir();

  const checks: Array<{
    path: string;
    kind: PermissionIssue["kind"];
    expectedMode: number;
  }> = [
    { path: configDir, kind: "directory", expectedMode: EXPECTED_DIR_MODE },
    { path: dbPath, kind: "database", expectedMode: EXPECTED_FILE_MODE },
    {
      path: `${dbPath}-wal`,
      kind: "journal",
      expectedMode: EXPECTED_FILE_MODE,
    },
    {
      path: `${dbPath}-shm`,
      kind: "journal",
      expectedMode: EXPECTED_FILE_MODE,
    },
  ];

  const results = await Promise.all(
    checks.map(async ({ path, kind, expectedMode }) => {
      const result = await checkMode(path, expectedMode);
      if (result) {
        return {
          path,
          kind,
          currentMode: result.actualMode,
          expectedMode,
        } satisfies PermissionIssue;
      }
      return null;
    })
  );

  return results.filter((r): r is PermissionIssue => r !== null);
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
 * Attempt to fix file/directory permissions via chmod in parallel.
 * Repairs may fail if the current user doesn't own the file.
 *
 * @param issues - Permission issues to repair
 * @returns Separate lists of human-readable repair successes and failures
 */
async function repairPermissions(issues: PermissionIssue[]): Promise<{
  fixed: string[];
  failed: string[];
}> {
  const results = await Promise.allSettled(
    issues.map(async (issue) => {
      await chmod(issue.path, issue.expectedMode);
      return `${issue.kind} ${issue.path}: ${formatMode(issue.currentMode)} -> ${formatMode(issue.expectedMode)}`;
    })
  );

  const fixed: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i] as PromiseSettledResult<string>;
    if (result.status === "fulfilled") {
      fixed.push(result.value);
    } else {
      const issue = issues[i] as PermissionIssue;
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : "permission denied";
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
async function handlePermissionIssues(
  dbPath: string,
  dryRun: boolean,
  { stdout, stderr }: Output
): Promise<DiagnoseResult> {
  const permIssues = await checkPermissions(dbPath);
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
  const { fixed, failed } = await repairPermissions(permIssues);
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
  async func(this: SentryContext, flags: FixFlags): Promise<void> {
    const { stdout, process: proc } = this;
    const dbPath = getDbPath();
    const dryRun = flags["dry-run"];
    const out = { stdout, stderr: this.stderr };

    stdout.write(`Database: ${dbPath}\n`);
    stdout.write(`Expected schema version: ${CURRENT_SCHEMA_VERSION}\n\n`);

    const perm = await handlePermissionIssues(dbPath, dryRun, out);

    // Schema check opens the database, which can throw if the DB or config
    // directory is readonly. Guard with try/catch so --dry-run can finish
    // diagnostics even when the filesystem is broken.
    let schema: DiagnoseResult;
    try {
      schema = handleSchemaIssues(dbPath, dryRun, out);
    } catch {
      // If we already found permission issues, the schema check failure is
      // expected — don't obscure the permission report with an unrelated crash.
      // If no permission issues were found, this is unexpected so re-report it.
      if (perm.found === 0) {
        out.stderr.write("Could not open database to check schema.\n");
        out.stderr.write(
          `Try deleting the database and restarting: rm "${dbPath}"\n`
        );
      }
      schema = { found: 0, repairFailed: true };
    }

    const totalFound = perm.found + schema.found;
    const anyFailed = perm.repairFailed || schema.repairFailed;

    if (totalFound === 0 && !anyFailed) {
      stdout.write(
        "No issues found. Database schema and permissions are correct.\n"
      );
      return;
    }

    if (dryRun) {
      if (totalFound > 0) {
        stdout.write("Run 'sentry cli fix' to apply fixes.\n");
      }
      if (anyFailed) {
        proc.exitCode = 1;
      }
      return;
    }

    if (anyFailed) {
      proc.exitCode = 1;
    } else {
      stdout.write("All issues repaired successfully.\n");
    }
  },
});
