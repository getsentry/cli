/**
 * sentry issue list
 *
 * List issues from Sentry projects.
 * Supports monorepos with multiple detected projects.
 */

import type { SentryContext } from "../../context.js";
import { buildOrgAwareAliases } from "../../lib/alias.js";
import {
  API_MAX_PER_PAGE,
  findProjectsBySlug,
  type IssuesPage,
  listIssuesAllPages,
  listIssuesPaginated,
  listProjects,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
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
import {
  ApiError,
  AuthError,
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../lib/errors.js";
import {
  type IssueTableRow,
  muted,
  writeIssueTable,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  buildListCommand,
  buildListLimitFlag,
  LIST_BASE_ALIASES,
  LIST_JSON_FLAG,
  LIST_TARGET_POSITIONAL,
  targetPatternExplanation,
} from "../../lib/list-command.js";
import {
  dispatchOrgScopedList,
  type ListCommandMeta,
  type ModeHandler,
} from "../../lib/org-list.js";
import { withProgress } from "../../lib/polling.js";
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
  readonly period: string;
  readonly json: boolean;
  readonly cursor?: string;
};

/** @internal */ export type SortValue = "date" | "new" | "freq" | "user";

const VALID_SORT_VALUES: SortValue[] = ["date", "new", "freq", "user"];

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry issue list <org>/<project>";

/** Matches strings that are all digits — used to detect invalid cursor values */
const ALL_DIGITS_RE = /^\d+$/;

/**
 * Maximum --limit value (user-facing ceiling for practical CLI response times).
 * Auto-pagination can theoretically fetch more, but 1000 keeps responses reasonable.
 */
const MAX_LIMIT = 1000;

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
function writeListHeader(stdout: Writer, title: string): void {
  stdout.write(`${title}:\n\n`);
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
/** @internal */ export type IssueListResult = {
  target: ResolvedTarget;
  issues: SentryIssue[];
  /** Whether the project has more issues beyond what was fetched. */
  hasMore?: boolean;
  /** Cursor to resume fetching from this project (for Phase 2 / next page). */
  nextCursor?: string;
};

/** Result of building project aliases */
/** @internal */ export type AliasMapResult = {
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
): IssueTableRow[] {
  return results.flatMap((result) =>
    result.issues.map((issue) => {
      const key = `${result.target.org}/${result.target.project}`;
      const alias = aliasMap.get(key);
      return {
        issue,
        orgSlug: result.target.org,
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
        throw new ResolutionError(
          `Project '${parsed.projectSlug}'`,
          "not found",
          `sentry issue list <org>/${parsed.projectSlug}`,
          ["No project with this slug found in any accessible organization"]
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
 * @param options - Query options (query, limit, sort, optional resume cursor)
 * @returns Success with issues + pagination state, or failure with error preserved
 * @throws {AuthError} When user is not authenticated
 */
async function fetchIssuesForTarget(
  target: ResolvedTarget,
  options: {
    query?: string;
    limit: number;
    sort: SortValue;
    statsPeriod?: string;
    /** Resume from this cursor (Phase 2 redistribution or next-page resume). */
    startCursor?: string;
    onPage?: (fetched: number, limit: number) => void;
  }
): Promise<FetchResult> {
  try {
    const { issues, nextCursor } = await listIssuesAllPages(
      target.org,
      target.project,
      options
    );
    return {
      success: true,
      data: { target, issues, hasMore: !!nextCursor, nextCursor },
    };
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

/**
 * Execute Phase 2 of the budget fetch: redistribute surplus to expandable targets
 * and merge the additional results back into `phase1` in place.
 */
async function runPhase2(
  targets: ResolvedTarget[],
  phase1: FetchResult[],
  expandableIndices: number[],
  context: {
    surplus: number;
    options: Omit<BudgetFetchOptions, "limit" | "startCursors">;
  }
): Promise<void> {
  const { surplus, options } = context;
  const extraQuota = Math.max(1, Math.ceil(surplus / expandableIndices.length));

  const phase2 = await Promise.all(
    expandableIndices.map((i) => {
      // expandableIndices only contains indices where r.success && r.data.nextCursor
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by expandableIndices filter
      const target = targets[i]!;
      const r = phase1[i] as { success: true; data: IssueListResult };
      // biome-ignore lint/style/noNonNullAssertion: same guarantee
      const cursor = r.data.nextCursor!;
      return fetchIssuesForTarget(target, {
        ...options,
        limit: extraQuota,
        startCursor: cursor,
      });
    })
  );

  for (let j = 0; j < expandableIndices.length; j++) {
    // biome-ignore lint/style/noNonNullAssertion: j is within expandableIndices bounds
    const i = expandableIndices[j]!;
    const p2 = phase2[j];
    const p1 = phase1[i];
    if (p1?.success && p2?.success) {
      p1.data.issues.push(...p2.data.issues);
      p1.data.hasMore = p2.data.hasMore;
      p1.data.nextCursor = p2.data.nextCursor;
    }
  }
}

/**
 * Options for {@link fetchWithBudget}.
 */
type BudgetFetchOptions = {
  query?: string;
  limit: number;
  sort: SortValue;
  statsPeriod?: string;
  /** Per-target cursors from a previous page (compound cursor resume). */
  startCursors?: Map<string, string>;
};

/**
 * Fetch issues from multiple targets within a global limit budget.
 *
 * Uses a two-phase strategy:
 * 1. Phase 1: distribute `ceil(limit / numTargets)` quota per target, fetch in parallel.
 * 2. Phase 2: if total fetched < limit and some targets have more, redistribute
 *    the surplus among those expandable targets and fetch one more page each.
 *
 * Targets with a `startCursor` in `options.startCursors` resume from that cursor
 * instead of starting fresh — used for compound cursor pagination (−c last).
 *
 * @param targets - Resolved org/project targets to fetch from
 * @param options - Query + budget options
 * @param onProgress - Called after Phase 1 and Phase 2 with total fetched so far
 * @returns Merged fetch results and whether any target has further pages
 */
async function fetchWithBudget(
  targets: ResolvedTarget[],
  options: BudgetFetchOptions,
  onProgress: (fetched: number) => void
): Promise<{ results: FetchResult[]; hasMore: boolean }> {
  const { limit, startCursors } = options;
  const quota = Math.max(1, Math.ceil(limit / targets.length));

  // Phase 1: fetch quota from each target in parallel
  const phase1 = await Promise.all(
    targets.map((t) =>
      fetchIssuesForTarget(t, {
        ...options,
        limit: quota,
        startCursor: startCursors?.get(`${t.org}/${t.project}`),
      })
    )
  );

  let totalFetched = 0;
  for (const r of phase1) {
    if (r.success) {
      totalFetched += r.data.issues.length;
    }
  }
  onProgress(totalFetched);

  const surplus = limit - totalFetched;
  if (surplus <= 0) {
    return {
      results: phase1,
      hasMore: phase1.some((r) => r.success && r.data.hasMore),
    };
  }

  // Identify targets that hit their quota and have a cursor to continue
  const expandableIndices: number[] = [];
  for (let i = 0; i < phase1.length; i++) {
    const r = phase1[i];
    if (r?.success && r.data.issues.length >= quota && r.data.nextCursor) {
      expandableIndices.push(i);
    }
  }

  if (expandableIndices.length === 0) {
    return { results: phase1, hasMore: false };
  }

  await runPhase2(targets, phase1, expandableIndices, { surplus, options });

  totalFetched = 0;
  for (const r of phase1) {
    if (r.success) {
      totalFetched += r.data.issues.length;
    }
  }
  onProgress(totalFetched);

  return {
    results: phase1,
    hasMore: phase1.some((r) => r.success && r.data.hasMore),
  };
}

/**
 * Trim an array of issues to the global limit while guaranteeing at least one
 * issue per project (when possible).
 *
 * Algorithm:
 * 1. Walk the globally-sorted list, taking the first issue from each unseen
 *    project until `limit` slots are filled or all projects are represented.
 * 2. Fill remaining slots from the top of the sorted list, skipping already-
 *    selected issues.
 * 3. Return the final set in original sorted order.
 *
 * When there are more projects than the limit, the projects whose first issue
 * ranks highest in the sorted order get representation.
 *
 * @param issues - Globally sorted array (input order is preserved in output)
 * @param limit - Maximum number of issues to return
 * @returns Trimmed array in the same sorted order
 */
function trimWithProjectGuarantee(
  issues: IssueTableRow[],
  limit: number
): IssueTableRow[] {
  if (issues.length <= limit) {
    return issues;
  }

  const seenProjects = new Set<string>();
  const guaranteed = new Set<number>();

  // Pass 1: pick one representative per project from the sorted list
  for (let i = 0; i < issues.length && guaranteed.size < limit; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i is within bounds
    const projectKey = `${issues[i]!.orgSlug}/${issues[i]!.formatOptions.projectSlug ?? ""}`;
    if (!seenProjects.has(projectKey)) {
      seenProjects.add(projectKey);
      guaranteed.add(i);
    }
  }

  // Pass 2: fill remaining budget from the top of the sorted list
  const selected = new Set<number>(guaranteed);
  for (let i = 0; i < issues.length && selected.size < limit; i++) {
    selected.add(i);
  }

  // Return in original sorted order
  return issues.filter((_, i) => selected.has(i));
}

/** Separator for compound cursor entries (pipe — not present in Sentry cursors). */
const CURSOR_SEP = "|";

/**
 * Encode per-target cursors as a pipe-separated string for storage.
 *
 * The position of each entry matches the **sorted** target order encoded in
 * the context key fingerprint, so we only need to store the cursor values —
 * no org/project metadata is needed in the cursor string itself.
 *
 * Empty string = project exhausted (no more pages).
 *
 * @example "1735689600:0:0||1735689601:0:0" — 3 targets, middle one exhausted
 */
function encodeCompoundCursor(cursors: (string | null)[]): string {
  return cursors.map((c) => c ?? "").join(CURSOR_SEP);
}

/**
 * Decode a compound cursor string back to an array of per-target cursors.
 *
 * Returns `null` for exhausted entries (empty segments) and `string` for active
 * cursors. Returns an empty array if `raw` is empty or looks like a legacy
 * JSON cursor (starts with `[`), causing a fresh start.
 */
function decodeCompoundCursor(raw: string): (string | null)[] {
  // Guard against legacy JSON compound cursors or corrupted data
  if (!raw || raw.startsWith("[")) {
    return [];
  }
  return raw.split(CURSOR_SEP).map((s) => (s === "" ? null : s));
}

/**
 * Build a compound cursor context key that encodes the full target set, sort,
 * query, and period so that a cursor from one search is never reused for a
 * different search.
 */
function buildMultiTargetContextKey(
  targets: ResolvedTarget[],
  flags: Pick<ListFlags, "sort" | "query" | "period">
): string {
  const host = getApiBaseUrl();
  const targetFingerprint = targets
    .map((t) => `${t.org}/${t.project}`)
    .sort()
    .join(",");
  const escapedQuery = flags.query
    ? escapeContextKeyValue(flags.query)
    : undefined;
  const escapedPeriod = escapeContextKeyValue(flags.period ?? "90d");
  return (
    `host:${host}|type:multi:${targetFingerprint}` +
    `|sort:${flags.sort}|period:${escapedPeriod}` +
    (escapedQuery ? `|q:${escapedQuery}` : "")
  );
}

/** Build the CLI hint for fetching the next page, preserving active flags. */
function nextPageHint(org: string, flags: ListFlags): string {
  const base = `sentry issue list ${org}/ -c last`;
  const parts: string[] = [];
  if (flags.sort !== "date") {
    parts.push(`--sort ${flags.sort}`);
  }
  if (flags.query) {
    parts.push(`-q "${flags.query}"`);
  }
  if (flags.period !== "90d") {
    parts.push(`-t ${flags.period}`);
  }
  return parts.length > 0 ? `${base} ${parts.join(" ")}` : base;
}

/**
 * Fetch org-wide issues, auto-paginating from the start or resuming from a cursor.
 *
 * When `cursor` is provided (--cursor resume), fetches a single page to keep the
 * cursor chain intact. Otherwise auto-paginates up to the requested limit.
 */
async function fetchOrgAllIssues(
  org: string,
  flags: Pick<ListFlags, "query" | "limit" | "sort" | "period">,
  cursor: string | undefined,
  onPage?: (fetched: number, limit: number) => void
): Promise<IssuesPage> {
  // When resuming with --cursor, fetch a single page so the cursor chain stays intact.
  if (cursor) {
    const perPage = Math.min(flags.limit, API_MAX_PER_PAGE);
    const response = await listIssuesPaginated(org, "", {
      query: flags.query,
      cursor,
      perPage,
      sort: flags.sort,
      statsPeriod: flags.period,
    });
    return { issues: response.data, nextCursor: response.nextCursor };
  }

  // No cursor — auto-paginate from the beginning via the shared helper.
  const { issues, nextCursor } = await listIssuesAllPages(org, "", {
    query: flags.query,
    limit: flags.limit,
    sort: flags.sort,
    statsPeriod: flags.period,
    onPage,
  });
  return { issues, nextCursor };
}

/** Options for {@link handleOrgAllIssues}. */
type OrgAllIssuesOptions = {
  stdout: Writer;
  stderr: Writer;
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
  const { stdout, stderr, org, flags, setContext } = options;
  // Encode sort + query in context key so cursors from different searches don't collide.
  const escapedQuery = flags.query
    ? escapeContextKeyValue(flags.query)
    : undefined;
  const escapedPeriod = escapeContextKeyValue(flags.period ?? "90d");
  const contextKey = `host:${getApiBaseUrl()}|type:org:${org}|sort:${flags.sort}|period:${escapedPeriod}${escapedQuery ? `|q:${escapedQuery}` : ""}`;
  const cursor = resolveOrgCursor(flags.cursor, PAGINATION_KEY, contextKey);

  setContext([org], []);

  const { issues, nextCursor } = await withProgress(
    { stderr, message: `Fetching issues (up to ${flags.limit})...` },
    (setMessage) =>
      fetchOrgAllIssues(org, flags, cursor, (fetched, limit) =>
        setMessage(
          `Fetching issues, ${fetched} and counting (up to ${limit})...`
        )
      )
  );

  if (nextCursor) {
    setPaginationCursor(PAGINATION_KEY, contextKey, nextCursor);
  } else {
    clearPaginationCursor(PAGINATION_KEY, contextKey);
  }

  const hasMore = !!nextCursor;

  if (flags.json) {
    const output = hasMore
      ? { data: issues, nextCursor, hasMore: true }
      : { data: issues, hasMore: false };
    writeJson(stdout, output);
    return;
  }

  if (issues.length === 0) {
    if (hasMore) {
      stdout.write(
        `No issues on this page. Try the next page: ${nextPageHint(org, flags)}\n`
      );
    } else {
      stdout.write(`No issues found in organization '${org}'.\n`);
    }
    return;
  }

  // isMultiProject=true: org-all shows issues from every project, so the ALIAS
  // column is needed to identify which project each issue belongs to.
  writeListHeader(stdout, `Issues in ${org}`);
  const issuesWithOpts: IssueTableRow[] = issues.map((issue) => ({
    issue,
    // org-all: org context comes from the `org` param; issue.organization may be absent
    orgSlug: org,
    formatOptions: {
      projectSlug: issue.project?.slug ?? "",
      isMultiProject: true,
    },
  }));
  writeIssueTable(stdout, issuesWithOpts, true);

  if (hasMore) {
    stdout.write(`\nShowing ${issues.length} issues (more available)\n`);
    stdout.write(`Next page: ${nextPageHint(org, flags)}\n`);
  } else {
    stdout.write(`\nShowing ${issues.length} issues\n`);
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
 * All three share the same flow: resolve targets → fetch issues within the
 * global limit budget → merge → trim with project guarantee → display.
 * Cursor pagination uses a compound cursor (one cursor per project, encoded
 * as a JSON string) so `-c last` works across multi-target results.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inherent multi-target resolution, compound cursor, error handling, and display logic
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

  // Build a compound cursor context key that encodes the full target set +
  // search parameters so a cursor from one search is never reused for another.
  const contextKey = buildMultiTargetContextKey(targets, flags);

  // Resolve per-target start cursors from the stored compound cursor (--cursor resume).
  // Sorted target keys must match the order used in buildMultiTargetContextKey.
  const sortedTargetKeys = targets.map((t) => `${t.org}/${t.project}`).sort();
  const startCursors = new Map<string, string>();
  const exhaustedTargets = new Set<string>();
  if (flags.cursor) {
    const rawCursor = resolveOrgCursor(
      flags.cursor,
      PAGINATION_KEY,
      contextKey
    );
    if (rawCursor) {
      const decoded = decodeCompoundCursor(rawCursor);
      for (let i = 0; i < decoded.length && i < sortedTargetKeys.length; i++) {
        const cursor = decoded[i];
        // biome-ignore lint/style/noNonNullAssertion: i is within bounds
        const key = sortedTargetKeys[i]!;
        if (cursor) {
          startCursors.set(key, cursor);
        } else {
          // null = project was exhausted on previous page — skip it entirely
          exhaustedTargets.add(key);
        }
      }
    }
  }

  // Filter out exhausted targets so they are not re-fetched from scratch (Comment 2 fix).
  const activeTargets =
    exhaustedTargets.size > 0
      ? targets.filter((t) => !exhaustedTargets.has(`${t.org}/${t.project}`))
      : targets;

  const targetCount = activeTargets.length;
  const baseMessage =
    targetCount > 1
      ? `Fetching issues from ${targetCount} projects`
      : "Fetching issues";

  const { results, hasMore } = await withProgress(
    { stderr, message: `${baseMessage} (up to ${flags.limit})...` },
    (setMessage) =>
      fetchWithBudget(
        activeTargets,
        {
          query: flags.query,
          limit: flags.limit,
          sort: flags.sort,
          statsPeriod: flags.period,
          startCursors,
        },
        (fetched) => {
          setMessage(
            `${baseMessage}, ${fetched} and counting (up to ${flags.limit})...`
          );
        }
      )
  );

  // Store compound cursor so `-c last` can resume from each project's position.
  // Cursors are stored in the same sorted order as buildMultiTargetContextKey.
  const cursorValues: (string | null)[] = sortedTargetKeys.map((key) => {
    // Exhausted targets from previous page stay exhausted
    if (exhaustedTargets.has(key)) {
      return null;
    }
    const result = results.find((r) => {
      if (!r.success) {
        return false;
      }
      return `${r.data.target.org}/${r.data.target.project}` === key;
    });
    if (result?.success) {
      // Successful fetch: null = exhausted (no more pages), string = has more
      return result.data.nextCursor ?? null;
    }
    // Target failed this fetch — preserve the cursor it was given so the next
    // `-c last` retries from the same position rather than skipping it entirely.
    // If no start cursor was given (first-page failure), null means not retried
    // via cursor; the user can run without -c last to restart all projects.
    return startCursors.get(key) ?? null;
  });
  const hasAnyCursor = cursorValues.some((c) => c !== null);
  if (hasAnyCursor) {
    setPaginationCursor(
      PAGINATION_KEY,
      contextKey,
      encodeCompoundCursor(cursorValues)
    );
  } else {
    clearPaginationCursor(PAGINATION_KEY, contextKey);
  }

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

  const allIssuesWithOptions = attachFormatOptions(
    validResults,
    aliasMap,
    isMultiProject
  );

  allIssuesWithOptions.sort((a, b) =>
    getComparator(flags.sort)(a.issue, b.issue)
  );

  // Trim to the global limit with project representation guarantee
  const issuesWithOptions = trimWithProjectGuarantee(
    allIssuesWithOptions,
    flags.limit
  );
  const trimmed = issuesWithOptions.length < allIssuesWithOptions.length;
  const hasMoreToShow = hasMore || hasAnyCursor || trimmed;
  const canPaginate = hasAnyCursor;

  if (flags.json) {
    const allIssues = issuesWithOptions.map((i) => i.issue);
    const output: Record<string, unknown> = {
      data: allIssues,
      hasMore: hasMoreToShow,
    };
    if (failures.length > 0) {
      output.errors = failures.map((e) =>
        e instanceof ApiError
          ? { status: e.status, message: e.message }
          : { message: e.message }
      );
    }
    writeJson(stdout, output);
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

  writeListHeader(stdout, title);
  writeIssueTable(stdout, issuesWithOptions, isMultiProject);

  let footerMode: "single" | "multi" | "none" = "none";
  if (isMultiProject) {
    footerMode = "multi";
  } else if (isSingleProject) {
    footerMode = "single";
  }
  writeListFooter(stdout, footerMode);

  if (hasMoreToShow) {
    const higherLimit = Math.min(flags.limit * 2, MAX_LIMIT);
    const canIncreaseLimit = higherLimit > flags.limit;
    const hintParts: string[] = [];
    if (canIncreaseLimit) {
      hintParts.push(`-n ${higherLimit}`);
    }
    if (canPaginate) {
      hintParts.push("-c last");
    }
    // Only print the hint when there is at least one actionable option
    if (hintParts.length > 0) {
      stdout.write(
        muted(
          `\nMore issues available — use ${hintParts.join(" or ")} for more.\n`
        )
      );
    }
  }

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

/**
 * @internal Exported for testing only. Not part of the public API.
 */
export const __testing = {
  trimWithProjectGuarantee,
  encodeCompoundCursor,
  decodeCompoundCursor,
  buildMultiTargetContextKey,
  buildProjectAliasMap,
  getComparator,
  compareDates,
  parseSort,
  CURSOR_SEP,
  MAX_LIMIT,
  VALID_SORT_VALUES,
};

export const listCommand = buildListCommand("issue", {
  docs: {
    brief: "List issues in a project",
    fullDescription:
      "List issues from Sentry projects.\n\n" +
      "Target patterns:\n" +
      "  sentry issue list               # auto-detect from DSN or config\n" +
      "  sentry issue list <org>/<proj>  # explicit org and project\n" +
      "  sentry issue list <org>/        # all projects in org (trailing / required)\n" +
      "  sentry issue list <project>     # find project across all orgs\n\n" +
      `${targetPatternExplanation()}\n\n` +
      "In monorepos with multiple Sentry projects, shows issues from all detected projects.\n\n" +
      "The --limit flag specifies the total number of issues to display (max 1000). " +
      "When multiple projects are detected, the limit is distributed evenly across them. " +
      "Projects with fewer issues than their share give their surplus to others. " +
      "Use --cursor / -c last to paginate through larger result sets.\n\n" +
      "By default, only issues with activity in the last 90 days are shown. " +
      "Use --period to adjust (e.g. --period 24h, --period 14d).",
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
      limit: buildListLimitFlag("issues", "25"),
      sort: {
        kind: "parsed",
        parse: parseSort,
        brief: "Sort by: date, new, freq, user",
        default: "date" as const,
      },
      period: {
        kind: "parsed",
        parse: String,
        brief: "Time period for issue activity (e.g. 24h, 14d, 90d)",
        default: "90d",
      },
      json: LIST_JSON_FLAG,
      cursor: {
        kind: "parsed",
        parse: (value: string) => {
          // "last" is the magic keyword to resume from the saved cursor
          if (value === "last") {
            return value;
          }
          // Sentry pagination cursors are opaque strings like "1735689600:0:0".
          // Plain integers are not valid cursors — catch this early so the user
          // gets a clear error rather than a cryptic 400 from the API.
          if (ALL_DIGITS_RE.test(value)) {
            throw new Error(
              `'${value}' is not a valid cursor. Cursors look like "1735689600:0:0". Use "last" to continue from the previous page.`
            );
          }
          return value;
        },
        brief:
          'Pagination cursor for <org>/ or multi-target modes (use "last" to continue)',
        optional: true,
      },
    },
    aliases: { ...LIST_BASE_ALIASES, q: "query", s: "sort", t: "period" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    const { stdout, stderr, cwd, setContext } = this;

    const parsed = parseOrgProjectArg(target);

    // Validate --limit range. Auto-pagination handles the API's 100-per-page
    // cap transparently, but we cap the total at MAX_LIMIT for practical CLI
    // response times. Use --cursor for paginating through larger result sets.
    if (flags.limit < 1) {
      throw new ValidationError("--limit must be at least 1.", "limit");
    }
    if (flags.limit > MAX_LIMIT) {
      throw new ValidationError(
        `--limit cannot exceed ${MAX_LIMIT}. ` +
          "Use --cursor to paginate through larger result sets.",
        "limit"
      );
    }

    // biome-ignore lint/suspicious/noExplicitAny: shared handler accepts any mode variant
    const resolveAndHandle: ModeHandler<any> = (ctx) =>
      handleResolvedTargets({ ...ctx, flags, stderr, setContext });

    await dispatchOrgScopedList({
      config: issueListMeta,
      stdout,
      cwd,
      flags,
      parsed,
      // Multi-target modes (auto-detect, explicit, project-search) handle
      // compound cursor pagination themselves via handleResolvedTargets.
      allowCursorInModes: ["auto-detect", "explicit", "project-search"],
      overrides: {
        "auto-detect": resolveAndHandle,
        explicit: resolveAndHandle,
        "project-search": resolveAndHandle,
        "org-all": (ctx) =>
          handleOrgAllIssues({
            stdout: ctx.stdout,
            stderr,
            org: ctx.parsed.org,
            flags,
            setContext,
          }),
      },
    });
  },
});
