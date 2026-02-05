/**
 * sentry cli fix
 *
 * Diagnose and repair CLI database issues.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getDbPath, getRawDatabase } from "../../lib/db/index.js";
import {
  CURRENT_SCHEMA_VERSION,
  getSchemaIssues,
  repairSchema,
  type SchemaIssue,
} from "../../lib/db/schema.js";

type FixFlags = {
  readonly "dry-run": boolean;
};

function formatIssue(issue: SchemaIssue): string {
  if (issue.type === "missing_table") {
    return `Missing table: ${issue.table}`;
  }
  return `Missing column: ${issue.table}.${issue.column}`;
}

export const fixCommand = buildCommand({
  docs: {
    brief: "Diagnose and repair CLI database issues",
    fullDescription:
      "Check the CLI's local SQLite database for schema issues and repair them.\n\n" +
      "This is useful when upgrading from older CLI versions or if the database\n" +
      "becomes inconsistent due to interrupted operations.\n\n" +
      "The command performs non-destructive repairs only - it adds missing tables\n" +
      "and columns but never deletes data.\n\n" +
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
  func(this: SentryContext, flags: FixFlags): void {
    const { stdout, stderr, process: proc } = this;
    const dbPath = getDbPath();

    stdout.write(`Database: ${dbPath}\n`);
    stdout.write(`Expected schema version: ${CURRENT_SCHEMA_VERSION}\n\n`);

    const db = getRawDatabase();
    const issues = getSchemaIssues(db);

    if (issues.length === 0) {
      stdout.write("No issues found. Database schema is up to date.\n");
      return;
    }

    stdout.write(`Found ${issues.length} issue(s):\n`);
    for (const issue of issues) {
      stdout.write(`  - ${formatIssue(issue)}\n`);
    }
    stdout.write("\n");

    if (flags["dry-run"]) {
      stdout.write("Run 'sentry cli fix' to apply fixes.\n");
      return;
    }

    stdout.write("Repairing...\n");
    const { fixed, failed } = repairSchema(db);

    for (const fix of fixed) {
      stdout.write(`  + ${fix}\n`);
    }

    if (failed.length > 0) {
      stderr.write("\nSome repairs failed:\n");
      for (const fail of failed) {
        stderr.write(`  ! ${fail}\n`);
      }
      stderr.write(
        `\nTry deleting the database and restarting: rm ${dbPath}\n`
      );
      proc.exitCode = 1;
      return;
    }

    stdout.write("\nDatabase repaired successfully.\n");
  },
});
