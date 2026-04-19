/**
 * Issue API functions
 *
 * Functions for listing, retrieving, and updating Sentry issues.
 */

import type { ListAnOrganizationSissuesData } from "@sentry/api";
import { listAnOrganization_sIssues } from "@sentry/api";

import type { SentryIssue } from "../../types/index.js";

import { applyCustomHeaders } from "../custom-headers.js";
import { ApiError, ValidationError } from "../errors.js";
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
    /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
    start?: string;
    /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
    end?: string;
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
      start: options.start,
      end: options.end,
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
    /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
    start?: string;
    /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
    end?: string;
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
      start: options.start,
      end: options.end,
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
 * Resolution-release tracking for {@link updateIssueStatus}. Maps to the
 * `statusDetails` shape expected by Sentry's bulk mutate endpoint:
 *
 * - `inRelease` — resolve in a specific named release (e.g. `"0.26.1"`).
 *   Future events seen on releases **after** this one will regression-flag.
 * - `inNextRelease: true` — resolve in the next release after the current
 *   commit. Commonly used when the fix is merged but not yet tagged.
 * - `inCommit` — resolve tied to a specific commit SHA. Sentry resolves
 *   once a release containing the commit is created.
 */
export type ResolveStatusDetails =
  | { inRelease: string }
  | { inNextRelease: true }
  | { inCommit: string };

/**
 * Sentinel string meaning "resolve in the next release (tied to HEAD)".
 * Chosen to never clash with a real version string — `@` is not a valid
 * character in semver or Sentry release slugs.
 */
export const RESOLVE_NEXT_RELEASE_SENTINEL = "@next";

/**
 * Prefix meaning "resolve in this commit SHA" for {@link parseResolveSpec}.
 * `commit:abc123` → `{ inCommit: "abc123" }`.
 */
export const RESOLVE_COMMIT_PREFIX = "commit:";

/**
 * Parse an `--in` resolution-spec string into a {@link ResolveStatusDetails}
 * object. Grammar (see command docs):
 *
 * - `@next`           → `{ inNextRelease: true }`
 * - `commit:<sha>`    → `{ inCommit: <sha> }`
 * - anything else     → `{ inRelease: <value> }`
 *
 * Empty/whitespace-only input returns `null` (treated as "no spec" by the
 * caller, which resolves immediately without release tracking).
 *
 * @throws {ApiError} When a `commit:` prefix is given without a SHA.
 */
export function parseResolveSpec(
  spec: string | undefined
): ResolveStatusDetails | null {
  if (!spec) {
    return null;
  }
  const trimmed = spec.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === RESOLVE_NEXT_RELEASE_SENTINEL) {
    return { inNextRelease: true };
  }
  if (trimmed.startsWith(RESOLVE_COMMIT_PREFIX)) {
    const sha = trimmed.slice(RESOLVE_COMMIT_PREFIX.length).trim();
    if (!sha) {
      throw new ValidationError(
        `Invalid --in spec: expected a commit SHA after 'commit:' (got '${spec}').`,
        "in"
      );
    }
    return { inCommit: sha };
  }
  return { inRelease: trimmed };
}

/**
 * Update an issue's status.
 *
 * When `status === "resolved"`, optional `statusDetails` can pin the fix
 * to a release or commit (see {@link ResolveStatusDetails}). Without
 * `statusDetails`, the issue is resolved immediately with no regression
 * tracking — equivalent to clicking "Resolve" in the Sentry UI.
 *
 * When `options.orgSlug` is provided, the request is routed to that org's
 * region via the org-scoped endpoint. Without it, falls back to the legacy
 * global `/issues/{id}/` endpoint (works but not region-aware).
 */
export async function updateIssueStatus(
  issueId: string,
  status: "resolved" | "unresolved" | "ignored",
  options?: {
    statusDetails?: ResolveStatusDetails;
    orgSlug?: string;
  }
): Promise<SentryIssue> {
  const body: Record<string, unknown> = { status };
  if (options?.statusDetails) {
    body.statusDetails = options.statusDetails;
  }
  if (options?.orgSlug) {
    // Region-aware org-scoped endpoint — preferred when org is known.
    const regionUrl = await resolveOrgRegion(options.orgSlug);
    const { data } = await apiRequestToRegion<SentryIssue>(
      regionUrl,
      `/organizations/${encodeURIComponent(options.orgSlug)}/issues/${encodeURIComponent(issueId)}/`,
      { method: "PUT", body }
    );
    return data;
  }
  // Legacy global endpoint — works without org but not region-aware.
  return apiRequest<SentryIssue>(`/issues/${encodeURIComponent(issueId)}/`, {
    method: "PUT",
    body,
  });
}

/** Result of a successful issue-merge operation. */
export type MergeIssuesResult = {
  /** Numeric group ID that the merged issues were consolidated into. */
  parent: string;
  /** Numeric group IDs that were merged into the parent (excludes parent). */
  children: string[];
};

/**
 * Merge multiple issues into a single canonical group.
 *
 * Sentry auto-picks the canonical parent (typically the largest by event
 * count). Future events with fingerprints previously matching any of the
 * children will flow into the parent group.
 *
 * @param orgSlug - Organization slug (required for the bulk mutate endpoint)
 * @param groupIds - At least 2 numeric group IDs to merge
 * @throws {ApiError} When fewer than 2 IDs are provided, or the API rejects
 *   (e.g. `"Only error issues can be merged."` for non-error issue types)
 */
export async function mergeIssues(
  orgSlug: string,
  groupIds: readonly string[]
): Promise<MergeIssuesResult> {
  if (groupIds.length < 2) {
    throw new ValidationError(
      `Need at least 2 issues to merge (got ${groupIds.length}).`
    );
  }
  // The bulk mutate endpoint accepts repeated `?id=X` query params plus a
  // `{merge: 1}` body. The SDK wraps this but its typed `query` shape
  // doesn't expose the array semantics cleanly, so use raw request.
  const regionUrl = await resolveOrgRegion(orgSlug);
  const query = groupIds.map((id) => `id=${encodeURIComponent(id)}`).join("&");
  const path = `/organizations/${encodeURIComponent(orgSlug)}/issues/?${query}`;
  type MergeResponse = { merge: MergeIssuesResult };
  const { data } = await apiRequestToRegion<MergeResponse>(regionUrl, path, {
    method: "PUT",
    body: { merge: 1 },
  });
  return data.merge;
}

/**
 * Resolve a share ID to basic issue data via the public share endpoint.
 *
 * This endpoint does not require authentication and is not org-scoped.
 * The response includes the numeric `groupID` needed to fetch full issue
 * details via the authenticated API.
 *
 * @param baseUrl - The Sentry instance base URL (from the share URL)
 * @param shareId - The share ID extracted from the share URL
 * @returns Object containing the numeric groupID
 * @throws {ApiError} When the share link is expired, disabled, or invalid
 */
export async function getSharedIssue(
  baseUrl: string,
  shareId: string
): Promise<{ groupID: string }> {
  const url = `${baseUrl}/api/0/shared/issues/${encodeURIComponent(shareId)}/`;
  const headers = new Headers({ "Content-Type": "application/json" });
  applyCustomHeaders(headers);
  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      throw new ApiError(
        "Share link not found or expired",
        404,
        "The share link may have been disabled by the issue owner.\n" +
          "  Ask them to re-enable sharing, or use the issue ID directly.",
        `shared/issues/${shareId}`
      );
    }
    throw new ApiError(
      "Failed to resolve share link",
      response.status,
      undefined,
      `shared/issues/${shareId}`
    );
  }

  return (await response.json()) as { groupID: string };
}
