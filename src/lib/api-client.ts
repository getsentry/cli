/**
 * Sentry API Client
 *
 * Wraps @sentry/api SDK functions with multi-region support,
 * telemetry, and custom error handling.
 *
 * Uses @sentry/api for type-safe API calls to public endpoints.
 * Falls back to raw requests for internal/undocumented endpoints.
 */

import type { ListAnOrganizationSissuesData } from "@sentry/api";
import {
  addAnOrganizationMemberToATeam,
  createANewProject,
  createANewTeam,
  listAnOrganization_sIssues,
  listAnOrganization_sProjects,
  listAnOrganization_sRepositories,
  listAnOrganization_sTeams,
  listAProject_sClientKeys,
  listAProject_sTeams,
  queryExploreEventsInTableFormat,
  resolveAShortId,
  retrieveAnEventForAProject,
  retrieveAnIssue,
  retrieveAnIssueEvent,
  retrieveAnOrganization,
  retrieveAProject,
  retrieveSeerIssueFixState,
  listYourOrganizations as sdkListOrganizations,
  resolveAnEventId as sdkResolveAnEventId,
  startSeerIssueFix,
} from "@sentry/api";
// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import type { z } from "zod";

import {
  type CustomerTrialInfo,
  CustomerTrialInfoSchema,
  DetailedLogsResponseSchema,
  type DetailedSentryLog,
  LogsResponseSchema,
  type ProductTrial,
  type ProjectKey,
  type Region,
  type SentryEvent,
  type SentryIssue,
  type SentryLog,
  type SentryOrganization,
  type SentryProject,
  type SentryRepository,
  type SentryTeam,
  type SentryUser,
  SentryUserSchema,
  type TraceLog,
  TraceLogsResponseSchema,
  type TraceSpan,
  type TransactionListItem,
  type TransactionsResponse,
  TransactionsResponseSchema,
  type UserRegionsResponse,
  UserRegionsResponseSchema,
} from "../types/index.js";

import type { AutofixResponse, AutofixState } from "../types/seer.js";
import {
  ApiError,
  AuthError,
  type AuthGuardSuccess,
  stringifyUnknown,
  withAuthGuard,
} from "./errors.js";
import { logger } from "./logger.js";
import { resolveOrgRegion } from "./region.js";
import {
  getApiBaseUrl,
  getControlSiloUrl,
  getDefaultSdkConfig,
  getSdkConfig,
} from "./sentry-client.js";
import { isAllDigits } from "./utils.js";

// Helpers

type ApiRequestOptions<T = unknown> = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  /** Query parameters. String arrays create repeated keys (e.g., tags=1&tags=2) */
  params?: Record<string, string | number | boolean | string[] | undefined>;
  /** Optional Zod schema for runtime validation of response data */
  schema?: z.ZodType<T>;
};

/**
 * Throw an ApiError from a failed @sentry/api SDK response.
 *
 * @param error - The error object from the SDK (contains status code and detail)
 * @param response - The raw Response object
 * @param context - Human-readable context for the error message
 */
function throwApiError(
  error: unknown,
  response: Response | undefined,
  context: string
): never {
  const status = response?.status ?? 0;
  const detail =
    error && typeof error === "object" && "detail" in error
      ? stringifyUnknown((error as { detail: unknown }).detail)
      : stringifyUnknown(error);
  throw new ApiError(
    `${context}: ${status} ${response?.statusText ?? "Unknown"}`,
    status,
    detail
  );
}

/**
 * Unwrap an @sentry/api SDK result, throwing ApiError on failure.
 *
 * When `throwOnError` is false (our default), the SDK catches errors from
 * the fetch function and returns them in `{ error }`. This includes our
 * AuthError from refreshToken(). We must re-throw known error types (AuthError,
 * ApiError) directly so callers can distinguish auth failures from API errors.
 *
 * @param result - The result from an SDK function call
 * @param context - Human-readable context for error messages
 * @returns The data from the successful response
 */
function unwrapResult<T>(
  result: { data: T; error: undefined } | { data: undefined; error: unknown },
  context: string
): T {
  const { data, error } = result as {
    data: unknown;
    error: unknown;
    response?: Response;
  };

  if (error !== undefined) {
    // Preserve known error types that were caught by the SDK from our fetch function
    if (error instanceof AuthError || error instanceof ApiError) {
      throw error;
    }
    // The @sentry/api SDK always includes `response` on the returned object in
    // the default "fields" responseStyle (see createClient request() in the SDK
    // source — it spreads `{ request, response }` into every return value).
    // The cast is typed as optional only because the SDK's TypeScript types omit
    // `response` from the return type, not because it can be absent at runtime.
    const response = (result as { response?: Response }).response;
    throwApiError(error, response, context);
  }

  return data as T;
}

/**
 * Unwrap an @sentry/api SDK result AND extract pagination from the Link header.
 *
 * Unlike {@link unwrapResult} which discards the Response, this preserves the
 * Link header for cursor-based pagination. Use for SDK-backed paginated endpoints.
 *
 * @param result - The result from an SDK function call (includes `response`)
 * @param context - Human-readable context for error messages
 * @returns Data and optional next-page cursor
 */
function unwrapPaginatedResult<T>(
  result: { data: T; error: undefined } | { data: undefined; error: unknown },
  context: string
): PaginatedResponse<T> {
  const response = (result as { response?: Response }).response;
  const data = unwrapResult(result, context);
  const { nextCursor } = parseLinkHeader(response?.headers.get("link") ?? null);
  return { data, nextCursor };
}

/**
 * Build URLSearchParams from an options object, filtering out undefined values.
 * Supports string arrays for repeated keys (e.g., { tags: ["a", "b"] } → tags=a&tags=b).
 *
 * @param params - Key-value pairs to convert to search params
 * @returns URLSearchParams instance, or undefined if no valid params
 * @internal Exported for testing
 */
export function buildSearchParams(
  params?: Record<string, string | number | boolean | string[] | undefined>
): URLSearchParams | undefined {
  if (!params) {
    return;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, item);
      }
    } else {
      searchParams.set(key, String(value));
    }
  }

  return searchParams.toString() ? searchParams : undefined;
}

/**
 * Get SDK config for an organization's region.
 * Resolves the org's region URL and returns the config.
 */
async function getOrgSdkConfig(orgSlug: string) {
  const regionUrl = await resolveOrgRegion(orgSlug);
  return getSdkConfig(regionUrl);
}

// Raw request functions (for internal/generic endpoints)

/**
 * Extract the value of a named attribute from a Link header segment.
 * Parses `key="value"` pairs using string operations instead of regex
 * for robustness and performance.
 *
 * @param segment - A single Link header segment (e.g., `<url>; rel="next"; cursor="abc"`)
 * @param attr - The attribute name to extract (e.g., "rel", "cursor")
 * @returns The attribute value, or undefined if not found
 */
function extractLinkAttr(segment: string, attr: string): string | undefined {
  const prefix = `${attr}="`;
  const start = segment.indexOf(prefix);
  if (start === -1) {
    return;
  }
  const valueStart = start + prefix.length;
  const end = segment.indexOf('"', valueStart);
  if (end === -1) {
    return;
  }
  return segment.slice(valueStart, end);
}

/**
 * Maximum number of pages to follow when auto-paginating.
 *
 * Safety limit to prevent runaway pagination when the API returns an unexpectedly
 * large number of pages. At API_MAX_PER_PAGE items/page this allows up to 5,000 items, which
 * covers even the largest organizations. Override with SENTRY_MAX_PAGINATION_PAGES
 * env var for edge cases.
 */
const MAX_PAGINATION_PAGES = Math.max(
  1,
  Number(process.env.SENTRY_MAX_PAGINATION_PAGES) || 50
);

/**
 * Sentry API's maximum items per page.
 * Requests for more items are silently capped server-side.
 */
export const API_MAX_PER_PAGE = 100;

/**
 * Paginated API response with cursor metadata.
 * More pages exist when `nextCursor` is defined.
 */
export type PaginatedResponse<T> = {
  /** The response data */
  data: T;
  /** Cursor for fetching the next page (undefined if no more pages) */
  nextCursor?: string;
};

/**
 * Parse Sentry's RFC 5988 Link response header to extract pagination cursors.
 *
 * Sentry Link header format:
 * `<url>; rel="next"; results="true"; cursor="1735689600000:0:0"`
 *
 * @param header - Raw Link header string
 * @returns Parsed pagination info with next cursor if available
 */
export function parseLinkHeader(header: string | null): {
  nextCursor?: string;
} {
  if (!header) {
    return {};
  }

  // Split on comma to get individual link entries
  for (const part of header.split(",")) {
    const rel = extractLinkAttr(part, "rel");
    const results = extractLinkAttr(part, "results");
    const cursor = extractLinkAttr(part, "cursor");

    if (rel === "next" && results === "true" && cursor) {
      return { nextCursor: cursor };
    }
  }

  return {};
}

/**
 * Make an authenticated request to a specific Sentry region.
 * Returns both parsed response data and raw headers for pagination support.
 * Used for internal endpoints not covered by @sentry/api SDK functions.
 *
 * @param regionUrl - The region's base URL (e.g., https://us.sentry.io)
 * @param endpoint - API endpoint path (e.g., "/users/me/regions/")
 * @param options - Request options
 * @returns Parsed data and response headers
 */
export async function apiRequestToRegion<T>(
  regionUrl: string,
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<{ data: T; headers: Headers }> {
  const { method = "GET", body, params, schema } = options;
  const config = getSdkConfig(regionUrl);

  const searchParams = buildSearchParams(params);
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint.slice(1)
    : endpoint;
  const queryString = searchParams ? `?${searchParams.toString()}` : "";
  // getSdkConfig.baseUrl is the plain region URL; add /api/0/ for raw requests
  const url = `${config.baseUrl}/api/0/${normalizedEndpoint}${queryString}`;

  const fetchFn = config.fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const response = await fetchFn(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text) as { detail?: string };
        detail = parsed.detail ?? JSON.stringify(parsed);
      } catch {
        detail = text;
      }
    } catch {
      detail = response.statusText;
    }
    throw new ApiError(
      `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      detail
    );
  }

  const data = await response.json();

  if (schema) {
    const result = schema.safeParse(data);
    if (!result.success) {
      // Attach structured Zod issues to the Sentry event so we can diagnose
      // exactly which field(s) failed validation — the ApiError.detail string
      // alone may not be visible in the Sentry issue overview.
      Sentry.setContext("zod_validation", {
        endpoint,
        status: response.status,
        issues: result.error.issues.slice(0, 10),
      });
      throw new ApiError(
        `Unexpected response format from ${endpoint}`,
        response.status,
        result.error.message
      );
    }
    return { data: result.data, headers: response.headers };
  }

  return { data: data as T, headers: response.headers };
}

/**
 * Make an authenticated request to the default Sentry API.
 *
 * @param endpoint - API endpoint path (e.g., "/organizations/")
 * @param options - Request options including method, body, query params, and validation schema
 * @returns Parsed JSON response (validated if schema provided)
 * @throws {AuthError} When not authenticated
 * @throws {ApiError} On API errors
 */
export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<T> {
  const { data } = await apiRequestToRegion<T>(
    getApiBaseUrl(),
    endpoint,
    options
  );
  return data;
}

/**
 * Make a raw API request that returns full response details.
 * Unlike apiRequest, this does not throw on non-2xx responses.
 * Used by the 'sentry api' command for direct API access.
 *
 * @param endpoint - API endpoint path (e.g., "/organizations/")
 * @param options - Request options including method, body, params, and custom headers
 * @returns Response status, headers, and parsed body
 * @throws {AuthError} Only on authentication failure (not on API errors)
 */
export async function rawApiRequest(
  endpoint: string,
  options: ApiRequestOptions & { headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const { method = "GET", body, params, headers: customHeaders = {} } = options;

  const config = getDefaultSdkConfig();

  const searchParams = buildSearchParams(params);
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint.slice(1)
    : endpoint;
  const queryString = searchParams ? `?${searchParams.toString()}` : "";
  // getSdkConfig.baseUrl is the plain region URL; add /api/0/ for raw requests
  const url = `${config.baseUrl}/api/0/${normalizedEndpoint}${queryString}`;

  // Build request headers and body.
  // String bodies: no Content-Type unless the caller explicitly provides one.
  // Object bodies: application/json (auto-stringified).
  const isStringBody = typeof body === "string";
  const hasContentType = Object.keys(customHeaders).some(
    (k) => k.toLowerCase() === "content-type"
  );

  const headers: Record<string, string> = { ...customHeaders };
  if (!(isStringBody || hasContentType) && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let requestBody: string | undefined;
  if (body !== undefined) {
    requestBody = isStringBody ? body : JSON.stringify(body);
  }

  const fetchFn = config.fetch;
  const response = await fetchFn(url, {
    method,
    headers,
    body: requestBody,
  });

  const text = await response.text();
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }

  return {
    status: response.status,
    headers: response.headers,
    body: responseBody,
  };
}

// Organization functions

/**
 * Get the list of regions the user has organization membership in.
 * This endpoint is on the control silo (sentry.io) and returns all regions.
 *
 * @returns Array of regions with name and URL
 */
export async function getUserRegions(): Promise<Region[]> {
  // /users/me/regions/ is an internal endpoint - use raw request
  const { data } = await apiRequestToRegion<UserRegionsResponse>(
    getControlSiloUrl(),
    "/users/me/regions/",
    { schema: UserRegionsResponseSchema }
  );
  return data.regions;
}

/**
 * List organizations in a specific region.
 *
 * @param regionUrl - The region's base URL
 * @returns Organizations in that region
 */
export async function listOrganizationsInRegion(
  regionUrl: string
): Promise<SentryOrganization[]> {
  const config = getSdkConfig(regionUrl);

  const result = await sdkListOrganizations({
    ...config,
  });

  const data = unwrapResult(result, "Failed to list organizations");
  return data as unknown as SentryOrganization[];
}

/**
 * List all organizations the user has access to across all regions.
 * Performs a fan-out to each region and combines results.
 * Also caches the region URL for each organization.
 */
export async function listOrganizations(): Promise<SentryOrganization[]> {
  const { setOrgRegions } = await import("./db/regions.js");

  // Self-hosted instances may not have the regions endpoint (404)
  const regionsResult = await withAuthGuard(() => getUserRegions());
  const regions = regionsResult.ok ? regionsResult.value : ([] as Region[]);

  if (regions.length === 0) {
    // Fall back to default API for self-hosted instances
    return listOrganizationsInRegion(getApiBaseUrl());
  }

  const results = await Promise.all(
    regions.map(async (region) => {
      try {
        const orgs = await listOrganizationsInRegion(region.url);
        return orgs.map((org) => ({
          org,
          regionUrl: org.links?.regionUrl ?? region.url,
        }));
      } catch {
        return [];
      }
    })
  );

  const flatResults = results.flat();
  const orgs = flatResults.map((r) => r.org);

  const regionEntries = flatResults.map((r) => ({
    slug: r.org.slug,
    regionUrl: r.regionUrl,
    orgId: r.org.id,
  }));
  await setOrgRegions(regionEntries);

  return orgs;
}

/**
 * Get a specific organization.
 * Uses region-aware routing for multi-region support.
 */
export async function getOrganization(
  orgSlug: string
): Promise<SentryOrganization> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveAnOrganization({
    ...config,
    path: { organization_id_or_slug: orgSlug },
  });

  const data = unwrapResult(result, "Failed to get organization");
  return data as unknown as SentryOrganization;
}

// Project functions

/**
 * List all projects in an organization.
 * Automatically paginates through all API pages to return the complete list.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug
 * @returns All projects in the organization
 */
export async function listProjects(orgSlug: string): Promise<SentryProject[]> {
  const config = await getOrgSdkConfig(orgSlug);
  const allResults: SentryProject[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const result = await listAnOrganization_sProjects({
      ...config,
      path: { organization_id_or_slug: orgSlug },
      // per_page is supported by Sentry's pagination framework at runtime
      // but not yet in the OpenAPI spec
      query: { cursor, per_page: API_MAX_PER_PAGE } as { cursor?: string },
    });

    const { data, nextCursor } = unwrapPaginatedResult<SentryProject[]>(
      result as
        | { data: SentryProject[]; error: undefined }
        | { data: undefined; error: unknown },
      "Failed to list projects"
    );
    allResults.push(...data);

    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;

    if (page === MAX_PAGINATION_PAGES - 1) {
      logger.warn(
        `Pagination limit reached (${MAX_PAGINATION_PAGES} pages, ${allResults.length} items). ` +
          "Results may be incomplete for this organization."
      );
    }
  }

  return allResults;
}

/**
 * List projects in an organization with pagination control.
 * Returns a single page of results with cursor metadata for manual pagination.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug
 * @param options - Pagination options
 * @returns Single page of projects with cursor metadata
 */
export async function listProjectsPaginated(
  orgSlug: string,
  options: { cursor?: string; perPage?: number } = {}
): Promise<PaginatedResponse<SentryProject[]>> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sProjects({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    query: {
      cursor: options.cursor,
      per_page: options.perPage ?? API_MAX_PER_PAGE,
    } as { cursor?: string },
  });

  return unwrapPaginatedResult<SentryProject[]>(
    result as
      | { data: SentryProject[]; error: undefined }
      | { data: undefined; error: unknown },
    "Failed to list projects"
  );
}

/** Project with its organization context */
export type ProjectWithOrg = SentryProject & {
  /** Organization slug the project belongs to */
  orgSlug: string;
};

/**
 * List repositories in an organization.
 * Uses region-aware routing for multi-region support.
 */
export async function listRepositories(
  orgSlug: string
): Promise<SentryRepository[]> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sRepositories({
    ...config,
    path: { organization_id_or_slug: orgSlug },
  });

  const data = unwrapResult(result, "Failed to list repositories");
  return data as unknown as SentryRepository[];
}

/**
 * List teams in an organization.
 * Uses region-aware routing for multi-region support.
 */
export async function listTeams(orgSlug: string): Promise<SentryTeam[]> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sTeams({
    ...config,
    path: { organization_id_or_slug: orgSlug },
  });

  const data = unwrapResult(result, "Failed to list teams");
  return data as unknown as SentryTeam[];
}

/** Request body for creating a new project */
type CreateProjectBody = {
  name: string;
  platform?: string;
  default_rules?: boolean;
};

/**
 * Create a new project in an organization under a team.
 *
 * @param orgSlug - The organization slug
 * @param teamSlug - The team slug to create the project under
 * @param body - Project creation parameters (name is required)
 * @returns The created project
 * @throws {ApiError} 409 if a project with the same slug already exists
 */
export async function createProject(
  orgSlug: string,
  teamSlug: string,
  body: CreateProjectBody
): Promise<SentryProject> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await createANewProject({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      team_id_or_slug: teamSlug,
    },
    body,
  });
  const data = unwrapResult(result, "Failed to create project");
  return data as unknown as SentryProject;
}

/**
 * Create a new team in an organization and add the current user as a member.
 *
 * The Sentry API does not automatically add the creator to a new team,
 * so we follow up with an `addMemberToTeam("me")` call. The member-add
 * is best-effort — if it fails (e.g., permissions), the team is still
 * returned successfully.
 *
 * @param orgSlug - The organization slug
 * @param slug - Team slug (also used as display name)
 * @returns The created team
 */
export async function createTeam(
  orgSlug: string,
  slug: string
): Promise<SentryTeam> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await createANewTeam({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    body: { slug },
  });
  const data = unwrapResult(result, "Failed to create team");
  const team = data as unknown as SentryTeam;

  // Best-effort: add the current user to the team
  try {
    await addMemberToTeam(orgSlug, team.slug, "me");
  } catch (error) {
    Sentry.captureException(error, {
      extra: { orgSlug, teamSlug: team.slug, context: "auto-add member" },
    });
    logger.warn(
      `Team '${team.slug}' was created but you could not be added as a member.`
    );
  }

  return team;
}

/**
 * Add an organization member to a team.
 *
 * @param orgSlug - The organization slug
 * @param teamSlug - The team slug
 * @param memberId - The member ID (use "me" for the current user)
 */
export async function addMemberToTeam(
  orgSlug: string,
  teamSlug: string,
  memberId: string
): Promise<void> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await addAnOrganizationMemberToATeam({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      member_id: memberId,
      team_id_or_slug: teamSlug,
    },
  });
  unwrapResult(result, "Failed to add member to team");
}

/**
 * List teams in an organization with pagination control.
 * Returns a single page of results with cursor metadata.
 *
 * @param orgSlug - Organization slug
 * @param options - Pagination options
 * @returns Single page of teams with cursor metadata
 */
export async function listTeamsPaginated(
  orgSlug: string,
  options: { cursor?: string; perPage?: number } = {}
): Promise<PaginatedResponse<SentryTeam[]>> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sTeams({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    // per_page is supported by Sentry's pagination framework at runtime
    // but not yet in the OpenAPI spec
    query: {
      cursor: options.cursor,
      per_page: options.perPage ?? 25,
    } as { cursor?: string },
  });

  return unwrapPaginatedResult<SentryTeam[]>(
    result as
      | { data: SentryTeam[]; error: undefined }
      | { data: undefined; error: unknown },
    "Failed to list teams"
  );
}

/**
 * List teams that have access to a specific project.
 *
 * Uses the project-scoped endpoint (`/projects/{org}/{project}/teams/`) which
 * returns only the teams with access to that project, not all teams in the org.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug
 * @returns Teams with access to the project
 */
export async function listProjectTeams(
  orgSlug: string,
  projectSlug: string
): Promise<SentryTeam[]> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await listAProject_sTeams({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      project_id_or_slug: projectSlug,
    },
  });
  const data = unwrapResult(result, "Failed to list project teams");
  return data as unknown as SentryTeam[];
}

/**
 * List repositories in an organization with pagination control.
 * Returns a single page of results with cursor metadata.
 *
 * @param orgSlug - Organization slug
 * @param options - Pagination options
 * @returns Single page of repositories with cursor metadata
 */
export async function listRepositoriesPaginated(
  orgSlug: string,
  options: { cursor?: string; perPage?: number } = {}
): Promise<PaginatedResponse<SentryRepository[]>> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sRepositories({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    // per_page is supported by Sentry's pagination framework at runtime
    // but not yet in the OpenAPI spec
    query: {
      cursor: options.cursor,
      per_page: options.perPage ?? 25,
    } as { cursor?: string },
  });

  return unwrapPaginatedResult<SentryRepository[]>(
    result as
      | { data: SentryRepository[]; error: undefined }
      | { data: undefined; error: unknown },
    "Failed to list repositories"
  );
}

/** Result of searching for projects by slug across all organizations. */
export type ProjectSearchResult = {
  /** Matching projects with their org context */
  projects: ProjectWithOrg[];
  /** All organizations fetched during the search — reuse for fallback checks */
  orgs: SentryOrganization[];
};

/**
 * Search for projects matching a slug across all accessible organizations.
 *
 * Used for `sentry issue list <project-name>` when no org is specified.
 * Searches all orgs the user has access to and returns matches.
 *
 * Returns both the matching projects and the full org list that was fetched,
 * so callers can check whether a slug matches an organization without an
 * additional API call (useful for "did you mean org/?" fallbacks).
 *
 * @param projectSlug - Project slug to search for (exact match)
 * @returns Matching projects and the org list used during search
 */
export async function findProjectsBySlug(
  projectSlug: string
): Promise<ProjectSearchResult> {
  const orgs = await listOrganizations();
  const isNumericId = isAllDigits(projectSlug);

  // Direct lookup in parallel — one API call per org instead of paginating all projects
  const searchResults = await Promise.all(
    orgs.map((org) =>
      withAuthGuard(async () => {
        const project = await getProject(org.slug, projectSlug);
        // The API accepts project_id_or_slug, so a numeric input could
        // resolve by ID instead of slug. When the input is all digits,
        // accept the match (the user passed a numeric project ID).
        // For non-numeric inputs, verify the slug actually matches to
        // avoid false positives from coincidental ID collisions.
        // Note: Sentry enforces that project slugs must start with a letter,
        // so an all-digits input can only ever be a numeric ID, never a slug.
        if (!isNumericId && project.slug !== projectSlug) {
          return null;
        }
        return { ...project, orgSlug: org.slug };
      })
    )
  );

  return {
    projects: searchResults
      .filter((r): r is AuthGuardSuccess<ProjectWithOrg | null> => r.ok)
      .map((r) => r.value)
      .filter((v): v is ProjectWithOrg => v !== null),
    orgs,
  };
}

/**
 * Escape special regex characters in a string.
 * Uses native RegExp.escape if available (Node.js 23.6+, Bun), otherwise polyfills.
 */
const escapeRegex: (str: string) => string =
  typeof RegExp.escape === "function"
    ? RegExp.escape
    : (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Check if two strings match with word-boundary semantics (bidirectional).
 *
 * Returns true if either:
 * - `a` appears in `b` at a word boundary
 * - `b` appears in `a` at a word boundary
 *
 * @example
 * matchesWordBoundary("cli", "cli-website")  // true: "cli" in "cli-website"
 * matchesWordBoundary("sentry-docs", "docs") // true: "docs" in "sentry-docs"
 * matchesWordBoundary("cli", "eclipse")      // false: no word boundary
 *
 * @internal Exported for testing
 */
export function matchesWordBoundary(a: string, b: string): boolean {
  const aInB = new RegExp(`\\b${escapeRegex(a)}\\b`, "i");
  const bInA = new RegExp(`\\b${escapeRegex(b)}\\b`, "i");
  return aInB.test(b) || bInA.test(a);
}

/**
 * Find projects matching a pattern with bidirectional word-boundary matching.
 * Used for directory name inference when DSN detection fails.
 *
 * Uses `\b` regex word boundary, which matches:
 * - Start/end of string
 * - Between word char (`\w`) and non-word char (like "-")
 *
 * Matching is bidirectional:
 * - Directory name in project slug: dir "cli" matches project "cli-website"
 * - Project slug in directory name: project "docs" matches dir "sentry-docs"
 *
 * @param pattern - Directory name to match against project slugs
 * @returns Array of matching projects with their org context
 */
export async function findProjectsByPattern(
  pattern: string
): Promise<ProjectWithOrg[]> {
  const orgs = await listOrganizations();

  const searchResults = await Promise.all(
    orgs.map((org) =>
      withAuthGuard(async () => {
        const projects = await listProjects(org.slug);
        return projects
          .filter((p) => matchesWordBoundary(pattern, p.slug))
          .map((p) => ({ ...p, orgSlug: org.slug }));
      })
    )
  );

  return searchResults
    .filter((r): r is AuthGuardSuccess<ProjectWithOrg[]> => r.ok)
    .flatMap((r) => r.value);
}

/**
 * Find a project by DSN public key.
 *
 * Uses the /api/0/projects/ endpoint with query=dsn:<key> to search
 * across all accessible projects in all regions. This works for both
 * SaaS and self-hosted DSNs, even when the org ID is not embedded in the DSN.
 *
 * @param publicKey - The DSN public key (username portion of DSN URL)
 * @returns The matching project, or null if not found
 */
export async function findProjectByDsnKey(
  publicKey: string
): Promise<SentryProject | null> {
  const regionsResult = await withAuthGuard(() => getUserRegions());
  const regions = regionsResult.ok ? regionsResult.value : ([] as Region[]);

  if (regions.length === 0) {
    // Fall back to default region for self-hosted
    // This uses an internal query parameter not in the public API
    const { data: projects } = await apiRequestToRegion<SentryProject[]>(
      getApiBaseUrl(),
      "/projects/",
      { params: { query: `dsn:${publicKey}` } }
    );
    return projects[0] ?? null;
  }

  const results = await Promise.all(
    regions.map(async (region) => {
      try {
        const { data } = await apiRequestToRegion<SentryProject[]>(
          region.url,
          "/projects/",
          { params: { query: `dsn:${publicKey}` } }
        );
        return data;
      } catch {
        return [];
      }
    })
  );

  for (const projects of results) {
    if (projects.length > 0) {
      return projects[0] ?? null;
    }
  }

  return null;
}

/**
 * Get a specific project.
 * Uses region-aware routing for multi-region support.
 */
export async function getProject(
  orgSlug: string,
  projectSlug: string
): Promise<SentryProject> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveAProject({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      project_id_or_slug: projectSlug,
    },
  });

  const data = unwrapResult(result, "Failed to get project");
  return data as unknown as SentryProject;
}

/**
 * Get project keys (DSNs) for a project.
 * Uses region-aware routing for multi-region support.
 */
export async function getProjectKeys(
  orgSlug: string,
  projectSlug: string
): Promise<ProjectKey[]> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAProject_sClientKeys({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      project_id_or_slug: projectSlug,
    },
  });

  const data = unwrapResult(result, "Failed to get project keys");
  return data as unknown as ProjectKey[];
}

// Issue functions

/**
 * Fetch the primary DSN for a project.
 * Returns the public DSN of the first active key, or null on any error.
 *
 * Best-effort: failures are silently swallowed so callers can treat
 * DSN display as optional (e.g., after project creation or in views).
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug
 * @returns Public DSN string, or null if unavailable
 */
export async function tryGetPrimaryDsn(
  orgSlug: string,
  projectSlug: string
): Promise<string | null> {
  try {
    const keys = await getProjectKeys(orgSlug, projectSlug);
    const activeKey = keys.find((k) => k.isActive);
    return activeKey?.dsn.public ?? keys[0]?.dsn.public ?? null;
  } catch {
    return null;
  }
}

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

// Event functions

/**
 * Get the latest event for an issue.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug (required for multi-region routing)
 * @param issueId - Issue ID (numeric)
 */
export async function getLatestEvent(
  orgSlug: string,
  issueId: string
): Promise<SentryEvent> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveAnIssueEvent({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      issue_id: Number(issueId),
      event_id: "latest",
    },
  });

  const data = unwrapResult(result, "Failed to get latest event");
  return data as unknown as SentryEvent;
}

/**
 * Get a specific event by ID.
 * Uses region-aware routing for multi-region support.
 */
export async function getEvent(
  orgSlug: string,
  projectSlug: string,
  eventId: string
): Promise<SentryEvent> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveAnEventForAProject({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      project_id_or_slug: projectSlug,
      event_id: eventId,
    },
  });

  const data = unwrapResult(result, "Failed to get event");
  return data as unknown as SentryEvent;
}

/**
 * Result of resolving an event ID to an org and project.
 * Includes the full event so the caller can avoid a second API call.
 */
export type ResolvedEvent = {
  org: string;
  project: string;
  event: SentryEvent;
};

/**
 * Resolve an event ID to its org and project using the
 * `/organizations/{org}/eventids/{event_id}/` endpoint.
 *
 * Returns the resolved org, project, and full event on success,
 * or null if the event is not found in the given org.
 */
export async function resolveEventInOrg(
  orgSlug: string,
  eventId: string
): Promise<ResolvedEvent | null> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await sdkResolveAnEventId({
    ...config,
    path: { organization_id_or_slug: orgSlug, event_id: eventId },
  });

  try {
    const data = unwrapResult(result, "Failed to resolve event ID");
    return {
      org: data.organizationSlug,
      project: data.projectSlug,
      event: data.event as unknown as SentryEvent,
    };
  } catch (error) {
    // 404 means the event doesn't exist in this org — not an error
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Search for an event across all accessible organizations by event ID.
 *
 * Fans out to every org in parallel using the eventids resolution endpoint.
 * Returns the first match found, or null if the event is not accessible.
 *
 * @param eventId - The event ID (UUID) to look up
 */
export async function findEventAcrossOrgs(
  eventId: string
): Promise<ResolvedEvent | null> {
  const orgs = await listOrganizations();

  const results = await Promise.allSettled(
    orgs.map((org) => resolveEventInOrg(org.slug, eventId))
  );

  // First pass: return the first successful match
  for (const result of results) {
    if (result.status === "fulfilled" && result.value !== null) {
      return result.value;
    }
  }

  // Second pass (only reached when no org had the event): propagate
  // AuthError since it indicates a global problem (expired/missing token).
  // Transient per-org failures (network, 5xx) are swallowed — they are not
  // global, and if the event existed in any accessible org it would have matched.
  for (const result of results) {
    if (result.status === "rejected" && result.reason instanceof AuthError) {
      throw result.reason;
    }
  }
  return null;
}

/**
 * Get detailed trace with nested children structure.
 * This is an internal endpoint not covered by the public API.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug
 * @param traceId - The trace ID (from event.contexts.trace.trace_id)
 * @param timestamp - Unix timestamp (seconds) from the event's dateCreated
 * @returns Array of root spans with nested children
 */
export async function getDetailedTrace(
  orgSlug: string,
  traceId: string,
  timestamp: number
): Promise<TraceSpan[]> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data } = await apiRequestToRegion<TraceSpan[]>(
    regionUrl,
    `/organizations/${orgSlug}/trace/${traceId}/`,
    {
      params: {
        timestamp,
        limit: 10_000,
        project: -1,
      },
    }
  );
  return data;
}

/** Fields to request from the transactions API */
const TRANSACTION_FIELDS = [
  "trace",
  "id",
  "transaction",
  "timestamp",
  "transaction.duration",
  "project",
];

type ListTransactionsOptions = {
  /** Search query using Sentry query syntax */
  query?: string;
  /** Maximum number of transactions to return */
  limit?: number;
  /** Sort order: "date" (newest first) or "duration" (slowest first) */
  sort?: "date" | "duration";
  /** Time period for transactions (e.g., "7d", "24h") */
  statsPeriod?: string;
  /** Pagination cursor to resume from a previous page */
  cursor?: string;
};

/**
 * List recent transactions for a project.
 * Uses the Explore/Events API with dataset=transactions.
 *
 * Handles project slug vs numeric ID automatically:
 * - Numeric IDs are passed as the `project` parameter
 * - Slugs are added to the query string as `project:{slug}`
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug or numeric ID
 * @param options - Query options (query, limit, sort, statsPeriod, cursor)
 * @returns Paginated response with transaction items and optional next cursor
 */
export async function listTransactions(
  orgSlug: string,
  projectSlug: string,
  options: ListTransactionsOptions = {}
): Promise<PaginatedResponse<TransactionListItem[]>> {
  const isNumericProject = isAllDigits(projectSlug);
  const projectFilter = isNumericProject ? "" : `project:${projectSlug}`;
  const fullQuery = [projectFilter, options.query].filter(Boolean).join(" ");

  const regionUrl = await resolveOrgRegion(orgSlug);

  // Use raw request: the SDK's dataset type doesn't include "transactions"
  const { data: response, headers } =
    await apiRequestToRegion<TransactionsResponse>(
      regionUrl,
      `/organizations/${orgSlug}/events/`,
      {
        params: {
          dataset: "transactions",
          field: TRANSACTION_FIELDS,
          project: isNumericProject ? projectSlug : undefined,
          // Convert empty string to undefined so ky omits the param entirely;
          // sending `query=` causes the Sentry API to behave differently than
          // omitting the parameter.
          query: fullQuery || undefined,
          per_page: options.limit || 10,
          statsPeriod: options.statsPeriod ?? "7d",
          sort:
            options.sort === "duration"
              ? "-transaction.duration"
              : "-timestamp",
          cursor: options.cursor,
        },
        schema: TransactionsResponseSchema,
      }
    );

  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data: response.data, nextCursor };
}

// Issue update functions

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

// Seer AI functions

/**
 * Trigger root cause analysis for an issue using Seer AI.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - The organization slug
 * @param issueId - The numeric Sentry issue ID
 * @returns The trigger response with run_id
 * @throws {ApiError} On API errors (402 = no budget, 403 = not enabled)
 */
export async function triggerRootCauseAnalysis(
  orgSlug: string,
  issueId: string
): Promise<{ run_id: number }> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await startSeerIssueFix({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      issue_id: Number(issueId),
    },
    body: {
      stopping_point: "root_cause",
    },
  });

  const data = unwrapResult(result, "Failed to trigger root cause analysis");
  return data as unknown as { run_id: number };
}

/**
 * Get the current autofix state for an issue.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - The organization slug
 * @param issueId - The numeric Sentry issue ID
 * @returns The autofix state, or null if no autofix has been run
 */
export async function getAutofixState(
  orgSlug: string,
  issueId: string
): Promise<AutofixState | null> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveSeerIssueFixState({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      issue_id: Number(issueId),
    },
  });

  const data = unwrapResult(result, "Failed to get autofix state");
  const autofixResponse = data as unknown as AutofixResponse;
  return autofixResponse.autofix;
}

/**
 * Trigger solution planning for an existing autofix run.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - The organization slug
 * @param issueId - The numeric Sentry issue ID
 * @param runId - The autofix run ID
 * @returns The response from the API
 */
export async function triggerSolutionPlanning(
  orgSlug: string,
  issueId: string,
  runId: number
): Promise<unknown> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data } = await apiRequestToRegion(
    regionUrl,
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    {
      method: "POST",
      body: {
        run_id: runId,
        step: "solution",
      },
    }
  );
  return data;
}

// Product Trial functions

/**
 * Fetch all product trials for an organization.
 *
 * Fetches customer data from the internal `/customers/{org}/` endpoint
 * and returns the `productTrials` array. This is a getsentry SaaS-only
 * endpoint — self-hosted instances will 404, which callers should handle.
 *
 * @param orgSlug - Organization slug
 * @returns Array of product trials (may be empty)
 */
export async function getProductTrials(
  orgSlug: string
): Promise<ProductTrial[]> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<CustomerTrialInfo>(
    regionUrl,
    `/customers/${orgSlug}/`,
    { schema: CustomerTrialInfoSchema }
  );
  return data.productTrials ?? [];
}

/**
 * Start a product trial for the organization.
 *
 * Sends a PUT to the internal `/customers/{org}/product-trial/` endpoint.
 * Any org member with `org:read` or higher permission can start a trial.
 *
 * @param orgSlug - Organization slug
 * @param category - API category name (e.g., "seerUsers", "replays", "transactions")
 * @throws {ApiError} On API errors (e.g., trial already active, permissions)
 */
export async function startProductTrial(
  orgSlug: string,
  category: string
): Promise<void> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  await apiRequestToRegion(regionUrl, `/customers/${orgSlug}/product-trial/`, {
    method: "PUT",
    body: {
      referrer: "sentry-cli",
      productTrial: { category, reasonCode: 0 },
    },
  });
}

// User functions

/**
 * Get the currently authenticated user's information.
 *
 * Uses the `/auth/` endpoint on the control silo, which works with all token
 * types (OAuth, API tokens, OAuth App tokens). Unlike `/users/me/`, this
 * endpoint does not return 403 for OAuth tokens.
 */
export async function getCurrentUser(): Promise<SentryUser> {
  const { data } = await apiRequestToRegion<SentryUser>(
    getControlSiloUrl(),
    "/auth/",
    { schema: SentryUserSchema }
  );
  return data;
}

// Log functions

/** Fields to request from the logs API */
const LOG_FIELDS = [
  "sentry.item_id",
  "trace",
  "severity",
  "timestamp",
  "timestamp_precise",
  "message",
];

type ListLogsOptions = {
  /** Search query using Sentry query syntax */
  query?: string;
  /** Maximum number of log entries to return */
  limit?: number;
  /** Time period for logs (e.g., "90d", "10m") */
  statsPeriod?: string;
  /** Only return logs after this timestamp_precise value (for streaming) */
  afterTimestamp?: number;
};

/**
 * List logs for an organization/project.
 * Uses the Explore/Events API with dataset=logs.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug or numeric ID
 * @param options - Query options (query, limit, statsPeriod)
 * @returns Array of log entries
 */
export async function listLogs(
  orgSlug: string,
  projectSlug: string,
  options: ListLogsOptions = {}
): Promise<SentryLog[]> {
  const isNumericProject = isAllDigits(projectSlug);

  const projectFilter = isNumericProject ? "" : `project:${projectSlug}`;
  const timestampFilter = options.afterTimestamp
    ? `timestamp_precise:>${options.afterTimestamp}`
    : "";

  const fullQuery = [projectFilter, options.query, timestampFilter]
    .filter(Boolean)
    .join(" ");

  const config = await getOrgSdkConfig(orgSlug);

  const result = await queryExploreEventsInTableFormat({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    query: {
      dataset: "logs",
      field: LOG_FIELDS,
      project: isNumericProject ? [Number(projectSlug)] : undefined,
      query: fullQuery || undefined,
      per_page: options.limit || API_MAX_PER_PAGE,
      statsPeriod: options.statsPeriod ?? "7d",
      sort: "-timestamp",
    },
  });

  const data = unwrapResult(result, "Failed to list logs");
  const logsResponse = LogsResponseSchema.parse(data);
  return logsResponse.data;
}

/** All fields to request for detailed log view */
const DETAILED_LOG_FIELDS = [
  "sentry.item_id",
  "timestamp",
  "timestamp_precise",
  "message",
  "severity",
  "trace",
  "project",
  "environment",
  "release",
  "sdk.name",
  "sdk.version",
  "span_id",
  "code.function",
  "code.file.path",
  "code.line.number",
  "sentry.otel.kind",
  "sentry.otel.status_code",
  "sentry.otel.instrumentation_scope.name",
];

/**
 * Fetch a single batch of log entries by their item IDs.
 * Batch size must not exceed {@link API_MAX_PER_PAGE}.
 */
async function getLogsBatch(
  orgSlug: string,
  projectSlug: string,
  batchIds: string[],
  config: Awaited<ReturnType<typeof getOrgSdkConfig>>
): Promise<DetailedSentryLog[]> {
  const query = `project:${projectSlug} sentry.item_id:[${batchIds.join(",")}]`;

  const result = await queryExploreEventsInTableFormat({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    query: {
      dataset: "logs",
      field: DETAILED_LOG_FIELDS,
      query,
      per_page: batchIds.length,
      statsPeriod: "90d",
    },
  });

  const data = unwrapResult(result, "Failed to get log");
  const logsResponse = DetailedLogsResponseSchema.parse(data);
  return logsResponse.data;
}

/**
 * Get one or more log entries by their item IDs.
 * Uses the Explore/Events API with dataset=logs and a filter query.
 * Bracket syntax (`sentry.item_id:[id1,id2,...]`) works for any count including one.
 *
 * When more than {@link API_MAX_PER_PAGE} IDs are requested, the fetch is
 * split into batches to avoid silent API truncation.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug for filtering
 * @param logIds - One or more sentry.item_id values to fetch
 * @returns Array of matching detailed log entries (may be shorter than logIds if some weren't found)
 */
export async function getLogs(
  orgSlug: string,
  projectSlug: string,
  logIds: string[]
): Promise<DetailedSentryLog[]> {
  const config = await getOrgSdkConfig(orgSlug);

  // Single batch — no splitting needed
  if (logIds.length <= API_MAX_PER_PAGE) {
    return getLogsBatch(orgSlug, projectSlug, logIds, config);
  }

  // Split into batches of API_MAX_PER_PAGE and fetch in parallel
  const batches: string[][] = [];
  for (let i = 0; i < logIds.length; i += API_MAX_PER_PAGE) {
    batches.push(logIds.slice(i, i + API_MAX_PER_PAGE));
  }

  const results = await Promise.all(
    batches.map((batch) => getLogsBatch(orgSlug, projectSlug, batch, config))
  );

  return results.flat();
}

// Trace-log functions

type ListTraceLogsOptions = {
  /** Additional search query to filter results (Sentry query syntax) */
  query?: string;
  /** Maximum number of log entries to return (max 9999) */
  limit?: number;
  /**
   * Time period to search in (e.g., "14d", "7d", "24h").
   * Required by the API — without it the response may be empty even when
   * logs exist for the trace. Defaults to "14d".
   */
  statsPeriod?: string;
};

/**
 * List logs associated with a specific trace.
 *
 * Uses the dedicated `/organizations/{org}/trace-logs/` endpoint, which is
 * org-scoped and automatically queries all projects in the org. This is
 * distinct from the Explore/Events logs endpoint (`/events/?dataset=logs`)
 * which does not support filtering by trace ID in query syntax.
 *
 * `statsPeriod` defaults to `"14d"`. Without a stats period the API may
 * return empty results even when logs exist for the trace.
 *
 * @param orgSlug - Organization slug
 * @param traceId - The 32-character hex trace ID
 * @param options - Optional query/limit/statsPeriod overrides
 * @returns Array of trace log entries, ordered newest-first
 */
export async function listTraceLogs(
  orgSlug: string,
  traceId: string,
  options: ListTraceLogsOptions = {}
): Promise<TraceLog[]> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data: response } = await apiRequestToRegion<{ data: TraceLog[] }>(
    regionUrl,
    `/organizations/${orgSlug}/trace-logs/`,
    {
      params: {
        traceId,
        statsPeriod: options.statsPeriod ?? "14d",
        per_page: options.limit ?? API_MAX_PER_PAGE,
        query: options.query,
        sort: "-timestamp",
      },
      schema: TraceLogsResponseSchema,
    }
  );

  return response.data;
}
