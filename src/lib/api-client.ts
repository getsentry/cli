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
  listAnOrganization_sProjects,
  listAProject_sClientKeys,
  queryExploreEventsInTableFormat,
  resolveAShortId,
  retrieveAnEventForAProject,
  retrieveAnIssueEvent,
  retrieveAnOrganization,
  retrieveAProject,
  retrieveSeerIssueFixState,
  listYourOrganizations as sdkListOrganizations,
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
import { ApiError, AuthError } from "./errors.js";
import { resolveOrgRegion } from "./region.js";
import {
  getApiBaseUrl,
  getControlSiloUrl,
  getDefaultSdkConfig,
  getSdkConfig,
} from "./sentry-client.js";
import { withHttpSpan } from "./telemetry.js";
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
      ? String((error as { detail: unknown }).detail)
      : String(error);
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
 * Make an authenticated request to a specific Sentry region.
 * Used for internal endpoints not covered by @sentry/api SDK functions.
 *
 * @param regionUrl - The region's base URL (e.g., https://us.sentry.io)
 * @param endpoint - API endpoint path (e.g., "/users/me/regions/")
 * @param options - Request options
 */
export async function apiRequestToRegion<T>(
  regionUrl: string,
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<T> {
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
    return schema.parse(data);
  }

  return data as T;
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
export function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<T> {
  const { method = "GET" } = options;
  return withHttpSpan(method, endpoint, () =>
    apiRequestToRegion(getApiBaseUrl(), endpoint, options)
  );
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
export function rawApiRequest(
  endpoint: string,
  options: ApiRequestOptions & { headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const { method = "GET", body, params, headers: customHeaders = {} } = options;

  return withHttpSpan(method, endpoint, async () => {
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
  });
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
  const response = await apiRequestToRegion<UserRegionsResponse>(
    getControlSiloUrl(),
    "/users/me/regions/",
    { schema: UserRegionsResponseSchema }
  );
  return response.regions;
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
export function getOrganization(orgSlug: string): Promise<SentryOrganization> {
  return withHttpSpan("GET", `/organizations/${orgSlug}/`, async () => {
    const config = await getOrgSdkConfig(orgSlug);

    const result = await retrieveAnOrganization({
      ...config,
      path: { organization_id_or_slug: orgSlug },
    });

    const data = unwrapResult(result, "Failed to get organization");
    return data as unknown as SentryOrganization;
  });
}

// Project functions

/**
 * List projects in an organization.
 * Uses region-aware routing for multi-region support.
 */
export function listProjects(orgSlug: string): Promise<SentryProject[]> {
  return withHttpSpan(
    "GET",
    `/organizations/${orgSlug}/projects/`,
    async () => {
      const config = await getOrgSdkConfig(orgSlug);

      const result = await listAnOrganization_sProjects({
        ...config,
        path: { organization_id_or_slug: orgSlug },
      });

      const data = unwrapResult(result, "Failed to list projects");
      return data as unknown as SentryProject[];
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
export function listRepositories(orgSlug: string): Promise<SentryRepository[]> {
  return withHttpSpan("GET", `/organizations/${orgSlug}/repos/`, async () => {
    const regionUrl = await resolveOrgRegion(orgSlug);

    return apiRequestToRegion<SentryRepository[]>(
      regionUrl,
      `/organizations/${orgSlug}/repos/`
    );
  });
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

  const searchResults = await Promise.all(
    orgs.map(async (org) => {
      try {
        const projects = await listProjects(org.slug);
        const match = projects.find((p) => p.slug === projectSlug);
        if (match) {
          return { ...match, orgSlug: org.slug };
        }
        return null;
      } catch (error) {
        if (error instanceof AuthError) {
          throw error;
        }
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
 * across all accessible projects in all regions.
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
    const projects = await apiRequestToRegion<SentryProject[]>(
      getApiBaseUrl(),
      "/projects/",
      { params: { query: `dsn:${publicKey}` } }
    );
    return projects[0] ?? null;
  }

  const results = await Promise.all(
    regions.map(async (region) => {
      try {
        return await apiRequestToRegion<SentryProject[]>(
          region.url,
          "/projects/",
          { params: { query: `dsn:${publicKey}` } }
        );
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
export function getProject(
  orgSlug: string,
  projectSlug: string
): Promise<SentryProject> {
  return withHttpSpan(
    "GET",
    `/projects/${orgSlug}/${projectSlug}/`,
    async () => {
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
  );
}

/**
 * Get project keys (DSNs) for a project.
 * Uses region-aware routing for multi-region support.
 */
export function getProjectKeys(
  orgSlug: string,
  projectSlug: string
): Promise<ProjectKey[]> {
  return withHttpSpan(
    "GET",
    `/projects/${orgSlug}/${projectSlug}/keys/`,
    async () => {
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
  );
}

// Issue functions

/**
 * List issues for a project.
 * Uses region-aware routing for multi-region support.
 */
export function listIssues(
  orgSlug: string,
  projectSlug: string,
  options: {
    query?: string;
    cursor?: string;
    limit?: number;
    sort?: "date" | "new" | "priority" | "freq" | "user";
    statsPeriod?: string;
  } = {}
): Promise<SentryIssue[]> {
  return withHttpSpan(
    "GET",
    `/projects/${orgSlug}/${projectSlug}/issues/`,
    async () => {
      const regionUrl = await resolveOrgRegion(orgSlug);

      // Use raw request: the SDK type doesn't support limit/sort params
      return apiRequestToRegion<SentryIssue[]>(
        regionUrl,
        `/projects/${orgSlug}/${projectSlug}/issues/`,
        {
          params: {
            query: options.query,
            cursor: options.cursor,
            limit: options.limit,
            sort: options.sort,
            statsPeriod: options.statsPeriod,
          },
        }
      );
    }
  );
}

/**
 * Get a specific issue by numeric ID.
 */
export function getIssue(issueId: string): Promise<SentryIssue> {
  return withHttpSpan("GET", `/issues/${issueId}/`, () => {
    // The @sentry/api SDK's retrieveAnIssue requires org slug in path,
    // but the legacy endpoint /issues/{id}/ works without org context.
    // Use raw request for backward compatibility.
    return apiRequest<SentryIssue>(`/issues/${issueId}/`);
  });
}

/**
 * Get an issue by short ID (e.g., SPOTLIGHT-ELECTRON-4D).
 * Requires organization context to resolve the short ID.
 * Uses region-aware routing for multi-region support.
 */
export function getIssueByShortId(
  orgSlug: string,
  shortId: string
): Promise<SentryIssue> {
  const normalizedShortId = shortId.toUpperCase();

  return withHttpSpan(
    "GET",
    `/organizations/${orgSlug}/issues/${normalizedShortId}/`,
    async () => {
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
  );
}

// Event functions

/**
 * Get the latest event for an issue.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug (required for multi-region routing)
 * @param issueId - Issue ID (numeric)
 */
export function getLatestEvent(
  orgSlug: string,
  issueId: string
): Promise<SentryEvent> {
  return withHttpSpan(
    "GET",
    `/organizations/${orgSlug}/issues/${issueId}/events/latest/`,
    async () => {
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
  );
}

/**
 * Get a specific event by ID.
 * Uses region-aware routing for multi-region support.
 */
export function getEvent(
  orgSlug: string,
  projectSlug: string,
  eventId: string
): Promise<SentryEvent> {
  return withHttpSpan(
    "GET",
    `/projects/${orgSlug}/${projectSlug}/events/${eventId}/`,
    async () => {
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
  );
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
export function getDetailedTrace(
  orgSlug: string,
  traceId: string,
  timestamp: number
): Promise<TraceSpan[]> {
  return withHttpSpan(
    "GET",
    `/organizations/${orgSlug}/trace/${traceId}/`,
    async () => {
      const regionUrl = await resolveOrgRegion(orgSlug);

      return apiRequestToRegion<TraceSpan[]>(
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
    }
  );
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
export function listTransactions(
  orgSlug: string,
  projectSlug: string,
  options: ListTransactionsOptions = {}
): Promise<TransactionListItem[]> {
  return withHttpSpan("GET", `/organizations/${orgSlug}/events/`, async () => {
    const isNumericProject = isAllDigits(projectSlug);
    const projectFilter = isNumericProject ? "" : `project:${projectSlug}`;
    const fullQuery = [projectFilter, options.query].filter(Boolean).join(" ");

    const regionUrl = await resolveOrgRegion(orgSlug);

    // Use raw request: the SDK's dataset type doesn't include "transactions"
    const response = await apiRequestToRegion<TransactionsResponse>(
      regionUrl,
      `/organizations/${orgSlug}/events/`,
      {
        params: {
          dataset: "transactions",
          field: TRANSACTION_FIELDS,
          project: isNumericProject ? projectSlug : undefined,
          query: fullQuery || undefined,
          per_page: options.limit || 10,
          statsPeriod: options.statsPeriod ?? "7d",
          sort:
            options.sort === "duration"
              ? "-transaction.duration"
              : "-timestamp",
        },
        schema: TransactionsResponseSchema,
      }
    );

    return response.data;
  });
}

// Issue update functions

/**
 * Update an issue's status.
 */
export function updateIssueStatus(
  issueId: string,
  status: "resolved" | "unresolved" | "ignored"
): Promise<SentryIssue> {
  return withHttpSpan("PUT", `/issues/${issueId}/`, () => {
    // Use raw request - the SDK's updateAnIssue requires org slug but
    // the legacy /issues/{id}/ endpoint works without it
    return apiRequest<SentryIssue>(`/issues/${issueId}/`, {
      method: "PUT",
      body: { status },
    });
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
export function triggerRootCauseAnalysis(
  orgSlug: string,
  issueId: string
): Promise<{ run_id: number }> {
  return withHttpSpan(
    "POST",
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    async () => {
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

      const data = unwrapResult(
        result,
        "Failed to trigger root cause analysis"
      );
      return data as unknown as { run_id: number };
    }
  );
}

/**
 * Get the current autofix state for an issue.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - The organization slug
 * @param issueId - The numeric Sentry issue ID
 * @returns The autofix state, or null if no autofix has been run
 */
export function getAutofixState(
  orgSlug: string,
  issueId: string
): Promise<AutofixState | null> {
  return withHttpSpan(
    "GET",
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    async () => {
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
  );
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
export function triggerSolutionPlanning(
  orgSlug: string,
  issueId: string,
  runId: number
): Promise<unknown> {
  return withHttpSpan(
    "POST",
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    async () => {
      const regionUrl = await resolveOrgRegion(orgSlug);

      return apiRequestToRegion(
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
    }
  );
}

// User functions

/**
 * Get the currently authenticated user's information.
 * Uses the /users/me/ endpoint on the control silo.
 */
export function getCurrentUser(): Promise<SentryUser> {
  return withHttpSpan("GET", "/users/me/", () =>
    apiRequestToRegion<SentryUser>(getControlSiloUrl(), "/users/me/", {
      schema: SentryUserSchema,
    })
  );
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
export function listLogs(
  orgSlug: string,
  projectSlug: string,
  options: ListLogsOptions = {}
): Promise<SentryLog[]> {
  return withHttpSpan("GET", `/organizations/${orgSlug}/events/`, async () => {
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
        per_page: options.limit || 100,
        statsPeriod: options.statsPeriod ?? "7d",
        sort: "-timestamp",
      },
    });

    const data = unwrapResult(result, "Failed to list logs");
    const logsResponse = LogsResponseSchema.parse(data);
    return logsResponse.data;
  });
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
export function getLog(
  orgSlug: string,
  projectSlug: string,
  logId: string
): Promise<DetailedSentryLog | null> {
  return withHttpSpan("GET", `/organizations/${orgSlug}/events/`, async () => {
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
  });
}
