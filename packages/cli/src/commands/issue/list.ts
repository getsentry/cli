/**
 * sentry issue list
 *
 * List issues from Sentry projects.
 * Supports monorepos with multiple detected projects.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { listIssues } from "../../lib/api-client.js";
import { AuthError, ContextError } from "../../lib/errors.js";
import {
  divider,
  formatIssueListHeader,
  formatIssueRow,
  muted,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  type ResolvedTarget,
  resolveAllTargets,
} from "../../lib/resolve-target.js";
import type { SentryIssue, Writer } from "../../types/index.js";

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

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry issue list --org <org> --project <project>";

function parseSort(value: string): SortValue {
  if (!VALID_SORT_VALUES.includes(value as SortValue)) {
    throw new Error(
      `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
    );
  }
  return value as SortValue;
}

/**
 * Write the issue list header with column titles.
 */
function writeListHeader(stdout: Writer, title: string): void {
  stdout.write(`${title}:\n\n`);
  stdout.write(muted(`${formatIssueListHeader()}\n`));
  stdout.write(`${divider(80)}\n`);
}

/**
 * Write formatted issue rows to stdout.
 */
function writeIssueRows(
  stdout: Writer,
  issues: SentryIssue[],
  termWidth: number
): void {
  for (const issue of issues) {
    stdout.write(`${formatIssueRow(issue, termWidth)}\n`);
  }
}

/**
 * Write footer with usage tip.
 */
function writeListFooter(stdout: Writer): void {
  stdout.write(
    "\nTip: Use 'sentry issue get <SHORT_ID>' to view issue details.\n"
  );
}

/** Issue list with target context */
type IssueListResult = {
  target: ResolvedTarget;
  issues: SentryIssue[];
};

/**
 * Compare two optional date strings (most recent first).
 */
function compareDates(a: string | undefined, b: string | undefined): number {
  const dateA = a ? new Date(a).getTime() : 0;
  const dateB = b ? new Date(b).getTime() : 0;
  return dateB - dateA;
}

/**
 * Get comparator function for the specified sort option.
 *
 * @param sort - Sort option from CLI flags
 * @returns Comparator function for Array.sort()
 */
function getComparator(
  sort: SortValue
): (a: SentryIssue, b: SentryIssue) => number {
  switch (sort) {
    case "date":
      return (a, b) => compareDates(a.lastSeen, b.lastSeen);
    case "new":
      return (a, b) => compareDates(a.firstSeen, b.firstSeen);
    case "freq":
      return (a, b) =>
        Number.parseInt(b.count ?? "0", 10) -
        Number.parseInt(a.count ?? "0", 10);
    case "user":
      return (a, b) => (b.userCount ?? 0) - (a.userCount ?? 0);
    default:
      return (a, b) => compareDates(a.lastSeen, b.lastSeen);
  }
}

/**
 * Fetch issues for a single target project.
 *
 * @param target - Resolved org/project target
 * @param options - Query options (query, limit, sort)
 * @returns Issues with target context, or null if fetch failed (except auth errors)
 * @throws {AuthError} When user is not authenticated
 */
async function fetchIssuesForTarget(
  target: ResolvedTarget,
  options: { query?: string; limit: number; sort: SortValue }
): Promise<IssueListResult | null> {
  try {
    const issues = await listIssues(target.org, target.project, options);
    return { target, issues };
  } catch (error) {
    // Auth errors should propagate - user needs to authenticate
    if (error instanceof AuthError) {
      throw error;
    }
    // Other errors (network, permissions) - skip this target silently
    return null;
  }
}

export const listCommand = buildCommand({
  docs: {
    brief: "List issues in a project",
    fullDescription:
      "List issues from Sentry projects. Use --org and --project to specify " +
      "the target, or set defaults with 'sentry config set'.\n\n" +
      "In monorepos with multiple Sentry projects, shows issues from all detected projects.",
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
        // Stricli requires string defaults (raw CLI input); numberParser converts to number
        default: "10",
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
  async func(this: SentryContext, flags: ListFlags): Promise<void> {
    const { stdout, cwd } = this;

    // Resolve targets (may find multiple in monorepos)
    const { targets, footer, skippedSelfHosted } = await resolveAllTargets({
      org: flags.org,
      project: flags.project,
      cwd,
      usageHint: USAGE_HINT,
    });

    if (targets.length === 0) {
      if (skippedSelfHosted) {
        throw new ContextError(
          "Organization and project",
          `${USAGE_HINT}\n\n` +
            `Note: Found ${skippedSelfHosted} self-hosted DSN(s) that cannot be resolved automatically.\n` +
            "Self-hosted Sentry instances require explicit --org and --project flags."
        );
      }
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    // Fetch issues from all targets in parallel
    const results = await Promise.all(
      targets.map((target) =>
        fetchIssuesForTarget(target, {
          query: flags.query,
          limit: flags.limit,
          sort: flags.sort,
        })
      )
    );

    // Filter out failed fetches
    const validResults = results.filter(
      (r): r is IssueListResult => r !== null
    );

    if (validResults.length === 0) {
      throw new Error(
        `Failed to fetch issues from ${targets.length} project(s). ` +
          "Check your network connection and project permissions."
      );
    }

    // Merge all issues from all projects and sort by user preference
    const allIssues = validResults.flatMap((r) => r.issues);
    allIssues.sort(getComparator(flags.sort));

    // JSON output
    if (flags.json) {
      writeJson(stdout, allIssues);
      return;
    }

    if (allIssues.length === 0) {
      stdout.write("No issues found.\n");
      if (footer) {
        stdout.write(`\n${footer}\n`);
      }
      return;
    }

    // Header depends on single vs multiple projects
    const firstTarget = validResults[0]?.target;
    const title =
      validResults.length === 1 && firstTarget
        ? `Issues in ${firstTarget.orgDisplay}/${firstTarget.projectDisplay}`
        : `Issues from ${validResults.length} projects`;

    writeListHeader(stdout, title);

    const termWidth = process.stdout.columns || 80;
    writeIssueRows(stdout, allIssues, termWidth);
    writeListFooter(stdout);

    if (footer) {
      stdout.write(`\n${footer}\n`);
    }
  },
});
