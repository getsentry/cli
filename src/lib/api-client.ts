/**
 * Sentry API Client
 *
 * Handles authenticated requests to the Sentry API.
 * Uses ky for retry logic, timeouts, and better error handling.
 */

import kyHttpClient, { type KyInstance } from "ky";
import { z } from "zod";
import {
  type LogsResponse,
  LogsResponseSchema,
  type ProjectKey,
  ProjectKeySchema,
  type Region,
  type SentryEvent,
  SentryEventSchema,
  type SentryIssue,
  SentryIssueSchema,
  type SentryLog,
  type SentryOrganization,
  SentryOrganizationSchema,
  type SentryProject,
  SentryProjectSchema,
  type SentryUser,
  SentryUserSchema,
  type TraceResponse,
  type TraceSpan,
  type UserRegionsResponse,
  UserRegionsResponseSchema,
} from "../types/index.js";
import type { AutofixResponse, AutofixState } from "../types/seer.js";
import { DEFAULT_SENTRY_URL, getUserAgent } from "./constants.js";
import { refreshToken } from "./db/auth.js";
import { ApiError, AuthError } from "./errors.js";
import { withHttpSpan } from "./telemetry.js";
import { isAllDigits } from "./utils.js";

/**
 * Control silo URL - handles OAuth, user accounts, and region routing.
 * This is always sentry.io for SaaS, or the base URL for self-hosted.
 */
const CONTROL_SILO_URL = process.env.SENTRY_URL || DEFAULT_SENTRY_URL;

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30_000;

/** Maximum retry attempts for failed requests */
const MAX_RETRIES = 2;

/** Maximum backoff delay between retries in milliseconds */
const MAX_BACKOFF_MS = 10_000;

/** HTTP status codes that trigger automatic retry */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/** Regex to extract org slug from /organizations/{slug}/... endpoints */
const ORG_ENDPOINT_REGEX = /^\/?organizations\/([^/]+)/;

/** Regex to extract org slug from /projects/{org}/{project}/... endpoints */
const PROJECT_ENDPOINT_REGEX = /^\/?projects\/([^/]+)\/[^/]+/;

/**
 * Get the Sentry API base URL.
 * Supports self-hosted instances via SENTRY_URL env var.
 */
function getApiBaseUrl(): string {
  const baseUrl = process.env.SENTRY_URL || DEFAULT_SENTRY_URL;
  return `${baseUrl}/api/0/`;
}

/**
 * Normalize endpoint path for use with ky's prefixUrl.
 * Removes leading slash since ky handles URL joining.
 */
function normalizePath(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
}

type ApiRequestOptions<T = unknown> = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  /** Query parameters. String arrays create repeated keys (e.g., tags=1&tags=2) */
  params?: Record<string, string | number | boolean | string[] | undefined>;
  /** Optional Zod schema for runtime validation of response data */
  schema?: z.ZodType<T>;
};

/** Header to mark requests as retries, preventing infinite retry loops */
const RETRY_MARKER_HEADER = "x-sentry-cli-retry";

/**
 * Create a configured ky instance with retry, timeout, and authentication.
 *
 * @throws {AuthError} When not authenticated
 * @throws {ApiError} When API request fails
 */
async function createApiClient(): Promise<KyInstance> {
  const { token } = await refreshToken();

  return kyHttpClient.create({
    prefixUrl: getApiBaseUrl(),
    timeout: REQUEST_TIMEOUT_MS,
    retry: {
      limit: MAX_RETRIES,
      methods: ["get", "put", "delete", "patch"],
      statusCodes: RETRYABLE_STATUS_CODES,
      backoffLimit: MAX_BACKOFF_MS,
    },
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": getUserAgent(),
    },
    hooks: {
      afterResponse: [
        async (request, options, response) => {
          // On 401, force token refresh and retry once
          const isRetry = request.headers.get(RETRY_MARKER_HEADER) === "1";
          if (response.status === 401 && !isRetry) {
            try {
              const { token: newToken, refreshed } = await refreshToken({
                force: true,
              });

              // Don't retry if token wasn't refreshed (e.g., manual API token)
              if (!refreshed) {
                return response;
              }

              const retryHeaders = new Headers(options.headers);
              retryHeaders.set("Authorization", `Bearer ${newToken}`);
              retryHeaders.set(RETRY_MARKER_HEADER, "1");

              // Spread options but remove prefixUrl since request.url is already absolute
              const { prefixUrl: _, ...retryOptions } = options;
              return kyHttpClient(request.url, {
                ...retryOptions,
                headers: retryHeaders,
                retry: 0,
              });
            } catch {
              // Token refresh failed, return original 401 response
              return response;
            }
          }
          return response;
        },
      ],
    },
  });
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
      // Repeated keys for arrays: tags=1&tags=2&tags=3
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
 * Make an authenticated request to the Sentry API.
 *
 * @param endpoint - API endpoint path (e.g., "/organizations/")
 * @param options - Request options including method, body, query params, and validation schema
 * @returns Parsed JSON response (validated if schema provided)
 * @throws {AuthError} When not authenticated
 * @throws {ApiError} On API errors
 * @throws {z.ZodError} When response fails schema validation
 */
export function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<T> {
  const { method = "GET", body, params, schema } = options;

  return withHttpSpan(method, endpoint, async () => {
    const client = await createApiClient();

    let response: Response;
    try {
      response = await client(normalizePath(endpoint), {
        method,
        json: body,
        searchParams: buildSearchParams(params),
      });
    } catch (error) {
      // Transform ky HTTPError into ApiError
      if (error && typeof error === "object" && "response" in error) {
        const kyError = error as { response: Response };
        const text = await kyError.response.text();
        let detail: string | undefined;
        try {
          const parsed = JSON.parse(text) as { detail?: string };
          detail = parsed.detail ?? JSON.stringify(parsed);
        } catch {
          detail = text;
        }
        throw new ApiError(
          `API request failed: ${kyError.response.status} ${kyError.response.statusText}`,
          kyError.response.status,
          detail
        );
      }
      throw error;
    }

    const data = await response.json();

    // Validate response if schema provided
    if (schema) {
      return schema.parse(data);
    }

    return data as T;
  });
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
    const client = await createApiClient();

    // Handle body based on type:
    // - Objects: use ky's json option (auto-stringifies and sets Content-Type)
    // - Strings: send as raw body (user can set Content-Type via custom headers if needed)
    // - undefined: no body
    const isStringBody = typeof body === "string";

    // For string bodies, remove the default Content-Type: application/json from createApiClient
    // unless the user explicitly provides one. This allows sending non-JSON content.
    // Check is case-insensitive since HTTP headers are case-insensitive.
    const hasContentType = Object.keys(customHeaders).some(
      (k) => k.toLowerCase() === "content-type"
    );
    const headers =
      isStringBody && !hasContentType
        ? { ...customHeaders, "Content-Type": undefined }
        : customHeaders;

    const requestOptions: Parameters<typeof client>[1] = {
      method,
      searchParams: buildSearchParams(params),
      headers,
      throwHttpErrors: false,
    };

    if (body !== undefined) {
      if (isStringBody) {
        requestOptions.body = body;
      } else {
        requestOptions.json = body;
      }
    }

    const response = await client(normalizePath(endpoint), requestOptions);

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

/**
 * Create a ky client configured for a specific region URL.
 * Used for making requests to region-specific endpoints.
 *
 * @param regionUrl - The region's base URL (e.g., https://us.sentry.io)
 */
async function createRegionApiClient(regionUrl: string): Promise<KyInstance> {
  const { token } = await refreshToken();
  const baseUrl = regionUrl.endsWith("/") ? regionUrl : `${regionUrl}/`;

  return kyHttpClient.create({
    prefixUrl: `${baseUrl}api/0/`,
    timeout: REQUEST_TIMEOUT_MS,
    retry: {
      limit: MAX_RETRIES,
      methods: ["get", "put", "delete", "patch"],
      statusCodes: RETRYABLE_STATUS_CODES,
      backoffLimit: MAX_BACKOFF_MS,
    },
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": getUserAgent(),
    },
    hooks: {
      afterResponse: [
        async (request, options, response) => {
          const isRetry = request.headers.get(RETRY_MARKER_HEADER) === "1";
          if (response.status === 401 && !isRetry) {
            try {
              const { token: newToken, refreshed } = await refreshToken({
                force: true,
              });
              if (!refreshed) {
                return response;
              }
              const retryHeaders = new Headers(options.headers);
              retryHeaders.set("Authorization", `Bearer ${newToken}`);
              retryHeaders.set(RETRY_MARKER_HEADER, "1");
              const { prefixUrl: _, ...retryOptions } = options;
              return kyHttpClient(request.url, {
                ...retryOptions,
                headers: retryHeaders,
                retry: 0,
              });
            } catch {
              return response;
            }
          }
          return response;
        },
      ],
    },
  });
}

/**
 * Make an authenticated request to a specific Sentry region.
 *
 * @param regionUrl - The region's base URL (e.g., https://us.sentry.io)
 * @param endpoint - API endpoint path (e.g., "/organizations/")
 * @param options - Request options
 */
export async function apiRequestToRegion<T>(
  regionUrl: string,
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<T> {
  const { method = "GET", body, params, schema } = options;
  const client = await createRegionApiClient(regionUrl);

  let response: Response;
  try {
    response = await client(normalizePath(endpoint), {
      method,
      json: body,
      searchParams: buildSearchParams(params),
    });
  } catch (error) {
    if (error && typeof error === "object" && "response" in error) {
      const kyError = error as { response: Response };
      const text = await kyError.response.text();
      let detail: string | undefined;
      try {
        const parsed = JSON.parse(text) as { detail?: string };
        detail = parsed.detail ?? JSON.stringify(parsed);
      } catch {
        detail = text;
      }
      throw new ApiError(
        `API request failed: ${kyError.response.status} ${kyError.response.statusText}`,
        kyError.response.status,
        detail
      );
    }
    throw error;
  }

  const data = await response.json();

  if (schema) {
    return schema.parse(data);
  }

  return data as T;
}

/**
 * Get the list of regions the user has organization membership in.
 * This endpoint is on the control silo (sentry.io) and returns all regions.
 *
 * @returns Array of regions with name and URL
 */
export async function getUserRegions(): Promise<Region[]> {
  // Always use control silo for this endpoint
  const response = await apiRequestToRegion<UserRegionsResponse>(
    CONTROL_SILO_URL,
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
export function listOrganizationsInRegion(
  regionUrl: string
): Promise<SentryOrganization[]> {
  return apiRequestToRegion<SentryOrganization[]>(
    regionUrl,
    "/organizations/",
    {
      schema: z.array(SentryOrganizationSchema),
    }
  );
}

/**
 * Extract organization slug from an endpoint path.
 * Supports:
 * - `/organizations/{slug}/...` - standard organization endpoints
 * - `/projects/{org}/{project}/...` - project-scoped endpoints
 */
function extractOrgSlugFromEndpoint(endpoint: string): string | null {
  // Try organization path first: /organizations/{slug}/...
  const orgMatch = endpoint.match(ORG_ENDPOINT_REGEX);
  if (orgMatch?.[1]) {
    return orgMatch[1];
  }

  // Try project path: /projects/{org}/{project}/...
  const projectMatch = endpoint.match(PROJECT_ENDPOINT_REGEX);
  if (projectMatch?.[1]) {
    return projectMatch[1];
  }

  return null;
}

/**
 * Make an org-scoped API request, automatically resolving the correct region.
 * This is the preferred way to make org-scoped requests.
 *
 * The endpoint must contain the org slug in the path (e.g., `/organizations/{slug}/...`).
 * The org slug is extracted to look up the correct region URL.
 *
 * @param endpoint - API endpoint path containing the org slug
 * @param options - Request options
 */
async function orgScopedRequest<T>(
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<T> {
  const orgSlug = extractOrgSlugFromEndpoint(endpoint);
  if (!orgSlug) {
    throw new Error(
      `Cannot extract org slug from endpoint: ${endpoint}. ` +
        "Endpoint must match /organizations/{slug}/..."
    );
  }
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  return apiRequestToRegion(regionUrl, endpoint, options);
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
    // Re-throw auth errors - user needs to login
    if (error instanceof AuthError) {
      throw error;
    }
    // Self-hosted instances may not have the regions endpoint (404)
    regions = [];
  }

  if (regions.length === 0) {
    // Fall back to default API for self-hosted instances
    return apiRequest<SentryOrganization[]>("/organizations/", {
      schema: z.array(SentryOrganizationSchema),
    });
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
  return orgScopedRequest<SentryOrganization>(`/organizations/${orgSlug}/`, {
    schema: SentryOrganizationSchema,
  });
}

/**
 * List projects in an organization.
 * Uses region-aware routing for multi-region support.
 */
export function listProjects(orgSlug: string): Promise<SentryProject[]> {
  return orgScopedRequest<SentryProject[]>(
    `/organizations/${orgSlug}/projects/`,
    {
      schema: z.array(SentryProjectSchema),
    }
  );
}

/** Project with its organization context */
export type ProjectWithOrg = SentryProject & {
  /** Organization slug the project belongs to */
  orgSlug: string;
};

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

  // Search in parallel for performance
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
        // Re-throw auth errors - user needs to login
        if (error instanceof AuthError) {
          throw error;
        }
        // Skip orgs where user lacks access (permission errors, etc.)
        return null;
      }
    })
  );

  return searchResults.filter((r): r is ProjectWithOrg => r !== null);
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
    // Re-throw auth errors - user needs to login
    if (error instanceof AuthError) {
      throw error;
    }
    // Self-hosted instances may not have the regions endpoint (404)
    regions = [];
  }

  if (regions.length === 0) {
    // Fall back to default region for self-hosted
    const projects = await apiRequest<SentryProject[]>("/projects/", {
      params: { query: `dsn:${publicKey}` },
      schema: z.array(SentryProjectSchema),
    });
    return projects[0] ?? null;
  }

  const results = await Promise.all(
    regions.map(async (region) => {
      try {
        return await apiRequestToRegion<SentryProject[]>(
          region.url,
          "/projects/",
          {
            params: { query: `dsn:${publicKey}` },
            schema: z.array(SentryProjectSchema),
          }
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
  return orgScopedRequest<SentryProject>(
    `/projects/${orgSlug}/${projectSlug}/`,
    {
      schema: SentryProjectSchema,
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
  return orgScopedRequest<ProjectKey[]>(
    `/projects/${orgSlug}/${projectSlug}/keys/`,
    {
      schema: z.array(ProjectKeySchema),
    }
  );
}

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
  return orgScopedRequest<SentryIssue[]>(
    `/projects/${orgSlug}/${projectSlug}/issues/`,
    {
      params: {
        query: options.query,
        cursor: options.cursor,
        limit: options.limit,
        sort: options.sort,
        statsPeriod: options.statsPeriod,
      },
      schema: z.array(SentryIssueSchema),
    }
  );
}

/**
 * Get a specific issue by numeric ID
 */
export function getIssue(issueId: string): Promise<SentryIssue> {
  return apiRequest<SentryIssue>(`/issues/${issueId}/`, {
    schema: SentryIssueSchema,
  });
}

/**
 * Get an issue by short ID (e.g., SPOTLIGHT-ELECTRON-4D).
 * Requires organization context to resolve the short ID.
 * The shortId is normalized to uppercase for case-insensitive matching.
 * Uses region-aware routing for multi-region support.
 *
 * @see https://docs.sentry.io/api/events/retrieve-an-issue/
 */
export function getIssueByShortId(
  orgSlug: string,
  shortId: string
): Promise<SentryIssue> {
  // Normalize to uppercase for case-insensitive matching
  const normalizedShortId = shortId.toUpperCase();
  return orgScopedRequest<SentryIssue>(
    `/organizations/${orgSlug}/issues/${normalizedShortId}/`,
    {
      schema: SentryIssueSchema,
    }
  );
}

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
  return orgScopedRequest<SentryEvent>(
    `/organizations/${orgSlug}/issues/${issueId}/events/latest/`
  );
}

/**
 * Get a specific event by ID.
 * Uses region-aware routing for multi-region support.
 *
 * @see https://docs.sentry.io/api/events/retrieve-an-event-for-a-project/
 */
export function getEvent(
  orgSlug: string,
  projectSlug: string,
  eventId: string
): Promise<SentryEvent> {
  return orgScopedRequest<SentryEvent>(
    `/projects/${orgSlug}/${projectSlug}/events/${eventId}/`,
    {
      schema: SentryEventSchema,
    }
  );
}

/**
 * Get trace data including all transactions and spans.
 * Returns the full trace tree for visualization.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug
 * @param traceId - The trace ID (from event.contexts.trace.trace_id)
 * @returns Trace response with transactions array and orphan_errors
 */
export function getTrace(
  orgSlug: string,
  traceId: string
): Promise<TraceResponse> {
  return orgScopedRequest<TraceResponse>(
    `/organizations/${orgSlug}/events-trace/${traceId}/`
  );
}

/**
 * Get detailed trace with nested children structure.
 * Uses the same endpoint as Sentry's dashboard for hierarchical span trees.
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
  return orgScopedRequest<TraceSpan[]>(
    `/organizations/${orgSlug}/trace/${traceId}/`,
    {
      params: {
        timestamp,
        // Maximum spans to fetch - 10k is sufficient for most traces while
        // preventing excessive response sizes for very large traces
        limit: 10_000,
        // -1 means "all projects" - required since trace can span multiple projects
        project: -1,
      },
    }
  );
}

/**
 * Update an issue's status
 */
export function updateIssueStatus(
  issueId: string,
  status: "resolved" | "unresolved" | "ignored"
): Promise<SentryIssue> {
  return apiRequest<SentryIssue>(`/issues/${issueId}/`, {
    method: "PUT",
    body: { status },
    schema: SentryIssueSchema,
  });
}

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
  return orgScopedRequest<{ run_id: number }>(
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    {
      method: "POST",
      body: { step: "root_cause" },
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
export async function getAutofixState(
  orgSlug: string,
  issueId: string
): Promise<AutofixState | null> {
  const response = await orgScopedRequest<AutofixResponse>(
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`
  );

  return response.autofix;
}

/**
 * Trigger solution planning for an existing autofix run.
 * Continues from root cause analysis to generate a solution.
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
  return orgScopedRequest(
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

/**
 * Get the currently authenticated user's information.
 * Used for setting user context in telemetry.
 */
export function getCurrentUser(): Promise<SentryUser> {
  return apiRequest<SentryUser>("/users/me/", {
    schema: SentryUserSchema,
  });
}

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
 * Handles project slug vs numeric ID automatically:
 * - Numeric IDs are passed as the `project` parameter
 * - Slugs are added to the query string as `project:{slug}`
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
  // API only accepts numeric project IDs as param, slugs go in query
  const isNumericProject = isAllDigits(projectSlug);

  // Build query parts
  const projectFilter = isNumericProject ? "" : `project:${projectSlug}`;
  const timestampFilter = options.afterTimestamp
    ? `timestamp_precise:>${options.afterTimestamp}`
    : "";

  const fullQuery = [projectFilter, options.query, timestampFilter]
    .filter(Boolean)
    .join(" ");

  const response = await orgScopedRequest<LogsResponse>(
    `/organizations/${orgSlug}/events/`,
    {
      params: {
        dataset: "logs",
        field: LOG_FIELDS,
        project: isNumericProject ? projectSlug : undefined,
        query: fullQuery || undefined,
        per_page: options.limit || 100,
        statsPeriod: options.statsPeriod ?? "90d",
        sort: "-timestamp",
      },
      schema: LogsResponseSchema,
    }
  );

  return response.data;
}
