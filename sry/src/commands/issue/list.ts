/**
 * sry issue list
 *
 * List issues from a Sentry project.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { listIssues } from "../../lib/api-client.js";
import { getDefaultOrganization, getDefaultProject } from "../../lib/config.js";
import { divider, formatIssueRow } from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import type { SentryIssue } from "../../types/index.js";

type ListFlags = {
  readonly org?: string;
  readonly project?: string;
  readonly query?: string;
  readonly limit: number;
  readonly sort: "date" | "new" | "priority" | "freq" | "user";
  readonly json: boolean;
};

type SortValue = "date" | "new" | "priority" | "freq" | "user";

const VALID_SORT_VALUES: SortValue[] = [
  "date",
  "new",
  "priority",
  "freq",
  "user",
];

function parseSort(value: string): SortValue {
  if (!VALID_SORT_VALUES.includes(value as SortValue)) {
    throw new Error(
      `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
    );
  }
  return value as SortValue;
}

/**
 * Write issue list header
 */
function writeListHeader(
  stdout: NodeJS.WriteStream,
  org: string,
  project: string,
  count: number
): void {
  stdout.write(`Issues in ${org}/${project} (showing ${count}):\n\n`);
  stdout.write("  STATUS  SHORT ID         COUNT  TITLE\n");
  stdout.write(`${divider(80)}\n`);
}

/**
 * Write issue list rows
 */
function writeIssueRows(
  stdout: NodeJS.WriteStream,
  issues: SentryIssue[]
): void {
  for (const issue of issues) {
    stdout.write(`${formatIssueRow(issue)}\n`);
  }
}

/**
 * Write list footer with tip
 */
function writeListFooter(stdout: NodeJS.WriteStream): void {
  stdout.write(
    "\nTip: Use 'sry issue get <SHORT_ID>' to view issue details.\n"
  );
}

export const listCommand = buildCommand({
  docs: {
    brief: "List issues in a project",
    fullDescription:
      "List issues from a Sentry project. Use --org and --project to specify " +
      "the target, or set defaults with 'sry config set'.",
  },
  parameters: {
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief: "Organization slug",
        optional: true,
      },
      project: {
        kind: "parsed",
        parse: String,
        brief: "Project slug",
        optional: true,
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Search query (Sentry search syntax)",
        optional: true,
      },
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of issues to return",
        default: 25,
      },
      sort: {
        kind: "parsed",
        parse: parseSort,
        brief: "Sort by: date, new, priority, freq, user",
        default: "date" as const,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: SryContext, flags: ListFlags): Promise<void> {
    const { process } = this;
    const { stdout, stderr } = process;

    // Resolve organization and project
    const org = flags.org ?? getDefaultOrganization();
    const project = flags.project ?? getDefaultProject();

    if (!(org && project)) {
      stderr.write(
        "Error: Organization and project are required.\n\n" +
          "Please specify them using:\n" +
          "  sry issue list --org <org-slug> --project <project-slug>\n\n" +
          "Or set defaults:\n" +
          "  sry config set defaults.organization <org-slug>\n" +
          "  sry config set defaults.project <project-slug>\n"
      );
      process.exitCode = 1;
      return;
    }

    try {
      const issues = await listIssues(org, project, {
        query: flags.query,
        limit: flags.limit,
        sort: flags.sort,
      });

      if (flags.json) {
        writeJson(stdout, issues);
        return;
      }

      if (issues.length === 0) {
        stdout.write("No issues found.\n");
        return;
      }

      writeListHeader(stdout, org, project, issues.length);
      writeIssueRows(stdout, issues);
      writeListFooter(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Error listing issues: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
