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
  listIssuesPaginated,
  listProjects,
} from "../../lib/api-client.js";
import {
  type ParsedOrgProject,
  parseOrgProjectArg,
} from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import {
  clearPaginationCursor,
  escapeContextKeyValue,
  resolveOrgCursor,
  setPaginationCursor,
} from "../../lib/db/pagination.js";
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
  buildListLimitFlag,
  LIST_BASE_ALIASES,
  LIST_JSON_FLAG,
  LIST_TARGET_POSITIONAL,
} from "../../lib/list-command.js";
import {
  dispatchOrgScopedList,
  type ListCommandMeta,
} from "../../lib/org-list.js";
import {
  type ResolvedTarget,
  resolveAllTargets,
} from "../../lib/resolve-target.js";
import { getApiBaseUrl } from "../../lib/sentry-client.js";
import type {
  ProjectAliasEntry,
  SentryIssue,
  Writer,
} from "../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "issue-list";

type ListFlags = {
  readonly query?: string;
  readonly limit: number;
  readonly sort: "date" | "new" | "freq" | "user";
  readonly json: boolean;
  readonly cursor?: string;
};

type SortValue = "date" | "new" | "freq" | "user";

const VALID_SORT_VALUES: SortValue[] = ["date", "new", "freq", "user"];

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry issue list <org>/<project>";

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
  | { success: false; error: Error };

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
 * @returns Success with issues, or failure with the original error preserved
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

    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/** Options for {@link handleOrgAllIssues}. */
type OrgAllIssuesOptions = {
  stdout: Writer;
  org: string;
  flags: ListFlags;
  setContext: (orgs: string[], projects: string[]) => void;
};

/**
 * Handle org-all mode for issues: cursor-paginated listing of all issues in an org.
 *
 * Uses a sort+query-aware context key so cursors from different searches are
 * never accidentally reused.
 */
async function handleOrgAllIssues(options: OrgAllIssuesOptions): Promise<void> {
  const { stdout, org, flags, setContext } = options;
  // Encode sort + query in context key so cursors from different searches don't collide.
  const escapedQuery = flags.query
    ? escapeContextKeyValue(flags.query)
    : undefined;
  const contextKey = `host:${getApiBaseUrl()}|type:org:${org}|sort:${flags.sort}${escapedQuery ? `|q:${escapedQuery}` : ""}`;
  const cursor = resolveOrgCursor(flags.cursor, PAGINATION_KEY, contextKey);

  setContext([org], []);

  const response = await listIssuesPaginated(org, "", {
    query: flags.query,
    cursor,
    perPage: flags.limit,
    sort: flags.sort,
  });

  if (response.nextCursor) {
    setPaginationCursor(PAGINATION_KEY, contextKey, response.nextCursor);
  } else {
    clearPaginationCursor(PAGINATION_KEY, contextKey);
  }

  const hasMore = !!response.nextCursor;

  if (flags.json) {
    const output = hasMore
      ? { data: response.data, nextCursor: response.nextCursor, hasMore: true }
      : { data: response.data, hasMore: false };
    writeJson(stdout, output);
    return;
  }

  if (response.data.length === 0) {
    if (hasMore) {
      stdout.write(
        `No issues on this page. Try the next page: sentry issue list ${org}/ -c last\n`
      );
    } else {
      stdout.write(`No issues found in organization '${org}'.\n`);
    }
    return;
  }

  // isMultiProject=true: org-all shows issues from every project, so the ALIAS
  // column is needed to identify which project each issue belongs to.
  writeListHeader(stdout, `Issues in ${org}`, true);
  const termWidth = process.stdout.columns || 80;
  const issuesWithOpts = response.data.map((issue) => ({
    issue,
    formatOptions: {
      projectSlug: issue.project?.slug ?? "",
      isMultiProject: true,
    },
  }));
  writeIssueRows(stdout, issuesWithOpts, termWidth);

  if (hasMore) {
    stdout.write(`\nShowing ${response.data.length} issues (more available)\n`);
    stdout.write(`Next page: sentry issue list ${org}/ -c last\n`);
  } else {
    stdout.write(`\nShowing ${response.data.length} issues\n`);
  }
}

/** Options for {@link handleResolvedTargets}. */
type ResolvedTargetsOptions = {
  stdout: Writer;
  stderr: Writer;
  parsed: ReturnType<typeof parseOrgProjectArg>;
  flags: ListFlags;
  cwd: string;
  setContext: (orgs: string[], projects: string[]) => void;
};

/**
 * Handle auto-detect, explicit, and project-search modes.
 *
 * All three share the same flow: resolve targets → fetch issues in parallel →
 * merge results → display. Only the target resolution step differs.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inherent multi-target issue resolution, error handling, and display logic
async function handleResolvedTargets(
  options: ResolvedTargetsOptions
): Promise<void> {
  const { stdout, stderr, parsed, flags, cwd, setContext } = options;

  const { targets, footer, skippedSelfHosted, detectedDsns } =
    await resolveTargetsFromParsedArg(parsed, cwd);

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

  const results = await Promise.all(
    targets.map((t) =>
      fetchIssuesForTarget(t, {
        query: flags.query,
        limit: flags.limit,
        sort: flags.sort,
      })
    )
  );

  const validResults: IssueListResult[] = [];
  const failures: Error[] = [];

  for (const result of results) {
    if (result.success) {
      validResults.push(result.data);
    } else {
      failures.push(result.error);
    }
  }

  if (validResults.length === 0 && failures.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by failures.length > 0
    const first = failures[0]!;
    const prefix = `Failed to fetch issues from ${targets.length} project(s)`;

    // Propagate ApiError so telemetry sees the original status code
    if (first instanceof ApiError) {
      throw new ApiError(
        `${prefix}: ${first.message}`,
        first.status,
        first.detail,
        first.endpoint
      );
    }

    throw new Error(`${prefix}.\n${first.message}`);
  }

  const isMultiProject = validResults.length > 1;
  const isSingleProject = validResults.length === 1;
  const firstTarget = validResults[0]?.target;

  const { aliasMap, entries } = isMultiProject
    ? buildProjectAliasMap(validResults)
    : { aliasMap: new Map<string, string>(), entries: {} };

  if (isMultiProject) {
    const fingerprint = createDsnFingerprint(detectedDsns ?? []);
    await setProjectAliases(entries, fingerprint);
  } else {
    await clearProjectAliases();
  }

  const issuesWithOptions = attachFormatOptions(
    validResults,
    aliasMap,
    isMultiProject
  );

  issuesWithOptions.sort((a, b) => getComparator(flags.sort)(a.issue, b.issue));

  if (flags.json) {
    const allIssues = issuesWithOptions.map((i) => i.issue);
    if (failures.length > 0) {
      writeJson(stdout, {
        issues: allIssues,
        errors: failures.map((e) =>
          e instanceof ApiError
            ? { status: e.status, message: e.message }
            : { message: e.message }
        ),
      });
    } else {
      writeJson(stdout, allIssues);
    }
    return;
  }

  if (failures.length > 0) {
    stderr.write(
      muted(
        `\nNote: Failed to fetch issues from ${failures.length} project(s). Showing results from ${validResults.length} project(s).\n`
      )
    );
  }

  if (issuesWithOptions.length === 0) {
    stdout.write("No issues found.\n");
    if (footer) {
      stdout.write(`\n${footer}\n`);
    }
    return;
  }

  const title =
    isSingleProject && firstTarget
      ? `Issues in ${firstTarget.orgDisplay}/${firstTarget.projectDisplay}`
      : `Issues from ${validResults.length} projects`;

  writeListHeader(stdout, title, isMultiProject);

  const termWidth = process.stdout.columns || 80;
  writeIssueRows(stdout, issuesWithOptions, termWidth);

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
}

/** Metadata for the shared dispatch infrastructure. */
const issueListMeta: ListCommandMeta = {
  paginationKey: PAGINATION_KEY,
  entityName: "issue",
  entityPlural: "issues",
  commandPrefix: "sentry issue list",
};

export const listCommand = buildCommand({
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
  parameters: {
    positional: LIST_TARGET_POSITIONAL,
    flags: {
      query: {
        kind: "parsed",
        parse: String,
        brief: "Search query (Sentry search syntax)",
        optional: true,
      },
      limit: buildListLimitFlag("issues", "10"),
      sort: {
        kind: "parsed",
        parse: parseSort,
        brief: "Sort by: date, new, freq, user",
        default: "date" as const,
      },
      json: LIST_JSON_FLAG,
      cursor: {
        kind: "parsed",
        parse: String,
        // Issue-specific cursor brief: cursor only works in <org>/ mode
        brief:
          'Pagination cursor — only for <org>/ mode (use "last" to continue)',
        optional: true,
      },
    },
    aliases: { ...LIST_BASE_ALIASES, q: "query", s: "sort" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    const { stdout, stderr, cwd, setContext } = this;

    const parsed = parseOrgProjectArg(target);

    // Shared handler for modes that resolve targets (auto-detect, explicit, project-search).
    // Each mode's narrowed ParsedVariant<K> is a subtype of ParsedOrgProject,
    // so passing it to handleResolvedTargets (which accepts the full union) is safe.
    const resolveAndHandle = (p: ParsedOrgProject) =>
      handleResolvedTargets({
        stdout,
        stderr,
        parsed: p,
        flags,
        cwd,
        setContext,
      });

    await dispatchOrgScopedList({
      config: issueListMeta,
      stdout,
      cwd,
      flags,
      parsed,
      overrides: {
        "auto-detect": resolveAndHandle,
        explicit: resolveAndHandle,
        "project-search": resolveAndHandle,
        "org-all": (p) =>
          handleOrgAllIssues({ stdout, org: p.org, flags, setContext }),
      },
    });
  },
});
