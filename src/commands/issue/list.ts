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
  getProject,
  type IssuesPage,
  listIssuesAllPages,
  listIssuesPaginated,
  listProjects,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import {
  buildPaginationContextKey,
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
  ContextError,
  ResolutionError,
  ValidationError,
  withAuthGuard,
} from "../../lib/errors.js";
import {
  type IssueTableRow,
  shouldAutoCompact,
  writeIssueTable,
} from "../../lib/formatters/index.js";
import {
  CommandOutput,
  type OutputConfig,
  stateless,
} from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  buildListCommand,
  buildListLimitFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
  LIST_BASE_ALIASES,
  LIST_TARGET_POSITIONAL,
  parseCursorFlag,
  targetPatternExplanation,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import {
  dispatchOrgScopedList,
  jsonTransformListResult,
  type ListCommandMeta,
  type ListResult,
  type ModeHandler,
} from "../../lib/org-list.js";
import { withProgress } from "../../lib/polling.js";
import {
  fetchProjectId,
  type ResolvedTarget,
  resolveAllTargets,
  toNumericId,
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
  readonly fresh: boolean;
  readonly compact?: boolean;
  readonly fields?: string[];
};

/**
 * Extended result type for issue list with display context.
 *
 * Extends {@link ListResult} with rendering metadata needed by the human
 * formatter (pre-built display rows, table options) and by the JSON
 * transform (raw issue data for serialization).
 *
 * Handlers return this type; the `OutputConfig` decides how to render it.
 */
export type IssueListResult = ListResult<SentryIssue> & {
  /** Pre-formatted display rows for the human issue table */
  displayRows?: IssueTableRow[];
  /** Title shown above the table in human output (e.g. "Issues in sentry/cli") */
  title?: string;
  /** Footer mode controlling which usage tip to show after the table */
  footerMode?: "single" | "multi" | "none";
  /** Whether to use compact (single-line) table rendering */
  compact?: boolean;
  /** "More issues available" hint with actionable flags */
  moreHint?: string;
  /** DSN detection or multi-project summary footer */
  footer?: string;
};

/** @internal */ export type SortValue = "date" | "new" | "freq" | "user";

const VALID_SORT_VALUES: SortValue[] = ["date", "new", "freq", "user"];

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry issue list <org>/<project>";

/**
 * Maximum --limit value (user-facing ceiling for practical CLI response times).
 * Auto-pagination can theoretically fetch more, but 1000 keeps responses reasonable.
 */
const MAX_LIMIT = 1000;

/**
 * Resolve the effective compact mode from the flag tri-state and issue count.
 *
 * - `true` / `false` — explicit user override, returned as-is
 * - `undefined` — auto-detect based on terminal height vs estimated table height
 */
function resolveCompact(flag: boolean | undefined, rowCount: number): boolean {
  if (flag !== undefined) {
    return flag;
  }
  return shouldAutoCompact(rowCount);
}

function parseSort(value: string): SortValue {
  if (!VALID_SORT_VALUES.includes(value as SortValue)) {
    throw new Error(
      `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
    );
  }
  return value as SortValue;
}

/**
 * Format the issue list header with column titles.
 *
 * @param title - Section title
 */
function formatListHeader(title: string): string {
  return `${title}:\n\n`;
}

/**
 * Format footer with usage tip.
 *
 * @param mode - Display mode: 'single' (one project), 'multi' (multiple projects), or 'none'
 */
function formatListFooter(mode: "single" | "multi" | "none"): string {
  switch (mode) {
    case "single":
      return "\nTip: Use 'sentry issue view <ID>' to view details (bold part works as shorthand).";
    case "multi":
      return "\nTip: Use 'sentry issue view <ALIAS>' to view details (see ALIAS column).";
    default:
      return "\nTip: Use 'sentry issue view <SHORT_ID>' to view issue details.";
  }
}

/** Issue list with target context */
/** @internal */ export type IssueListFetchResult = {
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
function buildProjectAliasMap(results: IssueListFetchResult[]): AliasMapResult {
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
  results: IssueListFetchResult[],
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
  | { success: true; data: IssueListFetchResult }
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
    case "auto-detect": {
      // Use existing resolution logic (DSN detection, config defaults)
      const result = await resolveAllTargets({ cwd, usageHint: USAGE_HINT });
      // DSN-detected and directory-inferred targets already carry a projectId.
      // Env var / config-default paths return targets without one, so enrich
      // them now using the project API. Any failure silently falls back to
      // slug-based querying — the target was already resolved, so we never
      // surface a ResolutionError here (that's only for the explicit case).
      result.targets = await Promise.all(
        result.targets.map(async (t) => {
          if (t.projectId !== undefined) {
            return t;
          }
          try {
            const info = await getProject(t.org, t.project);
            const id = toNumericId(info.id);
            return id !== undefined ? { ...t, projectId: id } : t;
          } catch {
            return t;
          }
        })
      );
      return result;
    }

    case "explicit": {
      // Single explicit target — fetch project ID for API query param
      const projectId = await fetchProjectId(parsed.org, parsed.project);
      return {
        targets: [
          {
            org: parsed.org,
            project: parsed.project,
            projectId,
            orgDisplay: parsed.org,
            projectDisplay: parsed.project,
          },
        ],
      };
    }

    case "org-all": {
      // List all projects in the specified org
      const projects = await listProjects(parsed.org);
      const targets: ResolvedTarget[] = projects.map((p) => ({
        org: parsed.org,
        project: p.slug,
        projectId: toNumericId(p.id),
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
      const { projects: matches, orgs } = await findProjectsBySlug(
        parsed.projectSlug
      );

      if (matches.length === 0) {
        // Check if the slug matches an organization — common mistake.
        // Unlike simpler list commands that auto-redirect via orgAllFallback,
        // issue list has custom per-project query logic (query rewriting,
        // budget redistribution) that doesn't support org-all mode here.
        // Throwing with actionable hints is the correct behavior.
        const isOrg = orgs.some((o) => o.slug === parsed.projectSlug);
        if (isOrg) {
          throw new ResolutionError(
            `'${parsed.projectSlug}'`,
            "is an organization, not a project",
            `sentry issue list ${parsed.projectSlug}/`,
            [
              `List projects: sentry project list ${parsed.projectSlug}/`,
              `Specify a project: sentry issue list ${parsed.projectSlug}/<project>`,
            ]
          );
        }

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
        projectId: toNumericId(m.id),
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
  const result = await withAuthGuard(async () => {
    const { issues, nextCursor } = await listIssuesAllPages(
      target.org,
      target.project,
      { ...options, projectId: target.projectId, groupStatsPeriod: "auto" }
    );
    return { target, issues, hasMore: !!nextCursor, nextCursor };
  });

  if (!result.ok) {
    const error =
      result.error instanceof Error
        ? result.error
        : new Error(String(result.error));
    return { success: false, error };
  }
  return { success: true, data: result.value };
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
      const r = phase1[i] as { success: true; data: IssueListFetchResult };
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
  const escapedSort = escapeContextKeyValue(flags.sort);
  return (
    `host:${host}|type:multi:${targetFingerprint}` +
    `|sort:${escapedSort}|period:${escapedPeriod}` +
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
      groupStatsPeriod: "auto",
    });
    return { issues: response.data, nextCursor: response.nextCursor };
  }

  // No cursor — auto-paginate from the beginning via the shared helper.
  const { issues, nextCursor } = await listIssuesAllPages(org, "", {
    query: flags.query,
    limit: flags.limit,
    sort: flags.sort,
    statsPeriod: flags.period,
    groupStatsPeriod: "auto",
    onPage,
  });
  return { issues, nextCursor };
}

/** Options for {@link handleOrgAllIssues}. */
type OrgAllIssuesOptions = {
  org: string;
  flags: ListFlags;
  setContext: (orgs: string[], projects: string[]) => void;
};

/**
 * Handle org-all mode for issues: cursor-paginated listing of all issues in an org.
 *
 * Uses a sort+query-aware context key so cursors from different searches are
 * never accidentally reused. Returns an {@link IssueListResult} — the caller
 * is responsible for rendering (JSON or human output).
 */
async function handleOrgAllIssues(
  options: OrgAllIssuesOptions
): Promise<IssueListResult> {
  const { org, flags, setContext } = options;
  // Encode sort + query in context key so cursors from different searches don't collide.
  const contextKey = buildPaginationContextKey("org", org, {
    sort: flags.sort,
    period: flags.period ?? "90d",
    q: flags.query,
  });
  const cursor = resolveOrgCursor(flags.cursor, PAGINATION_KEY, contextKey);

  setContext([org], []);

  const { issues, nextCursor } = await withProgress(
    { message: `Fetching issues (up to ${flags.limit})...` },
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

  if (issues.length === 0) {
    const hint = hasMore
      ? `No issues on this page. Try the next page: ${nextPageHint(org, flags)}`
      : `No issues found in organization '${org}'.`;
    return { items: [], hasMore, nextCursor, hint };
  }

  // isMultiProject=true: org-all shows issues from every project, so the ALIAS
  // column is needed to identify which project each issue belongs to.
  const displayRows: IssueTableRow[] = issues.map((issue) => ({
    issue,
    // org-all: org context comes from the `org` param; issue.organization may be absent
    orgSlug: org,
    formatOptions: {
      projectSlug: issue.project?.slug ?? "",
      isMultiProject: true,
    },
  }));

  const hintParts: string[] = [];
  if (hasMore) {
    hintParts.push(
      `Showing ${issues.length} issues (more available)`,
      `Next page: ${nextPageHint(org, flags)}`
    );
  } else {
    hintParts.push(`Showing ${issues.length} issues`);
  }

  return {
    items: issues,
    hasMore,
    nextCursor,
    hint: hintParts.join("\n"),
    displayRows,
    title: `Issues in ${org}`,
    compact: resolveCompact(flags.compact, displayRows.length),
  };
}

/** Options for {@link handleResolvedTargets}. */
type ResolvedTargetsOptions = {
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
): Promise<IssueListResult> {
  const { parsed, flags, cwd, setContext } = options;

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
    { message: `${baseMessage} (up to ${flags.limit})...` },
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

  const validResults: IssueListFetchResult[] = [];
  const failures: { target: ResolvedTarget; error: Error }[] = [];

  for (let i = 0; i < results.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    const result = results[i]!;
    if (result.success) {
      validResults.push(result.data);
    } else {
      // biome-ignore lint/style/noNonNullAssertion: index within bounds
      failures.push({ target: activeTargets[i]!, error: result.error });
    }
  }

  if (validResults.length === 0 && failures.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by failures.length > 0
    const { error: first } = failures[0]!;
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

  const allIssues = issuesWithOptions.map((i) => i.issue);

  const errors =
    failures.length > 0
      ? failures.map(({ target: t, error: e }) =>
          e instanceof ApiError
            ? {
                project: `${t.org}/${t.project}`,
                status: e.status,
                message: e.message,
              }
            : { project: `${t.org}/${t.project}`, message: e.message }
        )
      : undefined;

  // Write partial-failure note to stderr (side effect for progress/warnings)
  if (failures.length > 0) {
    const failedNames = failures
      .map(({ target: t }) => `${t.org}/${t.project}`)
      .join(", ");
    logger.warn(
      `Failed to fetch issues from ${failedNames}. Showing results from ${validResults.length} project(s).`
    );
  }

  if (issuesWithOptions.length === 0) {
    const hint = footer ? `No issues found.\n\n${footer}` : "No issues found.";
    return { items: [], hint, hasMore: false, errors };
  }

  const title =
    isSingleProject && firstTarget
      ? `Issues in ${firstTarget.orgDisplay}/${firstTarget.projectDisplay}`
      : `Issues from ${validResults.length} projects`;

  let footerMode: "single" | "multi" | "none" = "none";
  if (isMultiProject) {
    footerMode = "multi";
  } else if (isSingleProject) {
    footerMode = "single";
  }

  let moreHint: string | undefined;
  if (hasMoreToShow) {
    const higherLimit = Math.min(flags.limit * 2, MAX_LIMIT);
    const canIncreaseLimit = higherLimit > flags.limit;
    const actionParts: string[] = [];
    if (canIncreaseLimit) {
      actionParts.push(`-n ${higherLimit}`);
    }
    if (canPaginate) {
      actionParts.push("-c last");
    }
    // Only set the hint when there is at least one actionable option
    if (actionParts.length > 0) {
      moreHint = `More issues available — use ${actionParts.join(" or ")} for more.`;
    }
  }

  return {
    items: allIssues,
    hasMore: hasMoreToShow,
    errors,
    displayRows: issuesWithOptions,
    title,
    footerMode,
    compact: resolveCompact(flags.compact, issuesWithOptions.length),
    moreHint,
    footer,
  };
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

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

/**
 * Render an issue table to a string by buffering `writeIssueTable` output.
 *
 * This bridges the existing `writeIssueTable` (Writer-based) API to the
 * return-based `OutputConfig` pattern without duplicating the table logic.
 */
function renderIssueTable(rows: IssueTableRow[], compact: boolean): string {
  const parts: string[] = [];
  const buffer: Writer = {
    write: (s: string) => {
      parts.push(s);
    },
  };
  writeIssueTable(buffer, rows, { compact });
  return parts.join("");
}

/**
 * Format an {@link IssueListResult} as human-readable terminal output.
 *
 * Renders the title, issue table (via {@link writeIssueTable}), footer tip,
 * and "more available" hint. Empty results show the hint message only.
 */
function formatIssueListHuman(result: IssueListResult): string {
  const parts: string[] = [];

  if (result.items.length === 0) {
    // Empty result — hint contains "No issues found" or similar
    if (result.hint) {
      parts.push(result.hint);
    }
    return parts.join("\n");
  }

  // Title above the table (e.g. "Issues in sentry/cli:")
  if (result.title) {
    parts.push(formatListHeader(result.title));
  }

  // Render the issue table
  if (result.displayRows && result.displayRows.length > 0) {
    parts.push(renderIssueTable(result.displayRows, result.compact ?? false));
  }

  // Footer tip (e.g. "Tip: Use 'sentry issue view <ID>' ...")
  if (result.footerMode) {
    parts.push(formatListFooter(result.footerMode));
  }

  return parts.join("");
}

/**
 * Transform an {@link IssueListResult} into the JSON output format.
 *
 * Paginated responses produce a `{ data, hasMore, nextCursor?, errors? }` envelope.
 * Non-paginated responses produce a flat `[...]` array.
 * Field filtering is applied per-element inside `data`, not to the wrapper.
 */
// JSON transform delegates to the shared jsonTransformListResult in org-list.ts.
// IssueListResult extends ListResult<SentryIssue>, so the shared function handles
// all envelope fields (hasMore, nextCursor, errors, jsonExtra) uniformly.
const jsonTransformIssueList = jsonTransformListResult;

/** Output configuration for the issue list command. */
const issueListOutput: OutputConfig<IssueListResult> = {
  human: stateless(formatIssueListHuman),
  jsonTransform: jsonTransformIssueList,
};

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

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
  output: issueListOutput,
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
      cursor: {
        kind: "parsed",
        parse: parseCursorFlag,
        brief:
          'Pagination cursor for <org>/ or multi-target modes (use "last" to continue)',
        optional: true,
      },
      fresh: FRESH_FLAG,
      compact: {
        kind: "boolean",
        brief: "Single-line rows for compact output (auto-detects if omitted)",
        optional: true,
      },
    },
    aliases: {
      ...LIST_BASE_ALIASES,
      ...FRESH_ALIASES,
      q: "query",
      s: "sort",
      t: "period",
    },
  },
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    applyFreshFlag(flags);
    const { cwd, setContext } = this;

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
      handleResolvedTargets({
        ...ctx,
        flags,
        setContext,
      });

    const result = (await dispatchOrgScopedList({
      config: issueListMeta,
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
            org: ctx.parsed.org,
            flags,
            setContext,
          }),
      },
    })) as IssueListResult;

    // Only forward hints to the framework footer when items exist — empty
    // results already render hint text inside formatIssueListHuman.
    let combinedHint: string | undefined;
    if (result.items.length > 0) {
      const hintParts: string[] = [];
      if (result.moreHint) {
        hintParts.push(result.moreHint);
      }
      if (result.footer) {
        hintParts.push(result.footer);
      }
      combinedHint = hintParts.length > 0 ? hintParts.join("\n") : result.hint;
    }

    yield new CommandOutput(result);
    return { hint: combinedHint };
  },
});
