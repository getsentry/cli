/**
 * sentry issue list
 *
 * List issues from Sentry projects.
 * Supports monorepos with multiple detected projects.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { buildOrgAwareAliases } from "../../lib/alias.js";
import { listIssues } from "../../lib/api-client.js";
import {
  clearProjectAliases,
  setProjectAliases,
} from "../../lib/db/project-aliases.js";
import { createDsnFingerprint } from "../../lib/dsn/index.js";
import { AuthError, ContextError } from "../../lib/errors.js";
import {
  divider,
  type FormatShortIdOptions,
  formatIssueListHeader,
  formatIssueRow,
  muted,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  type ResolvedTarget,
  resolveAllTargets,
} from "../../lib/resolve-target.js";
import type {
  ProjectAliasEntry,
  SentryIssue,
  Writer,
} from "../../types/index.js";

type ListFlags = {
  readonly org?: string;
  readonly project?: string;
  readonly query?: string;
  readonly limit: number;
  readonly sort: "date" | "new" | "freq" | "user";
  readonly json: boolean;
};

type SortValue = "date" | "new" | "freq" | "user";

const VALID_SORT_VALUES: SortValue[] = ["date", "new", "freq", "user"];

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
 *
 * @param stdout - Output writer
 * @param title - Section title
 * @param isMultiProject - Whether to show ALIAS column for multi-project mode
 */
function writeListHeader(
  stdout: Writer,
  title: string,
  isMultiProject = false
): void {
  stdout.write(`${title}:\n\n`);
  stdout.write(muted(`${formatIssueListHeader(isMultiProject)}\n`));
  stdout.write(`${divider(isMultiProject ? 96 : 80)}\n`);
}

/** Issue with formatting options attached */
type IssueWithOptions = {
  issue: SentryIssue;
  formatOptions: FormatShortIdOptions;
};

/**
 * Write formatted issue rows to stdout.
 */
function writeIssueRows(
  stdout: Writer,
  issues: IssueWithOptions[],
  termWidth: number
): void {
  for (const { issue, formatOptions } of issues) {
    stdout.write(`${formatIssueRow(issue, termWidth, formatOptions)}\n`);
  }
}

/**
 * Write footer with usage tip.
 *
 * @param stdout - Output writer
 * @param mode - Display mode: 'single' (one project), 'multi' (multiple projects), or 'none'
 */
function writeListFooter(
  stdout: Writer,
  mode: "single" | "multi" | "none"
): void {
  switch (mode) {
    case "single":
      stdout.write(
        "\nTip: Use 'sentry issue view <ID>' to view details (bold part works as shorthand).\n"
      );
      break;
    case "multi":
      stdout.write(
        "\nTip: Use 'sentry issue view <ALIAS>' to view details (see ALIAS column).\n"
      );
      break;
    default:
      stdout.write(
        "\nTip: Use 'sentry issue view <SHORT_ID>' to view issue details.\n"
      );
  }
}

/** Issue list with target context */
type IssueListResult = {
  target: ResolvedTarget;
  issues: SentryIssue[];
};

/** Result of building project aliases */
type AliasMapResult = {
  aliasMap: Map<string, string>;
  entries: Record<string, ProjectAliasEntry>;
};

/**
 * Build project alias map using shortest unique prefix of project slug.
 * Handles cross-org slug collisions by prefixing with org abbreviation.
 * Strips common word prefix before computing unique prefixes for cleaner aliases.
 *
 * Single org examples:
 *   spotlight-electron, spotlight-website, spotlight → e, w, s
 *   frontend, functions, backend → fr, fu, b
 *
 * Cross-org collision example:
 *   org1:dashboard, org2:dashboard → o1:d, o2:d
 */
function buildProjectAliasMap(results: IssueListResult[]): AliasMapResult {
  const entries: Record<string, ProjectAliasEntry> = {};

  // Build org-aware aliases that handle cross-org collisions
  const pairs = results.map((r) => ({
    org: r.target.org,
    project: r.target.project,
  }));
  const { aliasMap } = buildOrgAwareAliases(pairs);

  // Build entries record for storage
  for (const result of results) {
    const key = `${result.target.org}:${result.target.project}`;
    const alias = aliasMap.get(key);
    if (alias) {
      entries[alias] = {
        orgSlug: result.target.org,
        projectSlug: result.target.project,
      };
    }
  }

  return { aliasMap, entries };
}

/**
 * Attach formatting options to each issue based on alias map.
 *
 * @param results - Issue list results with targets
 * @param aliasMap - Map from "org:project" to alias
 * @param isMultiProject - Whether in multi-project mode (shows ALIAS column)
 */
function attachFormatOptions(
  results: IssueListResult[],
  aliasMap: Map<string, string>,
  isMultiProject: boolean
): IssueWithOptions[] {
  return results.flatMap((result) =>
    result.issues.map((issue) => {
      const key = `${result.target.org}:${result.target.project}`;
      const alias = aliasMap.get(key);
      return {
        issue,
        formatOptions: {
          projectSlug: result.target.project,
          projectAlias: alias,
          isMultiProject,
        },
      };
    })
  );
}

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
        brief: "Sort by: date, new, freq, user",
        default: "date" as const,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: command entry point with inherent complexity
  async func(this: SentryContext, flags: ListFlags): Promise<void> {
    const { stdout, cwd, setContext } = this;

    // Resolve targets (may find multiple in monorepos)
    const { targets, footer, skippedSelfHosted, detectedDsns } =
      await resolveAllTargets({
        org: flags.org,
        project: flags.project,
        cwd,
        usageHint: USAGE_HINT,
      });

    // Set telemetry context (single project mode gets both org and project)
    const telemetryTarget = targets[0];
    if (targets.length === 1 && telemetryTarget) {
      setContext(telemetryTarget.org, telemetryTarget.project);
    } else if (targets.length > 1 && telemetryTarget) {
      // Multi-project: set org if all targets share the same org
      const orgs = new Set(targets.map((t) => t.org));
      if (orgs.size === 1) {
        setContext(telemetryTarget.org);
      }
    }

    if (targets.length === 0) {
      if (skippedSelfHosted) {
        throw new ContextError(
          "Organization and project",
          `${USAGE_HINT}\n\n` +
            `Note: Found ${skippedSelfHosted} DSN(s) that could not be resolved.\n` +
            "You may not have access to these projects, or you can specify --org and --project explicitly."
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

    // Determine display mode
    const isMultiProject = validResults.length > 1;
    const isSingleProject = validResults.length === 1;
    const firstTarget = validResults[0]?.target;

    // Build project alias map and cache it for multi-project mode
    const { aliasMap, entries } = isMultiProject
      ? buildProjectAliasMap(validResults)
      : {
          aliasMap: new Map<string, string>(),
          entries: {},
        };

    if (isMultiProject) {
      const fingerprint = createDsnFingerprint(detectedDsns ?? []);
      await setProjectAliases(entries, fingerprint);
    } else {
      await clearProjectAliases();
    }

    // Attach formatting options to each issue
    const issuesWithOptions = attachFormatOptions(
      validResults,
      aliasMap,
      isMultiProject
    );

    // Sort by user preference
    issuesWithOptions.sort((a, b) =>
      getComparator(flags.sort)(a.issue, b.issue)
    );

    // JSON output
    if (flags.json) {
      const allIssues = issuesWithOptions.map((i) => i.issue);
      writeJson(stdout, allIssues);
      return;
    }

    if (issuesWithOptions.length === 0) {
      stdout.write("No issues found.\n");
      if (footer) {
        stdout.write(`\n${footer}\n`);
      }
      return;
    }

    // Header depends on single vs multiple projects
    const title =
      isSingleProject && firstTarget
        ? `Issues in ${firstTarget.orgDisplay}/${firstTarget.projectDisplay}`
        : `Issues from ${validResults.length} projects`;

    writeListHeader(stdout, title, isMultiProject);

    const termWidth = process.stdout.columns || 80;
    writeIssueRows(stdout, issuesWithOptions, termWidth);

    // Footer mode
    let footerMode: "single" | "multi" | "none" = "none";
    if (isMultiProject) {
      footerMode = "multi";
    } else if (isSingleProject) {
      footerMode = "single";
    }
    writeListFooter(stdout, footerMode);

    if (footer) {
      stdout.write(`\n${footer}\n`);
    }
  },
});
