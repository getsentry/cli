/**
 * sentry migrate
 *
 * Upgrade a project across a Sentry SDK major version.
 *
 * Which migration to run is detected, not assumed. This CLI is one binary for
 * every language Sentry ships an SDK for, so the command asks every registered
 * migration whether it recognises the project and refuses with something
 * useful when none of them does. One migration ships today, for the JavaScript
 * SDK 10.x → 11.x.
 *
 * Deterministic end to end, with no model, no network and no auth. It applies
 * every breaking change that can be made mechanically, annotates the call
 * sites that need judgment, and writes a checklist describing what is left.
 * That file is the handoff to an agent, which runs last and only over work the
 * codemod has already proven it cannot do.
 *
 * Dependencies in `package.json` are rewritten but never installed, so
 * `git checkout` is a complete undo and no lockfile churn buries the diff.
 */

import path from "node:path";
import type { SentryContext } from "../context.js";
import { buildCommand } from "../lib/command.js";
import { colorTag, renderMarkdown } from "../lib/formatters/markdown.js";
import { CommandOutput } from "../lib/formatters/output.js";
import { getUncommittedFiles, isInsideGitWorkTree } from "../lib/git.js";
import { logger } from "../lib/logger.js";
import {
  applyMigration,
  collectTasks,
  describeMigrations,
  type Migration,
  type MigrationResult,
  NoMigrationError,
  planMigration,
  selectMigration,
} from "../lib/migrate/index.js";

const log = logger.withTag("migrate");

type MigrateFlags = {
  cwd?: string;
  "dry-run"?: boolean;
  "allow-dirty"?: boolean;
  migration?: string;
  only?: string;
  skip?: string;
  json?: boolean;
};

/** What the command reports, in both human and JSON form. */
type MigrateReport = {
  root: string;
  dryRun: boolean;
  /** Which migration was selected, and the evidence for selecting it. */
  migration: { id: string; description: string; because: string };
  scanned: number;
  filesChanged: number;
  fixed: number;
  manual: number;
  checklist: string | null;
  errors: Array<{ taskId: string; message: string }>;
  changedFiles: string[];
};

/**
 * Why it would be unsafe to rewrite this tree in place, if it would be.
 *
 * Both cases come down to the same thing. The migration edits source files in
 * place, and the user's only realistic undo is `git checkout`. Without a
 * repository there is no undo at all, and with uncommitted work `git diff` no
 * longer isolates what this tool did.
 */
function gitSafetyProblem(
  root: string
): { error: string; hint: string } | null {
  if (!isInsideGitWorkTree(root)) {
    return {
      error: "not inside a git repository",
      hint:
        "This rewrites files in place and git is the undo. Run `git init` " +
        "first, use --dry-run to preview, or --allow-dirty to proceed anyway.",
    };
  }

  const uncommitted = getUncommittedFiles(root);
  if (uncommitted.length > 0) {
    return {
      error: `working tree has ${uncommitted.length} uncommitted change(s)`,
      hint:
        "Commit or stash first, so `git diff` shows only the migration. " +
        "Use --dry-run to preview, or --allow-dirty to override.",
    };
  }

  return null;
}

/** What to tell the user to do next. */
function closingHint(
  result: MigrationResult,
  dryRun: boolean,
  hasReport: boolean
): string {
  if (result.changes.length === 0 && !hasReport) {
    return `Nothing to migrate. This project already looks migrated for ${result.migration.description}.`;
  }
  if (dryRun) {
    return "Dry run. Re-run without --dry-run to apply.";
  }
  return hasReport
    ? `Install your dependencies, then work through ${result.reportFile}.`
    : "Install your dependencies, then run your build.";
}

/** Reject `--only` / `--skip` ids that no task answers to. */
function unknownTask(
  flags: MigrateFlags,
  migration: Migration
): { error: string; hint: string } | null {
  const known = new Set(collectTasks(migration).map((task) => task.id));
  const unknown = [...splitList(flags.only), ...splitList(flags.skip)].filter(
    (id) => !known.has(id)
  );
  if (unknown.length === 0) {
    return null;
  }
  return {
    error: `unknown task: ${unknown.join(", ")}`,
    hint: `Known tasks: ${[...known].sort().join(", ")}`,
  };
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function buildSummary(
  root: string,
  result: MigrationResult,
  dryRun: boolean,
  wroteChecklist: boolean
): MigrateReport {
  return {
    root,
    dryRun,
    migration: result.migration,
    scanned: result.scanned,
    filesChanged: result.changes.length,
    fixed: result.findings.filter((finding) => finding.kind === "fixed").length,
    manual: result.findings.filter((finding) => finding.kind === "manual")
      .length,
    checklist: wroteChecklist ? result.reportFile : null,
    errors: result.errors,
    changedFiles: result.changes.map((change) => change.file),
  };
}

/** What the command emits when it refuses to run. */
type MigrateRefusal = { error: string };

/**
 * Turn a user-facing error into the command's refusal shape.
 *
 * Both `setup` and `applyMigration` throw messages written for the user, whose
 * second line is the "here is what to do" half. Rendering either as a stack
 * trace would bury that and report an actionable refusal as a crash.
 */
function refusalFrom(error: unknown): { error: string; hint: string } {
  const message = error instanceof Error ? error.message : String(error);
  const [summary, ...rest] = message.split("\n");
  return {
    error: summary ?? "migration failed",
    hint: rest.join(" ").trim() || (summary ?? ""),
  };
}

function isRefusal(
  data: MigrateReport | MigrateRefusal
): data is MigrateRefusal {
  return "error" in data;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

/** The headline: what was fixed and what is left. */
function formatCounts(data: MigrateReport): string[] {
  const verb = data.dryRun ? "would change" : "changed";
  const lines = [
    `${colorTag("green", "✓")} ${data.fixed} change${plural(data.fixed)} applied ` +
      `automatically across ${data.filesChanged} file${plural(data.filesChanged)} ` +
      `(${verb}), with no model calls`,
  ];

  if (data.manual > 0) {
    lines.push(
      `${colorTag("yellow", "⚠")} ${data.manual} thing${plural(data.manual)} need ` +
        `judgment${data.checklist ? ` (see ${data.checklist})` : ""}`
    );
  }

  lines.push(
    "",
    colorTag(
      "muted",
      `Scanned ${data.scanned} files. This reports what was found in your project, ` +
        "not every change in the release. The migration guide is the complete list."
    )
  );

  return lines;
}

function formatSummary(data: MigrateReport | MigrateRefusal): string {
  // Every early return yields this shape rather than a report: the git guard,
  // an unknown task id, no applicable migration.
  if (isRefusal(data)) {
    return renderMarkdown(`${colorTag("red", "✗")} ${data.error}`);
  }

  const lines: string[] = [];

  // Which migration ran, and the evidence for picking it. On a machine with
  // projects in several languages, "it chose this one because of that" is the
  // difference between a tool that guessed and one that can be checked.
  lines.push(
    `${colorTag("muted", "Migration:")} ${data.migration.description} ` +
      colorTag("muted", `(${data.migration.because})`)
  );

  lines.push("");

  if (data.dryRun) {
    lines.push(colorTag("yellow", "Dry run. Nothing was written."));
    lines.push("");
  }

  lines.push(...formatCounts(data));

  if (data.errors.length > 0) {
    lines.push("", colorTag("red", `${data.errors.length} task error(s):`));
    for (const error of data.errors.slice(0, 5)) {
      lines.push(`  ${error.taskId} — ${error.message}`);
    }
  }

  if (!data.dryRun && data.filesChanged > 0) {
    lines.push("");
    lines.push(colorTag("muted", "Review with `git diff` before committing."));
  }

  return renderMarkdown(lines.join("\n"));
}

export const migrateCommand = buildCommand({
  docs: {
    brief: "Upgrade a project across a Sentry SDK major version",
    fullDescription:
      "Upgrade the current project across a Sentry SDK major version.\n\n" +
      "The migration is detected from the project itself; pick one explicitly " +
      "with --migration <id>. Available migrations: " +
      `${describeMigrations()}.\n\n` +
      "Every change that can be made deterministically is applied directly. " +
      "Call sites that need a human decision get a marker comment, and a " +
      "checklist is written describing everything left to do. Hand that file " +
      "to a coding agent.\n\n" +
      "Dependency manifests are updated but **not installed**; run your " +
      "package manager afterwards. Nothing is sent anywhere and no model is " +
      "invoked.\n\n" +
      "Safe to run more than once.",
  },
  // Purely local source transformation; there is nothing to authenticate to.
  auth: false,
  output: {
    human: formatSummary,
  },
  parameters: {
    flags: {
      "dry-run": {
        kind: "boolean",
        brief: "Report what would change without writing anything",
        optional: true,
      },
      "allow-dirty": {
        kind: "boolean",
        brief: "Run even though the working tree has uncommitted changes",
        optional: true,
      },
      migration: {
        kind: "parsed",
        parse: String,
        brief: "Run a specific migration instead of detecting one",
        optional: true,
      },
      cwd: {
        kind: "parsed",
        parse: String,
        brief: "Directory to migrate (defaults to the current directory)",
        optional: true,
      },
      only: {
        kind: "parsed",
        parse: String,
        brief: "Comma-separated task ids to run exclusively",
        optional: true,
      },
      skip: {
        kind: "parsed",
        parse: String,
        brief: "Comma-separated task ids to skip",
        optional: true,
      },
    },
  },
  async *func(this: SentryContext, flags: MigrateFlags) {
    const root = flags.cwd ? path.resolve(this.cwd, flags.cwd) : this.cwd;
    const dryRun = flags["dry-run"] === true;

    // git is the undo mechanism for a codemod that rewrites source in place,
    // so it has to actually be usable. This check is the only thing standing
    // between a bad task and unrecoverable work.
    if (!(dryRun || flags["allow-dirty"])) {
      const blocked = gitSafetyProblem(root);
      if (blocked) {
        this.process.exitCode = 1;
        yield new CommandOutput({ error: blocked.error });
        return { hint: blocked.hint };
      }
    }

    // Which migration applies is a question, not a default. This CLI runs in
    // projects of every language Sentry supports. Selecting first also means
    // `--only`/`--skip` are validated against the tasks that will actually
    // run.
    let chosen: Awaited<ReturnType<typeof selectMigration>>;
    try {
      chosen = await selectMigration(root, flags.migration);
    } catch (error) {
      this.process.exitCode = 1;
      const refused =
        error instanceof NoMigrationError
          ? { error: error.message, hint: error.hint }
          : refusalFrom(error);
      yield new CommandOutput({ error: refused.error });
      return { hint: refused.hint };
    }

    const badTask = unknownTask(flags, chosen.migration);
    if (badTask) {
      this.process.exitCode = 1;
      yield new CommandOutput({ error: badTask.error });
      return { hint: badTask.hint };
    }

    log.debug("planning migration", {
      root,
      dryRun,
      migration: chosen.migration.id,
    });

    let result: MigrationResult;
    try {
      result = await planMigration(
        {
          root,
          only: splitList(flags.only),
          skip: splitList(flags.skip),
        },
        chosen
      );
    } catch (error) {
      this.process.exitCode = 1;
      const refused = refusalFrom(error);
      yield new CommandOutput({ error: refused.error });
      return { hint: refused.hint };
    }

    const hasReport = result.report !== null;

    if (!dryRun) {
      try {
        await applyMigration(root, result);
      } catch (error) {
        // `applyMigration` refuses before it writes anything, and its message
        // tells the user how to unblock it.
        this.process.exitCode = 1;
        const refused = refusalFrom(error);
        yield new CommandOutput({ error: refused.error });
        return { hint: refused.hint };
      }
    }

    yield new CommandOutput(
      buildSummary(root, result, dryRun, hasReport && !dryRun)
    );

    return { hint: closingHint(result, dryRun, hasReport) };
  },
});
