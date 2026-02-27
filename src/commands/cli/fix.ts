/**
 * sentry cli fix
 *
 * Diagnose and repair CLI database issues (schema, permissions, and ownership).
 */

import { execFileSync } from "node:child_process";
import { chmod, chown, stat } from "node:fs/promises";
import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { getConfigDir, getDbPath, getRawDatabase } from "../../lib/db/index.js";
import {
  CURRENT_SCHEMA_VERSION,
  getSchemaIssues,
  repairSchema,
  type SchemaIssue,
} from "../../lib/db/schema.js";
import { getRealUsername } from "../../lib/utils.js";

type FixFlags = {
  readonly "dry-run": boolean;
};

/** Format a schema issue as a human-readable string for display. */
function formatIssue(issue: SchemaIssue): string {
  if (issue.type === "missing_table") {
    return `Missing table: ${issue.table}`;
  }
  if (issue.type === "missing_column") {
    return `Missing column: ${issue.table}.${issue.column}`;
  }
  return `Wrong primary key: ${issue.table}`;
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
 * A file or directory that is owned by a different user (typically root),
 * preventing the current process from writing to it.
 */
type OwnershipIssue = {
  path: string;
  kind: "directory" | "database" | "journal";
  /** UID of the file's current owner */
  ownerUid: number;
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
    const code =
      error instanceof Error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    // Missing files aren't a permission problem (WAL/SHM created on demand).
    // EACCES means the parent directory blocks stat — the directory check
    // will catch the root cause, so skip the individual file here.
    if (code === "ENOENT" || code === "EACCES") {
      return null;
    }
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
 * Check whether any config dir files or the DB are owned by a different user
 * (typically root after a `sudo` install).
 *
 * We only check the config directory and the DB file — those are the gating
 * items. If they are owned by root, chmod will fail and is pointless to attempt.
 *
 * @param dbPath - Absolute path to the database file
 * @param comparisonUid - The UID to compare against file owners. When running as
 *   root via `sudo`, pass the real user's UID (not 0) so root-owned files are detected.
 * @returns List of paths owned by a different user (empty = all owned by us)
 */
async function checkOwnership(
  dbPath: string,
  comparisonUid: number
): Promise<OwnershipIssue[]> {
  const configDir = getConfigDir();

  const checks: Array<{ path: string; kind: OwnershipIssue["kind"] }> = [
    { path: configDir, kind: "directory" },
    { path: dbPath, kind: "database" },
    { path: `${dbPath}-wal`, kind: "journal" },
    { path: `${dbPath}-shm`, kind: "journal" },
  ];

  const settled = await Promise.allSettled(checks.map((c) => stat(c.path)));
  const issues: OwnershipIssue[] = [];

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i] as PromiseSettledResult<
      Awaited<ReturnType<typeof stat>>
    >;
    const check = checks[i] as (typeof checks)[number];

    if (result.status === "fulfilled") {
      const ownerUid = Number(result.value.uid);
      if (ownerUid !== comparisonUid) {
        issues.push({ path: check.path, kind: check.kind, ownerUid });
      }
      continue;
    }

    // Missing files are fine (WAL/SHM created on demand).
    // EACCES on a child file means the directory already blocks access — the
    // directory check above will surface the real issue.
    const code =
      result.reason instanceof Error
        ? (result.reason as NodeJS.ErrnoException).code
        : undefined;
    if (code !== "ENOENT" && code !== "EACCES") {
      throw result.reason;
    }
  }

  return issues;
}

/**
 * Resolve the numeric UID for a username by running `id -u -- <username>`.
 * Returns null if the lookup fails or returns a non-numeric result.
 *
 * Uses `execFileSync` (not `execSync`) so the username is passed as a
 * separate argument — the shell never interpolates it, preventing injection.
 */
function resolveUid(username: string): number | null {
  try {
    const result = execFileSync("id", ["-u", "--", username], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const uid = Number(result.trim());
    return Number.isNaN(uid) ? null : uid;
  } catch {
    return null;
  }
}

/**
 * Perform chown on the given ownership issues, transferring files to
 * `username`. Called only when the current process is already root.
 *
 * @returns Object with lists of human-readable success and failure messages
 */
async function repairOwnership(
  issues: OwnershipIssue[],
  username: string,
  targetUid: number
): Promise<{ fixed: string[]; failed: string[] }> {
  const fixed: string[] = [];
  const failed: string[] = [];

  const results = await Promise.allSettled(
    issues.map((issue) => chown(issue.path, targetUid, -1))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i] as PromiseSettledResult<void>;
    const issue = issues[i] as OwnershipIssue;
    if (result.status === "fulfilled") {
      fixed.push(`${issue.kind} ${issue.path}: transferred to ${username}`);
    } else {
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : "unknown error";
      failed.push(`${issue.kind} ${issue.path}: ${reason}`);
    }
  }

  return { fixed, failed };
}

/**
 * Diagnose ownership issues and optionally repair them.
 *
 * When the running process is root (`currentUid === 0`), we can perform chown
 * to transfer ownership back to the real user. The real username is inferred
 * from `SUDO_USER` / `USER` / `USERNAME` env vars (set by sudo).
 *
 * When not root, we print the exact `sudo chown` command the user must run.
 *
 * @param dbPath - Absolute path to the database file
 * @param currentUid - UID of the running process
 * @param dryRun - If true, report issues without repairing
 * @param output - Streams for user-facing output
 * @returns Count of issues found and whether any repairs failed
 */
async function handleOwnershipIssues(
  dbPath: string,
  currentUid: number,
  dryRun: boolean,
  { stdout, stderr }: Output
): Promise<DiagnoseResult> {
  const configDir = getConfigDir();
  const username = getRealUsername();

  // When running as root (e.g. `sudo sentry cli fix`), files from
  // `sudo brew install` are uid 0 — same as the process uid. Compare against
  // the real user's UID instead. If we can't resolve a non-root UID, bail
  // early: using 0 would make root-owned files look correct, and chowning to
  // 0 would permanently worsen things.
  let comparisonUid = currentUid;
  let resolvedTargetUid: number | null = null;
  if (currentUid === 0) {
    const uid = resolveUid(username);
    if (uid === null || uid === 0) {
      stderr.write(
        `Warning: Could not determine a non-root UID for user "${username}".\n` +
          "Run the following command manually:\n" +
          `  chown -R ${username} "${configDir}"\n\n`
      );
      return { found: 0, repairFailed: true };
    }
    resolvedTargetUid = uid;
    comparisonUid = uid;
  }

  const issues = await checkOwnership(dbPath, comparisonUid);
  if (issues.length === 0) {
    return { found: 0, repairFailed: false };
  }

  stdout.write(`Found ${issues.length} ownership issue(s):\n`);
  for (const issue of issues) {
    stdout.write(
      `  - ${issue.kind} ${issue.path}: owned by uid ${issue.ownerUid}\n`
    );
  }
  stdout.write("\n");

  if (dryRun) {
    stdout.write(
      printOwnershipInstructions(currentUid, username, configDir, true)
    );
    return { found: issues.length, repairFailed: false };
  }

  if (currentUid !== 0) {
    // Not root — can't chown, print instructions.
    stderr.write(
      printOwnershipInstructions(currentUid, username, configDir, false)
    );
    return { found: issues.length, repairFailed: true };
  }

  // Running as root — perform chown. resolvedTargetUid is guaranteed non-null
  // and non-zero here (we bailed out above if it couldn't be resolved).
  const resolvedUid = resolvedTargetUid as number;
  stdout.write(
    `Transferring ownership to ${username} (uid ${resolvedUid})...\n`
  );
  const { fixed, failed } = await repairOwnership(
    issues,
    username,
    resolvedUid
  );
  for (const fix of fixed) {
    stdout.write(`  + ${fix}\n`);
  }
  if (failed.length > 0) {
    stderr.write("\nSome ownership repairs failed:\n");
    for (const fail of failed) {
      stderr.write(`  ! ${fail}\n`);
    }
    return { found: issues.length, repairFailed: true };
  }
  stdout.write("\n");
  return { found: issues.length, repairFailed: false };
}

/**
 * Return the ownership fix instructions string.
 *
 * @param currentUid - UID of the running process
 * @param username - The real user's login name
 * @param configDir - The config directory path
 * @param dryRun - Whether this is a dry-run preview
 */
function printOwnershipInstructions(
  currentUid: number,
  username: string,
  configDir: string,
  dryRun: boolean
): string {
  if (dryRun && currentUid === 0) {
    return `Would transfer ownership of "${configDir}" to ${username}.\n`;
  }
  return (
    "To fix ownership, run one of:\n\n" +
    `  sudo chown -R ${username} "${configDir}"\n\n` +
    "Or let sentry fix it automatically:\n\n" +
    "  sudo sentry cli fix\n\n"
  );
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
 * Directory issues are repaired first (sequentially) because child file
 * chmod calls will fail with EACCES if the parent directory lacks execute
 * permission. File issues are then repaired in parallel.
 *
 * @param issues - Permission issues to repair
 * @returns Separate lists of human-readable repair successes and failures
 */
async function repairPermissions(issues: PermissionIssue[]): Promise<{
  fixed: string[];
  failed: string[];
}> {
  const fixed: string[] = [];
  const failed: string[] = [];

  // Repair directories first so child file chmod calls don't fail with EACCES
  const dirIssues = issues.filter((i) => i.kind === "directory");
  const fileIssues = issues.filter((i) => i.kind !== "directory");

  await collectResults(dirIssues, fixed, failed);
  await collectResults(fileIssues, fixed, failed);

  return { fixed, failed };
}

/**
 * Run chmod for each issue in parallel, collecting successes and failures.
 *
 * @param issues - Permission issues to repair
 * @param fixed - Accumulator for successful repair messages
 * @param failed - Accumulator for failed repair messages
 */
async function collectResults(
  issues: PermissionIssue[],
  fixed: string[],
  failed: string[]
): Promise<void> {
  const results = await Promise.allSettled(
    issues.map(async (issue) => {
      await chmod(issue.path, issue.expectedMode);
      return `${issue.kind} ${issue.path}: ${formatMode(issue.currentMode)} -> ${formatMode(issue.expectedMode)}`;
    })
  );

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

/**
 * Run schema diagnostics, guarding against DB open failures.
 *
 * The schema check opens the database, which can throw if the DB or config
 * directory is inaccessible. This wrapper catches those errors so `--dry-run`
 * can finish all diagnostics even when the filesystem is broken.
 *
 * @param priorIssuesFound - Total ownership+permission issues already found.
 *   If non-zero, a schema open failure is expected and we stay quiet about it.
 */
function safeHandleSchemaIssues(
  dbPath: string,
  dryRun: boolean,
  out: Output,
  priorIssuesFound: number
): DiagnoseResult {
  try {
    return handleSchemaIssues(dbPath, dryRun, out);
  } catch {
    if (priorIssuesFound === 0) {
      out.stderr.write("Could not open database to check schema.\n");
      out.stderr.write(
        `Try deleting the database and restarting: rm "${dbPath}"\n`
      );
    }
    return { found: 0, repairFailed: true };
  }
}

export const fixCommand = buildCommand({
  docs: {
    brief: "Diagnose and repair CLI database issues",
    fullDescription:
      "Check the CLI's local SQLite database for schema, permission, and ownership\n" +
      "issues and repair them.\n\n" +
      "This is useful when upgrading from older CLI versions, if the database\n" +
      "becomes inconsistent due to interrupted operations, or if file permissions\n" +
      "prevent the CLI from writing to its local database.\n\n" +
      "The command performs non-destructive repairs only - it adds missing tables\n" +
      "and columns, fixes file permissions, and transfers ownership — but never\n" +
      "deletes data.\n\n" +
      "If files are owned by root (e.g. after `sudo brew install`), run with sudo\n" +
      "to transfer ownership back to the current user:\n\n" +
      "  sudo sentry cli fix\n\n" +
      "Examples:\n" +
      "  sentry cli fix              # Fix database issues\n" +
      "  sudo sentry cli fix         # Fix root-owned files\n" +
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

    // process.getuid() is undefined on Windows
    const currentUid =
      typeof process.getuid === "function" ? process.getuid() : -1;

    stdout.write(`Database: ${dbPath}\n`);
    stdout.write(`Expected schema version: ${CURRENT_SCHEMA_VERSION}\n\n`);

    // 1. Check ownership first — if files are root-owned, chmod will fail anyway.
    //    On Windows (currentUid === -1), skip the ownership check entirely.
    const ownership: DiagnoseResult =
      currentUid >= 0
        ? await handleOwnershipIssues(dbPath, currentUid, dryRun, out)
        : { found: 0, repairFailed: false };

    // 2. Check permissions (skip if ownership issues already reported failures —
    //    chmod will fail on root-owned files so the output would be misleading).
    const skipPerm = !dryRun && ownership.repairFailed;
    const perm: DiagnoseResult = skipPerm
      ? { found: 0, repairFailed: false }
      : await handlePermissionIssues(dbPath, dryRun, out);

    // 3. Schema check — guarded so filesystem errors don't hide earlier reports.
    const schema = safeHandleSchemaIssues(
      dbPath,
      dryRun,
      out,
      ownership.found + perm.found
    );

    const totalFound = ownership.found + perm.found + schema.found;
    const anyFailed =
      ownership.repairFailed || perm.repairFailed || schema.repairFailed;

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
