/**
 * Project-level migration runner.
 *
 * Reads the workspace into memory, runs every task against it, then diffs the
 * result. Writing is a separate, explicit step so that `--dry-run` and a real
 * run take the same code path. A dry run that takes a different path lies.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { walkFiles } from "../scan/index.js";
import {
  createApi,
  createWorkspace,
  finalizeWorkspace,
  type Workspace,
} from "./api.js";
import { collectTasks, type Migration } from "./framework.js";
import { type MigrationChoice, selectMigration } from "./select.js";
import type { Finding } from "./types.js";

export type FileChange = { file: string; before: string; after: string };

export type MigrationResult = {
  /** Which migration ran, and why it was chosen. */
  migration: { id: string; description: string; because: string };
  changes: FileChange[];
  findings: Finding[];
  errors: Array<{ taskId: string; message: string }>;
  scanned: number;
  /** The report contents, or `null` when there is nothing left to do. */
  report: string | null;
  /** Where the report goes, and how to tell ours apart from the user's. */
  reportFile: string | null;
  reportMarker: string | null;
};

export type RunOptions = {
  root: string;
  only?: string[];
  skip?: string[];
  /** Force a migration by id instead of detecting one. */
  migration?: string;
};

/**
 * Read every file this migration could plausibly care about.
 *
 * Which files those are is the migration's answer, not the runner's. Walking
 * every source file in the wrong ecosystem is wasted work, and a migration
 * whose tasks look at files the runner never admits has tasks that can never
 * fire.
 */
async function readWorkspace(
  root: string,
  migration: Migration
): Promise<Workspace> {
  const files = new Map<string, string>();

  for await (const entry of walkFiles({ cwd: root })) {
    if (entry.isBinary || !migration.workspace.wants(entry.relativePath)) {
      continue;
    }
    try {
      files.set(
        entry.relativePath,
        await readFile(entry.absolutePath, "utf-8")
      );
    } catch {
      // Unreadable files are skipped; a migration must not die on one.
    }
  }

  return createWorkspace(root, files);
}

/** Apply `--only` / `--skip` to a migration's task list. */
function selectTasks(migration: Migration, options: RunOptions) {
  const only = options.only?.length ? new Set(options.only) : null;
  const skip = new Set(options.skip ?? []);
  return collectTasks(migration).filter(
    (task) => (!only || only.has(task.id)) && !skip.has(task.id)
  );
}

/** Collect the files a migration changed, by diffing against what was read. */
function diffWorkspace(workspace: Workspace): FileChange[] {
  const changes: FileChange[] = [];
  for (const [file, after] of workspace.files) {
    const before = workspace.original.get(file);
    if (before !== undefined && before !== after) {
      changes.push({ file, before, after });
    }
  }
  return changes;
}

/**
 * Plan a migration without writing anything.
 *
 * The migration is detected rather than assumed. This CLI is one binary for
 * every language Sentry ships an SDK for, so "which migration does this
 * project need" has a real answer, and one of the answers is "none".
 *
 * @throws {NoMigrationError} when no registered migration applies, when the
 * one named by `options.migration` cannot run, or when the choice is
 * ambiguous. Those messages are written for the user.
 */
export async function planMigration(
  options: RunOptions,
  preselected?: MigrationChoice
): Promise<MigrationResult> {
  // The command selects first so it can validate --only/--skip against the
  // chosen migration's tasks. Callers that do not care can let this do it.
  const chosen =
    preselected ?? (await selectMigration(options.root, options.migration));
  const migration = chosen.migration;

  const workspace = await readWorkspace(options.root, migration);
  const findings: Finding[] = [];
  const errors: MigrationResult["errors"] = [];
  const selected = selectTasks(migration, options);

  for (const task of selected) {
    const api = createApi(workspace, { id: task.id }, findings);

    try {
      task.run({ api, cwd: options.root });
    } catch (error) {
      // A task bug must not abort the run. A migration that dies halfway
      // leaves a tree on neither the old version nor the new one.
      errors.push({
        taskId: task.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  finalizeWorkspace(workspace);

  // Reporting is a task like any other, so `--only` and `--skip` have to be
  // able to turn it off. Building it unconditionally would make a flag the
  // command accepts and validates silently do nothing.
  const reporting = migration.report;
  const reportSelected =
    reporting && selected.some((task) => task.id === reporting.taskId);

  // The report needs every task's findings, so it is built last, against the
  // already-migrated workspace.
  const report =
    reporting && reportSelected
      ? reporting.build({ findings, tasks: selected })
      : null;

  return {
    migration: {
      id: migration.id,
      description: migration.description,
      because: chosen.because,
    },
    changes: diffWorkspace(workspace),
    findings,
    errors,
    scanned: workspace.original.size,
    report,
    reportFile: reporting?.file ?? null,
    reportMarker: reporting?.marker ?? null,
  };
}

/**
 * Write a plan to disk.
 *
 * Everything that can refuse the write happens before the first byte is
 * written. Check the report file afterwards instead and the user whose
 * hand-written file blocks it gets their source tree rewritten and an error
 * saying nothing happened.
 *
 * @throws if the report file exists and was not generated by this tool.
 * Overwriting a file the user wrote by hand at that path would eat their work,
 * and this is the one place the migration creates rather than edits a file.
 */
export async function applyMigration(
  root: string,
  result: MigrationResult
): Promise<void> {
  const writesReport = result.report !== null && result.reportFile !== null;
  const reportPath = writesReport
    ? path.join(root, result.reportFile as string)
    : null;

  if (reportPath && result.reportMarker) {
    const existing = await readFile(reportPath, "utf-8").catch(() => null);
    if (existing !== null && !existing.includes(result.reportMarker)) {
      throw new Error(
        `${result.reportFile} already exists and was not generated by \`sentry migrate\`.\n` +
          "Move or rename it, then run again."
      );
    }
  }

  for (const change of result.changes) {
    await writeFile(path.join(root, change.file), change.after, "utf-8");
  }

  if (reportPath && result.report !== null) {
    await writeFile(reportPath, result.report, "utf-8");
  }
}
