/**
 * Sentry API Client
 *
 * Wraps @sentry/api SDK functions with multi-region support,
 * telemetry, and custom error handling.
 *
 * Uses @sentry/api for type-safe API calls to public endpoints.
 * Falls back to raw requests for internal/undocumented endpoints.
 */

import {
  listAnOrganization_sTeams,
  listAProject_sClientKeys,
  listAProject_sTeams,
  queryExploreEventsInTableFormat,
  resolveAShortId,
  retrieveAnEventForAProject,
  retrieveAnIssueEvent,
  retrieveAnOrganization,
  retrieveAProject,
  retrieveSeerIssueFixState,
  listYourOrganizations as sdkListOrganizations,
  resolveAnEventId as sdkResolveAnEventId,
  startSeerIssueFix,
} from "@sentry/api";
import type { z } from "zod";

import {
  DetailedLogsResponseSchema,
  type DetailedSentryLog,
  LogsResponseSchema,
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
  type TraceSpan,
  type TransactionListItem,
  type TransactionsResponse,
  TransactionsResponseSchema,
  type UserRegionsResponse,
  UserRegionsResponseSchema,
} from "../types/index.js";

import type { AutofixResponse, AutofixState } from "../types/seer.js";
import { ApiError, AuthError, stringifyUnknown } from "./errors.js";
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
    const response = (result as { response?: Response }).response;
    throwApiError(error, response, context);
  }

  return data as T;
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
      // Treat schema validation failures as API errors so they surface cleanly
      // through the central error handler rather than showing a raw ZodError
      // stack trace. This guards against unexpected API response format changes.
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

// Pagination infrastructure for raw API endpoints

/** Regex patterns for extracting org slugs from endpoint paths */
const ORG_ENDPOINT_REGEX = /\/organizations\/([^/]+)\//;
const PROJECT_ENDPOINT_REGEX = /\/projects\/([^/]+)\//;

/**
 * Extract organization slug from an endpoint path.
 * Supports:
 * - `/organizations/{slug}/...` - standard organization endpoints
 * - `/projects/{org}/{project}/...` - project-scoped endpoints
 */
function extractOrgSlugFromEndpoint(endpoint: string): string | null {
  const orgMatch = endpoint.match(ORG_ENDPOINT_REGEX);
  if (orgMatch?.[1]) {
    return orgMatch[1];
  }

  const projectMatch = endpoint.match(PROJECT_ENDPOINT_REGEX);
  if (projectMatch?.[1]) {
    return projectMatch[1];
  }

  return null;
}

/**
 * Make an org-scoped API request that returns pagination metadata.
 * Used for single-page fetches where the caller needs cursor info.
 *
 * The endpoint must contain the org slug in the path (e.g., `/organizations/{slug}/...`).
 * The org slug is extracted to look up the correct region URL.
 *
 * @param endpoint - API endpoint path containing the org slug
 * @param options - Request options
 * @returns Response data with pagination cursor metadata
 */
async function orgScopedRequestPaginated<T>(
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<PaginatedResponse<T>> {
  const orgSlug = extractOrgSlugFromEndpoint(endpoint);
  if (!orgSlug) {
    throw new Error(
      `Cannot extract org slug from endpoint: ${endpoint}. ` +
        "Endpoint must match /organizations/{slug}/..."
    );
  }
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data, headers } = await apiRequestToRegion(
    regionUrl,
    endpoint,
    options
  );
  const { nextCursor } = parseLinkHeader(headers.get("link"));
  return { data, nextCursor };
}

/**
 * Auto-paginate through all pages of an org-scoped API endpoint.
 * Follows cursor links until no more results or the safety limit is reached.
 *
 * @param endpoint - API endpoint path containing the org slug
 * @param options - Request options (schema must validate an array type)
 * @param perPage - Number of items per API page (default: API_MAX_PER_PAGE)
 * @returns Combined array of all results across all pages
 */
async function orgScopedPaginateAll<T>(
  endpoint: string,
  options: ApiRequestOptions<T[]>,
  perPage = API_MAX_PER_PAGE
): Promise<T[]> {
  const allResults: T[] = [];
  let cursor: string | undefined;
  let truncated = false;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const params = { ...options.params, per_page: perPage, cursor };
    const response = await orgScopedRequestPaginated<T[]>(endpoint, {
      ...options,
      params,
    });
    allResults.push(...response.data);

    if (!response.nextCursor) {
      break;
    }
    cursor = response.nextCursor;

    // Detect if we're about to exit due to the safety limit
    if (page === MAX_PAGINATION_PAGES - 1) {
      truncated = true;
    }
  }

  if (truncated) {
    console.error(
      `Warning: Pagination limit reached (${MAX_PAGINATION_PAGES} pages, ${allResults.length} items). ` +
        "Results may be incomplete for this organization."
    );
  }

  return allResults;
}

/**
 * List all organizations the user has access to across all regions.
 * Performs a fan-out to each region and combines results.
 * Also caches the region URL for each organization.
 */
export async function listOrganizations(): Promise<SentryOrganization[]> {
  const { setOrgRegions } = await import("./db/regions.js");

  let regions: Region[];
  try {
    regions = await getUserRegions();
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    // Self-hosted instances may not have the regions endpoint (404)
    regions = [];
  }

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

  const regionEntries: [string, string][] = flatResults.map((r) => [
    r.org.slug,
    r.regionUrl,
  ]);
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
export function listProjects(orgSlug: string): Promise<SentryProject[]> {
  return orgScopedPaginateAll<SentryProject>(
    `/organizations/${orgSlug}/projects/`,
    {}
  );
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
export function listProjectsPaginated(
  orgSlug: string,
  options: { cursor?: string; perPage?: number } = {}
): Promise<PaginatedResponse<SentryProject[]>> {
  return orgScopedRequestPaginated<SentryProject[]>(
    `/organizations/${orgSlug}/projects/`,
    {
      params: {
        per_page: options.perPage ?? API_MAX_PER_PAGE,
        cursor: options.cursor,
      },
    }
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
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data } = await apiRequestToRegion<SentryRepository[]>(
    regionUrl,
    `/organizations/${orgSlug}/repos/`
  );
  return data;
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

/**
 * List teams in an organization with pagination control.
 * Returns a single page of results with cursor metadata.
 *
 * @param orgSlug - Organization slug
 * @param options - Pagination options
 * @returns Single page of teams with cursor metadata
 */
export function listTeamsPaginated(
  orgSlug: string,
  options: { cursor?: string; perPage?: number } = {}
): Promise<PaginatedResponse<SentryTeam[]>> {
  return orgScopedRequestPaginated<SentryTeam[]>(
    `/organizations/${orgSlug}/teams/`,
    {
      params: {
        per_page: options.perPage ?? 25,
        cursor: options.cursor,
      },
    }
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
export function listRepositoriesPaginated(
  orgSlug: string,
  options: { cursor?: string; perPage?: number } = {}
): Promise<PaginatedResponse<SentryRepository[]>> {
  return orgScopedRequestPaginated<SentryRepository[]>(
    `/organizations/${orgSlug}/repos/`,
    {
      params: {
        per_page: options.perPage ?? 25,
        cursor: options.cursor,
      },
    }
  );
}

/**
 * Search for projects matching a slug across all accessible organizations.
 *
 * Used for `sentry issue list <project-name>` when no org is specified.
 * Searches all orgs the user has access to and returns matches.
 *
 * @param projectSlug - Project slug to search for (exact match)
 * @returns Array of matching projects with their org context
 */
export async function findProjectsBySlug(
  projectSlug: string
): Promise<ProjectWithOrg[]> {
  const orgs = await listOrganizations();
  const isNumericId = isAllDigits(projectSlug);

  // Direct lookup in parallel — one API call per org instead of paginating all projects
  const searchResults = await Promise.all(
    orgs.map(async (org) => {
      try {
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
      } catch (error) {
        if (error instanceof AuthError) {
          throw error;
        }
        // 404 or permission errors — project doesn't exist in this org
        return null;
      }
    })
  );

  return searchResults.filter((r): r is ProjectWithOrg => r !== null);
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
    orgs.map(async (org) => {
      try {
        const projects = await listProjects(org.slug);
        return projects
          .filter((p) => matchesWordBoundary(pattern, p.slug))
          .map((p) => ({ ...p, orgSlug: org.slug }));
      } catch (error) {
        if (error instanceof AuthError) {
          throw error;
        }
        return [];
      }
    })
  );

  return searchResults.flat();
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
  let regions: Region[];
  try {
    regions = await getUserRegions();
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    regions = [];
  }

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
 * List issues for a project with pagination control.
 * Returns a single page of results with cursor metadata for manual pagination.
 * Uses the org-scoped endpoint with a `project:{slug}` filter.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug
 * @param options - Query and pagination options
 * @returns Single page of issues with cursor metadata
 */
export function listIssuesPaginated(
  orgSlug: string,
  projectSlug: string,
  options: {
    query?: string;
    cursor?: string;
    perPage?: number;
    sort?: "date" | "new" | "freq" | "user";
    statsPeriod?: string;
  } = {}
): Promise<PaginatedResponse<SentryIssue[]>> {
  // Only add project filter when projectSlug is non-empty; an empty slug would
  // produce "project:" (a truthy string that .filter(Boolean) won't remove),
  // sending a malformed query to the API for org-wide listing.
  const projectFilter = projectSlug ? `project:${projectSlug}` : "";
  const fullQuery = [projectFilter, options.query].filter(Boolean).join(" ");

  return orgScopedRequestPaginated<SentryIssue[]>(
    `/organizations/${orgSlug}/issues/`,
    {
      params: {
        // Convert empty string to undefined so ky omits the param entirely;
        // sending `query=` causes the Sentry API to behave differently than
        // omitting the parameter.
        query: fullQuery || undefined,
        cursor: options.cursor,
        per_page: options.perPage ?? 25,
        sort: options.sort,
        statsPeriod: options.statsPeriod,
      },
    }
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
    sort?: "date" | "new" | "freq" | "user";
    statsPeriod?: string;
  }
): Promise<IssuesPage> {
  if (options.limit < 1) {
    throw new Error(
      `listIssuesAllPages: limit must be at least 1, got ${options.limit}`
    );
  }

  const allResults: SentryIssue[] = [];
  let cursor: string | undefined;

  // Use the smaller of the requested limit and the API max as page size
  const perPage = Math.min(options.limit, API_MAX_PER_PAGE);

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const response = await listIssuesPaginated(orgSlug, projectSlug, {
      query: options.query,
      cursor,
      perPage,
      sort: options.sort,
      statsPeriod: options.statsPeriod,
    });

    allResults.push(...response.data);

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
 */
export function getIssue(issueId: string): Promise<SentryIssue> {
  // The @sentry/api SDK's retrieveAnIssue requires org slug in path,
  // but the legacy endpoint /issues/{id}/ works without org context.
  // Use raw request for backward compatibility.
  return apiRequest<SentryIssue>(`/issues/${issueId}/`);
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

  for (const result of results) {
    if (result.status === "fulfilled" && result.value !== null) {
      return result.value;
    }
    // Propagate auth errors immediately — they indicate a global problem
    // (expired/missing token) rather than a per-org miss, so the user needs
    // to know. Transient per-org failures (network, 5xx) are swallowed since
    // other orgs may still succeed.
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
 * @param options - Query options (query, limit, sort, statsPeriod)
 * @returns Array of transaction items
 */
export async function listTransactions(
  orgSlug: string,
  projectSlug: string,
  options: ListTransactionsOptions = {}
): Promise<TransactionListItem[]> {
  const isNumericProject = isAllDigits(projectSlug);
  const projectFilter = isNumericProject ? "" : `project:${projectSlug}`;
  const fullQuery = [projectFilter, options.query].filter(Boolean).join(" ");

  const regionUrl = await resolveOrgRegion(orgSlug);

  // Use raw request: the SDK's dataset type doesn't include "transactions"
  const { data: response } = await apiRequestToRegion<TransactionsResponse>(
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
          options.sort === "duration" ? "-transaction.duration" : "-timestamp",
      },
      schema: TransactionsResponseSchema,
    }
  );

  return response.data;
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
 * Get a single log entry by its item ID.
 * Uses the Explore/Events API with dataset=logs and a filter query.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug for filtering
 * @param logId - The sentry.item_id of the log entry
 * @returns The detailed log entry, or null if not found
 */
export async function getLog(
  orgSlug: string,
  projectSlug: string,
  logId: string
): Promise<DetailedSentryLog | null> {
  const query = `project:${projectSlug} sentry.item_id:${logId}`;
  const config = await getOrgSdkConfig(orgSlug);

  const result = await queryExploreEventsInTableFormat({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    query: {
      dataset: "logs",
      field: DETAILED_LOG_FIELDS,
      query,
      per_page: 1,
      statsPeriod: "90d",
    },
  });

  const data = unwrapResult(result, "Failed to get log");
  const logsResponse = DetailedLogsResponseSchema.parse(data);
  return logsResponse.data[0] ?? null;
}
