/**
 * sentry issue list
 *
 * List issues from Sentry projects.
 * Supports monorepos with multiple detected projects.
 */

import type { SentryContext } from "../../context.js";
import { buildOrgAwareAliases } from "../../lib/alias.js";
import {
  findProjectsBySlug,
  listIssues,
  listProjects,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import {
  clearProjectAliases,
  setProjectAliases,
} from "../../lib/db/project-aliases.js";
import { createDsnFingerprint } from "../../lib/dsn/index.js";
import { ApiError, AuthError, ContextError } from "../../lib/errors.js";
import {
  divider,
  type FormatShortIdOptions,
  formatIssueListHeader,
  formatIssueRow,
  muted,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  listCommand as buildListCommand,
  type ListResult,
} from "../../lib/list-helpers.js";
import {
  type ResolvedTarget,
  resolveAllTargets,
} from "../../lib/resolve-target.js";
import type {
  ProjectAliasEntry,
  SentryIssue,
  Writer,
} from "../../types/index.js";

type SortValue = "date" | "new" | "freq" | "user";

const VALID_SORT_VALUES: SortValue[] = ["date", "new", "freq", "user"];

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry issue list <org>/<project>";

/** Error type classification for fetch failures */
type FetchErrorType = "permission" | "network" | "unknown";

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
 *   org1/dashboard, org2/dashboard → o1/d, o2/d
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
    const key = `${result.target.org}/${result.target.project}`;
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
      const key = `${result.target.org}/${result.target.project}`;
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

type FetchResult =
  | { success: true; data: IssueListResult }
  | { success: false; errorType: FetchErrorType };

/** Result of resolving targets from parsed argument */
type TargetResolutionResult = {
  targets: ResolvedTarget[];
  footer?: string;
  skippedSelfHosted?: number;
  detectedDsns?: import("../../lib/dsn/index.js").DetectedDsn[];
};

/**
 * Resolve targets based on parsed org/project argument.
 *
 * Handles all four cases:
 * - auto-detect: Use DSN detection / config defaults
 * - explicit: Single org/project target
 * - org-all: All projects in specified org
 * - project-search: Find project across all orgs
 */
async function resolveTargetsFromParsedArg(
  parsed: ReturnType<typeof parseOrgProjectArg>,
  cwd: string
): Promise<TargetResolutionResult> {
  switch (parsed.type) {
    case "auto-detect":
      // Use existing resolution logic (DSN detection, config defaults)
      return resolveAllTargets({ cwd, usageHint: USAGE_HINT });

    case "explicit":
      // Single explicit target
      return {
        targets: [
          {
            org: parsed.org,
            project: parsed.project,
            orgDisplay: parsed.org,
            projectDisplay: parsed.project,
          },
        ],
      };

    case "org-all": {
      // List all projects in the specified org
      const projects = await listProjects(parsed.org);
      const targets: ResolvedTarget[] = projects.map((p) => ({
        org: parsed.org,
        project: p.slug,
        orgDisplay: parsed.org,
        projectDisplay: p.name,
      }));

      if (targets.length === 0) {
        throw new ContextError(
          "Projects",
          `No projects found in organization '${parsed.org}'.`
        );
      }

      return {
        targets,
        footer:
          targets.length > 1
            ? `Showing issues from ${targets.length} projects in ${parsed.org}`
            : undefined,
      };
    }

    case "project-search": {
      // Find project across all orgs
      const matches = await findProjectsBySlug(parsed.projectSlug);

      if (matches.length === 0) {
        throw new ContextError(
          "Project",
          `No project '${parsed.projectSlug}' found in any accessible organization.\n\n` +
            `Try: sentry issue list <org>/${parsed.projectSlug}`
        );
      }

      const targets: ResolvedTarget[] = matches.map((m) => ({
        org: m.orgSlug,
        project: m.slug,
        orgDisplay: m.orgSlug,
        projectDisplay: m.name,
      }));

      return {
        targets,
        footer:
          matches.length > 1
            ? `Found '${parsed.projectSlug}' in ${matches.length} organizations`
            : undefined,
      };
    }

    default: {
      // TypeScript exhaustiveness check - this should never be reached
      const _exhaustiveCheck: never = parsed;
      throw new Error(`Unexpected parsed type: ${_exhaustiveCheck}`);
    }
  }
}

/**
 * Fetch issues for a single target project.
 *
 * @param target - Resolved org/project target
 * @param options - Query options (query, limit, sort)
 * @returns Success with issues, or failure with error type classification
 * @throws {AuthError} When user is not authenticated
 */
async function fetchIssuesForTarget(
  target: ResolvedTarget,
  options: { query?: string; limit: number; sort: SortValue }
): Promise<FetchResult> {
  try {
    const issues = await listIssues(target.org, target.project, options);
    return { success: true, data: { target, issues } };
  } catch (error) {
    // Auth errors should propagate - user needs to authenticate
    if (error instanceof AuthError) {
      throw error;
    }
    // Classify error type for better user messaging
    // 401/403 are permission errors
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return { success: false, errorType: "permission" };
    }
    // Network errors (fetch failures, timeouts)
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return { success: false, errorType: "network" };
    }
    return { success: false, errorType: "unknown" };
  }
}

/**
 * Pick the footer tip text based on display mode.
 */
function pickFooterTip(
  isMultiProject: boolean,
  hasSingleProject: boolean
): string {
  if (isMultiProject) {
    return "Tip: Use 'sentry issue view <ALIAS>' to view details (see ALIAS column).";
  }
  if (hasSingleProject) {
    return "Tip: Use 'sentry issue view <ID>' to view details (bold part works as shorthand).";
  }
  return "Tip: Use 'sentry issue view <SHORT_ID>' to view issue details.";
}

export const listCommand = buildListCommand<IssueWithOptions>({
  docs: {
    brief: "List issues in a project",
    fullDescription:
      "List issues from Sentry projects.\n\n" +
      "Target specification:\n" +
      "  sentry issue list               # auto-detect from DSN or config\n" +
      "  sentry issue list <org>/<proj>  # explicit org and project\n" +
      "  sentry issue list <org>/        # all projects in org\n" +
      "  sentry issue list <project>     # find project across all orgs\n\n" +
      "In monorepos with multiple Sentry projects, shows issues from all detected projects.",
  },
  limit: 10,
  features: {
    query: true,
    sort: VALID_SORT_VALUES,
  },
  positional: {
    placeholder: "target",
    brief: "Target: <org>/<project>, <org>/, or <project>",
    optional: true,
  },
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: command entry point with inherent complexity
  async fetch(this: SentryContext, flags, target) {
    const { cwd, setContext } = this;

    // Parse positional argument to determine resolution strategy
    const parsed = parseOrgProjectArg(target);

    // Resolve targets based on parsed argument type
    const { targets, footer, skippedSelfHosted, detectedDsns } =
      await resolveTargetsFromParsedArg(parsed, cwd);

    // Set telemetry context with unique orgs and projects
    const orgs = [...new Set(targets.map((t) => t.org))];
    const projects = [...new Set(targets.map((t) => t.project))];
    setContext(orgs, projects);

    if (targets.length === 0) {
      if (skippedSelfHosted) {
        throw new ContextError(
          "Organization and project",
          `${USAGE_HINT}\n\n` +
            `Note: Found ${skippedSelfHosted} DSN(s) that could not be resolved.\n` +
            "You may not have access to these projects, or you can specify the target explicitly."
        );
      }
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    // Fetch issues from all targets in parallel
    const fetchResults = await Promise.all(
      targets.map((t) =>
        fetchIssuesForTarget(t, {
          query: flags.query,
          limit: flags.limit,
          sort: (flags.sort as SortValue | undefined) ?? "date",
        })
      )
    );

    // Separate successful fetches from failures
    const validResults: IssueListResult[] = [];
    const errorTypes = new Set<FetchErrorType>();

    for (const result of fetchResults) {
      if (result.success) {
        validResults.push(result.data);
      } else {
        errorTypes.add(result.errorType);
      }
    }

    if (validResults.length === 0) {
      // Build error message based on what types of errors we saw
      if (errorTypes.has("permission")) {
        throw new Error(
          `Failed to fetch issues from ${targets.length} project(s).\n` +
            "You don't have permission to access these projects.\n\n" +
            "Try running 'sentry auth status' to verify your authentication."
        );
      }
      if (errorTypes.has("network")) {
        throw new Error(
          `Failed to fetch issues from ${targets.length} project(s).\n` +
            "Network connection failed. Check your internet connection."
        );
      }
      throw new Error(
        `Failed to fetch issues from ${targets.length} project(s).`
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
    const sortValue = (flags.sort as SortValue | undefined) ?? "date";
    issuesWithOptions.sort((a, b) =>
      getComparator(sortValue)(a.issue, b.issue)
    );

    // Build title for the header line (written by render)
    // Colon suffix matches original output: "Issues in org/project:"
    const header =
      isSingleProject && firstTarget
        ? `Issues in ${firstTarget.orgDisplay}/${firstTarget.projectDisplay}:`
        : `Issues from ${validResults.length} projects:`;

    return {
      items: issuesWithOptions,
      footer,
      skippedSelfHosted,
      header,
    } satisfies ListResult<IssueWithOptions>;
  },
  render(items, stdout, _flags) {
    const isMultiProject = items[0]?.formatOptions.isMultiProject ?? false;
    // The factory already wrote the header title line; write only column headers + divider
    stdout.write("\n");
    stdout.write(muted(`${formatIssueListHeader(isMultiProject)}\n`));
    stdout.write(`${divider(isMultiProject ? 96 : 80)}\n`);
    const termWidth = process.stdout.columns || 80;
    writeIssueRows(stdout, items, termWidth);
  },
  formatJson(result, stdout) {
    writeJson(
      stdout,
      result.items.map((i) => i.issue)
    );
  },
  footerTip(result) {
    const isMultiProject =
      result.items[0]?.formatOptions.isMultiProject ?? false;
    const isSingleProject = result.items.length > 0 && !isMultiProject;
    return pickFooterTip(isMultiProject, isSingleProject);
  },
  emptyMessage: "No issues found.",
});
