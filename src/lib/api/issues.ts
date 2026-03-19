/**
 * Issue API functions
 *
 * Functions for listing, retrieving, and updating Sentry issues.
 */

import type { ListAnOrganizationSissuesData } from "@sentry/api";
import {
  listAnOrganization_sIssues,
  resolveAShortId,
  retrieveAnIssue,
} from "@sentry/api";

import type { SentryIssue } from "../../types/index.js";

import { ApiError } from "../errors.js";

import {
  API_MAX_PER_PAGE,
  apiRequest,
  getOrgSdkConfig,
  MAX_PAGINATION_PAGES,
  type PaginatedResponse,
  unwrapPaginatedResult,
  unwrapResult,
} from "./infrastructure.js";

/**
 * Sort options for issue listing, derived from the @sentry/api SDK types.
 * Uses the SDK type directly for compile-time safety against parameter drift.
 */
export type IssueSort = NonNullable<
  NonNullable<ListAnOrganizationSissuesData["query"]>["sort"]
>;

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
 */
export function getIssue(issueId: string): Promise<SentryIssue> {
  // The @sentry/api SDK's retrieveAnIssue requires org slug in path,
  // but the legacy endpoint /issues/{id}/ works without org context.
  // Use raw request for backward compatibility.
  return apiRequest<SentryIssue>(`/issues/${issueId}/`);
}

/**
 * Get a specific issue by numeric ID, scoped to an organization.
 *
 * Uses the org-scoped SDK endpoint with region-aware routing.
 * Preferred over {@link getIssue} when the org slug is available.
 *
 * @param orgSlug - Organization slug (used for region routing)
 * @param issueId - Numeric issue ID
 */
export async function getIssueInOrg(
  orgSlug: string,
  issueId: string
): Promise<SentryIssue> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await retrieveAnIssue({
    ...config,
    path: { organization_id_or_slug: orgSlug, issue_id: issueId },
  });
  return unwrapResult(result, "Failed to get issue") as unknown as SentryIssue;
}

/**
 * Get an issue by short ID (e.g., SPOTLIGHT-ELECTRON-4D).
 * Requires organization context to resolve the short ID.
 * Uses region-aware routing for multi-region support.
 */
export async function getIssueByShortId(
  orgSlug: string,
  shortId: string
): Promise<SentryIssue> {
  const normalizedShortId = shortId.toUpperCase();
  const config = await getOrgSdkConfig(orgSlug);

  const result = await resolveAShortId({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      issue_id: normalizedShortId,
    },
  });

  const data = unwrapResult(result, "Failed to resolve short ID");

  // resolveAShortId returns a ShortIdLookupResponse with a group (issue)
  const resolved = data as unknown as { group?: SentryIssue };
  if (!resolved.group) {
    throw new ApiError(
      `Short ID ${normalizedShortId} resolved but no issue group returned`,
      404,
      "Issue not found"
    );
  }
  return resolved.group;
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
  shortId: string
): Promise<SentryIssue | null> {
  try {
    return await getIssueByShortId(orgSlug, shortId);
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
