/**
 * Issue API functions
 *
 * Functions for listing, retrieving, and updating Sentry issues.
 */

import type { ListAnOrganizationSissuesData } from "@sentry/api";
import { listAnOrganization_sIssues } from "@sentry/api";

import type { SentryIssue } from "../../types/index.js";

import { ApiError } from "../errors.js";
import { resolveOrgRegion } from "../region.js";

import {
  API_MAX_PER_PAGE,
  apiRequest,
  apiRequestToRegion,
  getOrgSdkConfig,
  MAX_PAGINATION_PAGES,
  type PaginatedResponse,
  unwrapPaginatedResult,
} from "./infrastructure.js";

/**
 * Sort options for issue listing, derived from the @sentry/api SDK types.
 * Uses the SDK type directly for compile-time safety against parameter drift.
 */
export type IssueSort = NonNullable<
  NonNullable<ListAnOrganizationSissuesData["query"]>["sort"]
>;

/**
 * Collapse options for issue listing, derived from the @sentry/api SDK types.
 * Each value tells the server to skip computing that data field, avoiding
 * expensive Snuba/ClickHouse queries on the backend.
 *
 * - `'stats'` — time-series event counts (sparkline data)
 * - `'lifetime'` — lifetime aggregate counts (count, userCount, firstSeen)
 * - `'filtered'` — filtered aggregate counts
 * - `'unhandled'` — unhandled event flag computation
 * - `'base'` — base group fields (rarely useful to collapse)
 */
export type IssueCollapseField = NonNullable<
  NonNullable<ListAnOrganizationSissuesData["query"]>["collapse"]
>[number];

/**
 * Build the `collapse` parameter for issue list API calls.
 *
 * Always collapses fields the CLI never consumes in issue list:
 * `filtered`, `lifetime`, `unhandled`. Conditionally collapses `stats`
 * when sparklines won't be rendered (narrow terminal, non-TTY, or JSON).
 *
 * Matches the Sentry web UI's optimization: the initial page load sends
 * `collapse=stats,unhandled` to skip expensive Snuba queries, fetching
 * stats in a follow-up request only when needed.
 *
 * @param options - Context for determining what to collapse
 * @param options.shouldCollapseStats - Whether stats data can be skipped
 *   (true when sparklines won't be shown: narrow terminal, non-TTY, --json)
 * @returns Array of fields to collapse
 */
export function buildIssueListCollapse(options: {
  shouldCollapseStats: boolean;
}): IssueCollapseField[] {
  const collapse: IssueCollapseField[] = ["filtered", "lifetime", "unhandled"];
  if (options.shouldCollapseStats) {
    collapse.push("stats");
  }
  return collapse;
}

/**
 * Collapse fields for single-issue detail endpoints.
 *
 * The CLI never displays stats (sparkline time-series), lifetime (aggregate
 * sub-object), filtered (filtered counts), or unhandled (unhandled sub-object)
 * in detail views (`issue view`, `issue explain`, `issue plan`).
 * Collapsing these skips expensive Snuba queries, saving 100-300ms per request.
 *
 * Note: `count`, `userCount`, `firstSeen`, `lastSeen` are top-level fields
 * and remain unaffected by collapsing.
 */
export const ISSUE_DETAIL_COLLAPSE: IssueCollapseField[] = [
  "stats",
  "lifetime",
  "filtered",
  "unhandled",
];

/**
 * List issues for a project with pagination control.
 *
 * Uses the @sentry/api SDK's `listAnOrganization_sIssues` for type-safe
 * query parameters, and extracts pagination from the response Link header.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug (empty string for org-wide listing)
 * @param options - Query and pagination options
 * @returns Single page of issues with cursor metadata
 */
export async function listIssuesPaginated(
  orgSlug: string,
  projectSlug: string,
  options: {
    query?: string;
    cursor?: string;
    perPage?: number;
    sort?: IssueSort;
    statsPeriod?: string;
    /** Numeric project ID. When provided, uses the `project` query param
     *  instead of `project:<slug>` search syntax, avoiding "not actively
     *  selected" errors. */
    projectId?: number;
    /** Controls the time resolution of inline stats data. "auto" adapts to statsPeriod. */
    groupStatsPeriod?: "" | "14d" | "24h" | "auto";
    /** Fields to collapse (omit) from the response for performance.
     *  @see {@link buildIssueListCollapse} */
    collapse?: IssueCollapseField[];
  } = {}
): Promise<PaginatedResponse<SentryIssue[]>> {
  // When we have a numeric project ID, use the `project` query param (Array<number>)
  // instead of `project:<slug>` in the search query. The API's `project` param
  // selects the project directly, bypassing the "actively selected" requirement.
  let projectFilter = "";
  if (!options.projectId && projectSlug) {
    projectFilter = `project:${projectSlug}`;
  }
  const fullQuery = [projectFilter, options.query].filter(Boolean).join(" ");

  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sIssues({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    query: {
      project: options.projectId ? [options.projectId] : undefined,
      // Convert empty string to undefined so the SDK omits the param entirely;
      // sending `query=` causes the Sentry API to behave differently than
      // omitting the parameter.
      query: fullQuery || undefined,
      cursor: options.cursor,
      limit: options.perPage ?? 25,
      sort: options.sort,
      statsPeriod: options.statsPeriod,
      groupStatsPeriod: options.groupStatsPeriod,
      collapse: options.collapse,
    },
  });

  return unwrapPaginatedResult<SentryIssue[]>(
    result as
      | { data: SentryIssue[]; error: undefined }
      | { data: undefined; error: unknown },
    "Failed to list issues"
  );
}

/** Result from {@link listIssuesAllPages}. */
export type IssuesPage = {
  issues: SentryIssue[];
  /**
   * Cursor for the next page of results, if more exist beyond the returned
   * issues. `undefined` when all matching issues have been returned OR when
   * the last page was trimmed to fit `limit` (cursor would skip items).
   */
  nextCursor?: string;
};

/**
 * Auto-paginate through issues up to the requested limit.
 *
 * The Sentry API caps `per_page` at {@link API_MAX_PER_PAGE} server-side. When the caller
 * requests more than that, this function transparently fetches multiple
 * pages using cursor-based pagination and returns the combined result.
 *
 * Safety-bounded by {@link MAX_PAGINATION_PAGES} to prevent runaway requests.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug (empty string for org-wide)
 * @param options - Query, sort, and limit options
 * @returns Issues (up to `limit` items) and a cursor for the next page if available
 */
export async function listIssuesAllPages(
  orgSlug: string,
  projectSlug: string,
  options: {
    query?: string;
    limit: number;
    sort?: IssueSort;
    statsPeriod?: string;
    /** Numeric project ID for direct project selection via query param. */
    projectId?: number;
    /** Controls the time resolution of inline stats data. "auto" adapts to statsPeriod. */
    groupStatsPeriod?: "" | "14d" | "24h" | "auto";
    /** Resume pagination from this cursor instead of starting from the beginning. */
    startCursor?: string;
    /** Called after each page is fetched. Useful for progress indicators. */
    onPage?: (fetched: number, limit: number) => void;
    /** Fields to collapse (omit) from the response for performance.
     *  @see {@link buildIssueListCollapse} */
    collapse?: IssueCollapseField[];
  }
): Promise<IssuesPage> {
  if (options.limit < 1) {
    throw new Error(
      `listIssuesAllPages: limit must be at least 1, got ${options.limit}`
    );
  }

  const allResults: SentryIssue[] = [];
  let cursor: string | undefined = options.startCursor;

  // Use the smaller of the requested limit and the API max as page size
  const perPage = Math.min(options.limit, API_MAX_PER_PAGE);

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const response = await listIssuesPaginated(orgSlug, projectSlug, {
      query: options.query,
      cursor,
      perPage,
      sort: options.sort,
      statsPeriod: options.statsPeriod,
      projectId: options.projectId,
      groupStatsPeriod: options.groupStatsPeriod,
      collapse: options.collapse,
    });

    allResults.push(...response.data);
    options.onPage?.(Math.min(allResults.length, options.limit), options.limit);

    // Stop if we've reached the requested limit or there are no more pages
    if (allResults.length >= options.limit || !response.nextCursor) {
      // If we overshot the limit, trim and don't return a nextCursor —
      // the cursor would point past the trimmed items, causing skips.
      if (allResults.length > options.limit) {
        return { issues: allResults.slice(0, options.limit) };
      }
      return { issues: allResults, nextCursor: response.nextCursor };
    }

    cursor = response.nextCursor;
  }

  // Safety limit reached — return what we have, no nextCursor
  return { issues: allResults.slice(0, options.limit) };
}

/**
 * Get a specific issue by numeric ID.
 *
 * Uses the legacy unscoped endpoint — no org context or region routing.
 * Prefer {@link getIssueInOrg} when the org slug is known.
 *
 * @param issueId - Numeric issue ID
 * @param options - Optional collapse fields to skip expensive backend queries
 */
export function getIssue(
  issueId: string,
  options?: { collapse?: IssueCollapseField[] }
): Promise<SentryIssue> {
  return apiRequest<SentryIssue>(`/issues/${issueId}/`, {
    params: options?.collapse ? { collapse: options.collapse } : undefined,
  });
}

/**
 * Get a specific issue by numeric ID, scoped to an organization.
 *
 * Uses the org-scoped endpoint with region-aware routing.
 * Preferred over {@link getIssue} when the org slug is available.
 *
 * Uses raw `apiRequestToRegion` instead of the SDK's `retrieveAnIssue`
 * because the SDK types declare `query?: never`, blocking `collapse`
 * and other query parameters. See: https://github.com/getsentry/sentry-api-schema/issues/63
 *
 * @param orgSlug - Organization slug (used for region routing)
 * @param issueId - Numeric issue ID
 * @param options - Optional collapse fields to skip expensive backend queries
 */
export async function getIssueInOrg(
  orgSlug: string,
  issueId: string,
  options?: { collapse?: IssueCollapseField[] }
): Promise<SentryIssue> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<SentryIssue>(
    regionUrl,
    `/organizations/${orgSlug}/issues/${issueId}/`,
    {
      params: options?.collapse ? { collapse: options.collapse } : undefined,
    }
  );
  return data;
}

/**
 * Get an issue by short ID (e.g., SPOTLIGHT-ELECTRON-4D).
 * Requires organization context to resolve the short ID.
 * Uses region-aware routing for multi-region support.
 *
 * Uses raw `apiRequestToRegion` instead of the SDK's `resolveAShortId`
 * because the SDK types declare `query?: never`, blocking `collapse`
 * and other query parameters. See: https://github.com/getsentry/sentry-api-schema/
 *
 * @param orgSlug - Organization slug
 * @param shortId - Short ID (e.g., "CLI-G5", "SPOTLIGHT-ELECTRON-4D")
 * @param options - Optional collapse fields to skip expensive backend queries
 */
export async function getIssueByShortId(
  orgSlug: string,
  shortId: string,
  options?: { collapse?: IssueCollapseField[] }
): Promise<SentryIssue> {
  const normalizedShortId = shortId.toUpperCase();
  const regionUrl = await resolveOrgRegion(orgSlug);

  let data: { group?: SentryIssue };
  try {
    const result = await apiRequestToRegion<{ group?: SentryIssue }>(
      regionUrl,
      `/organizations/${orgSlug}/shortids/${normalizedShortId}/`,
      {
        params: options?.collapse ? { collapse: options.collapse } : undefined,
      }
    );
    data = result.data;
  } catch (error) {
    // Enrich 404 errors with actionable context. The generic
    // "Failed to resolve short ID: 404 Not Found" is the most common
    // issue view error (CLI-A1, 27 users). Callers like
    // tryGetIssueByShortId still catch ApiError by status code.
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(
        `Short ID '${normalizedShortId}' not found in organization '${orgSlug}'`,
        404,
        [
          "The issue may have been deleted or merged",
          `Verify the short ID and org: sentry issue view ${orgSlug}/${normalizedShortId}`,
          `List issues in this org: sentry issue list ${orgSlug}/`,
        ].join("\n  ")
      );
    }
    throw error;
  }

  if (!data.group) {
    throw new ApiError(
      `Short ID ${normalizedShortId} resolved but no issue group returned`,
      404,
      "Issue not found"
    );
  }
  return data.group;
}

/**
 * Try to get an issue by short ID, returning null on 404.
 *
 * Same as {@link getIssueByShortId} but returns null instead of throwing
 * when the short ID is not found. Useful for parallel fan-out across orgs
 * where most will 404.
 *
 * @param orgSlug - Organization slug
 * @param shortId - Full short ID (e.g., "CONSUMER-MOBILE-1QNEK")
 * @returns The resolved issue, or null if not found in this org
 */
export async function tryGetIssueByShortId(
  orgSlug: string,
  shortId: string,
  options?: { collapse?: IssueCollapseField[] }
): Promise<SentryIssue | null> {
  try {
    return await getIssueByShortId(orgSlug, shortId, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Update an issue's status.
 */
export function updateIssueStatus(
  issueId: string,
  status: "resolved" | "unresolved" | "ignored"
): Promise<SentryIssue> {
  // Use raw request - the SDK's updateAnIssue requires org slug but
  // the legacy /issues/{id}/ endpoint works without it
  return apiRequest<SentryIssue>(`/issues/${issueId}/`, {
    method: "PUT",
    body: { status },
  });
}
