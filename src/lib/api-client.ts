/**
 * Sentry API Client
 *
 * Handles authenticated requests to the Sentry API using hey-api generated client.
 * Provides multi-region support, token refresh, and error handling.
 */

// hey-api SDK functions
import {
  listAnOrganization_sProjects,
  listAProject_sClientKeys,
  listAProject_sIssues,
  listYourOrganizations,
  retrieveAnEventForAProject,
  retrieveAnOrganization,
  retrieveAProject,
  retrieveSeerIssueFixState,
} from "../client/sdk.gen.js";
import type {
  ProjectKey,
  Region,
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
  SentryUser,
  TraceResponse,
  TraceSpan,
  UserRegionsResponse,
} from "../types/index.js";
import type { AutofixResponse, AutofixState } from "../types/seer.js";
import {
  createRegionClient,
  extractData,
  getDefaultBaseUrl,
  withApiSpan,
} from "./client-setup.js";
import { DEFAULT_SENTRY_URL } from "./constants.js";
import { AuthError } from "./errors.js";

/**
 * Control silo URL - handles OAuth, user accounts, and region routing.
 * This is always sentry.io for SaaS, or the base URL for self-hosted.
 */
const CONTROL_SILO_URL = process.env.SENTRY_URL || DEFAULT_SENTRY_URL;

// ─────────────────────────────────────────────────────────────────────────────
// Legacy API Request Support (for rawApiRequest and non-hey-api endpoints)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Region Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the list of regions the user has organization membership in.
 * This endpoint is on the control silo (sentry.io) and returns all regions.
 *
 * @returns Array of regions with name and URL
 */
export function getUserRegions(): Promise<Region[]> {
  const client = createRegionClient(CONTROL_SILO_URL);

  return withApiSpan("GET", "/users/me/regions/", async () => {
    const response = await client.get<{ 200: UserRegionsResponse }>({
      url: "/api/0/users/me/regions/",
    });
    const data = extractData(response);
    return data.regions;
  });
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
  const client = createRegionClient(regionUrl);

  return withApiSpan("GET", "/organizations/", async () => {
    const response = await listYourOrganizations({ client });
    return extractData(response) as SentryOrganization[];
  });
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
    const client = createRegionClient(getDefaultBaseUrl());
    const response = await listYourOrganizations({ client });
    return extractData(response) as SentryOrganization[];
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
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan("GET", `/organizations/${orgSlug}/`, async () => {
    const response = await retrieveAnOrganization({
      client,
      path: { organization_id_or_slug: orgSlug },
    });
    return extractData(response) as SentryOrganization;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List projects in an organization.
 * Uses region-aware routing for multi-region support.
 */
export async function listProjects(orgSlug: string): Promise<SentryProject[]> {
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan("GET", `/organizations/${orgSlug}/projects/`, async () => {
    const response = await listAnOrganization_sProjects({
      client,
      path: { organization_id_or_slug: orgSlug },
    });
    return extractData(response) as SentryProject[];
  });
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

  // Search function for a single region
  const searchInRegion = async (
    regionUrl: string
  ): Promise<SentryProject | null> => {
    const client = createRegionClient(regionUrl);
    // Use raw client request since this endpoint isn't in hey-api SDK
    const response = await client.get<{ 200: SentryProject[] }>({
      url: "/api/0/projects/",
      query: { query: `dsn:${publicKey}` },
    });
    const projects = extractData(response);
    return projects[0] ?? null;
  };

  if (regions.length === 0) {
    // Fall back to default region for self-hosted
    return searchInRegion(getDefaultBaseUrl());
  }

  const results = await Promise.all(
    regions.map(async (region) => {
      try {
        return await searchInRegion(region.url);
      } catch {
        return null;
      }
    })
  );

  for (const project of results) {
    if (project) {
      return project;
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
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "GET",
    `/projects/${orgSlug}/${projectSlug}/`,
    async () => {
      const response = await retrieveAProject({
        client,
        path: {
          organization_id_or_slug: orgSlug,
          project_id_or_slug: projectSlug,
        },
      });
      return extractData(response) as SentryProject;
    }
  );
}

/**
 * Get project keys (DSNs) for a project.
 * Uses region-aware routing for multi-region support.
 */
export async function getProjectKeys(
  orgSlug: string,
  projectSlug: string
): Promise<ProjectKey[]> {
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "GET",
    `/projects/${orgSlug}/${projectSlug}/keys/`,
    async () => {
      const response = await listAProject_sClientKeys({
        client,
        path: {
          organization_id_or_slug: orgSlug,
          project_id_or_slug: projectSlug,
        },
      });
      return extractData(response) as ProjectKey[];
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Issues
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List issues for a project.
 * Uses region-aware routing for multi-region support.
 */
export async function listIssues(
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
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "GET",
    `/projects/${orgSlug}/${projectSlug}/issues/`,
    async () => {
      const response = await listAProject_sIssues({
        client,
        path: {
          organization_id_or_slug: orgSlug,
          project_id_or_slug: projectSlug,
        },
        query: {
          query: options.query,
          cursor: options.cursor,
          statsPeriod: options.statsPeriod,
          // The SDK uses different parameter names, so we may need adjustments
        },
      });
      return extractData(response) as SentryIssue[];
    }
  );
}

/**
 * Get a specific issue by numeric ID
 */
export function getIssue(issueId: string): Promise<SentryIssue> {
  const client = createRegionClient(getDefaultBaseUrl());

  return withApiSpan("GET", `/issues/${issueId}/`, async () => {
    // Use raw client since hey-api requires org slug which we don't have
    const response = await client.get<{ 200: SentryIssue }>({
      url: `/api/0/issues/${issueId}/`,
    });
    return extractData(response);
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
export async function getIssueByShortId(
  orgSlug: string,
  shortId: string
): Promise<SentryIssue> {
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  // Normalize to uppercase for case-insensitive matching
  const normalizedShortId = shortId.toUpperCase();

  return withApiSpan(
    "GET",
    `/organizations/${orgSlug}/issues/${normalizedShortId}/`,
    async () => {
      // Use raw client call to maintain original endpoint behavior
      const response = await client.get({
        url: `/api/0/organizations/${orgSlug}/issues/${normalizedShortId}/`,
      });
      return extractData(response) as SentryIssue;
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
export async function getLatestEvent(
  orgSlug: string,
  issueId: string
): Promise<SentryEvent> {
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "GET",
    `/organizations/${orgSlug}/issues/${issueId}/events/latest/`,
    async () => {
      // This endpoint isn't directly in hey-api, use raw client
      const response = await client.get<{ 200: SentryEvent }>({
        url: `/api/0/organizations/${orgSlug}/issues/${issueId}/events/latest/`,
      });
      return extractData(response);
    }
  );
}

/**
 * Get a specific event by ID.
 * Uses region-aware routing for multi-region support.
 *
 * @see https://docs.sentry.io/api/events/retrieve-an-event-for-a-project/
 */
export async function getEvent(
  orgSlug: string,
  projectSlug: string,
  eventId: string
): Promise<SentryEvent> {
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "GET",
    `/projects/${orgSlug}/${projectSlug}/events/${eventId}/`,
    async () => {
      const response = await retrieveAnEventForAProject({
        client,
        path: {
          organization_id_or_slug: orgSlug,
          project_id_or_slug: projectSlug,
          event_id: eventId,
        },
      });
      return extractData(response) as SentryEvent;
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
export async function getTrace(
  orgSlug: string,
  traceId: string
): Promise<TraceResponse> {
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "GET",
    `/organizations/${orgSlug}/events-trace/${traceId}/`,
    async () => {
      // This endpoint isn't in hey-api, use raw client
      const response = await client.get<{ 200: TraceResponse }>({
        url: `/api/0/organizations/${orgSlug}/events-trace/${traceId}/`,
      });
      return extractData(response);
    }
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
export async function getDetailedTrace(
  orgSlug: string,
  traceId: string,
  timestamp: number
): Promise<TraceSpan[]> {
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "GET",
    `/organizations/${orgSlug}/trace/${traceId}/`,
    async () => {
      // This endpoint isn't in hey-api, use raw client
      const response = await client.get<{ 200: TraceSpan[] }>({
        url: `/api/0/organizations/${orgSlug}/trace/${traceId}/`,
        query: {
          timestamp,
          // Maximum spans to fetch - 10k is sufficient for most traces while
          // preventing excessive response sizes for very large traces
          limit: 10_000,
          // -1 means "all projects" - required since trace can span multiple projects
          project: -1,
        },
      });
      return extractData(response);
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
  const client = createRegionClient(getDefaultBaseUrl());

  return withApiSpan("PUT", `/issues/${issueId}/`, async () => {
    // Use raw client since hey-api requires org slug which we don't have
    const response = await client.put<{ 200: SentryIssue }>({
      url: `/api/0/issues/${issueId}/`,
      body: { status },
    });
    return extractData(response);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Seer AI
// ─────────────────────────────────────────────────────────────────────────────

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
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "POST",
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    async () => {
      // Use raw client for backward compatibility with existing body format
      const response = await client.post<{ 200: { run_id: number } }>({
        url: `/api/0/organizations/${orgSlug}/issues/${issueId}/autofix/`,
        body: {
          step: "root_cause",
        },
      });
      return extractData(response);
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
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "GET",
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    async () => {
      const response = await retrieveSeerIssueFixState({
        client,
        path: {
          organization_id_or_slug: orgSlug,
          issue_id: Number(issueId),
        },
      });
      const data = extractData(response) as AutofixResponse;
      return data.autofix;
    }
  );
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
export async function triggerSolutionPlanning(
  orgSlug: string,
  issueId: string,
  runId: number
): Promise<unknown> {
  const { resolveOrgRegion } = await import("./region.js");
  const regionUrl = await resolveOrgRegion(orgSlug);
  const client = createRegionClient(regionUrl);

  return withApiSpan(
    "POST",
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    async () => {
      // The hey-api SDK doesn't support the run_id parameter directly,
      // so we use a raw request
      const response = await client.post<{ 200: unknown }>({
        url: `/api/0/organizations/${orgSlug}/issues/${issueId}/autofix/`,
        body: {
          run_id: runId,
          step: "solution",
        },
      });
      return extractData(response);
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// User
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the currently authenticated user's information.
 * Used for setting user context in telemetry.
 */
export function getCurrentUser(): Promise<SentryUser> {
  const client = createRegionClient(CONTROL_SILO_URL);

  return withApiSpan("GET", "/users/me/", async () => {
    // This endpoint isn't in hey-api, use raw client
    const response = await client.get<{ 200: SentryUser }>({
      url: "/api/0/users/me/",
    });
    return extractData(response);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw API Request (for sentry api command)
// ─────────────────────────────────────────────────────────────────────────────

type RawApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  params?: Record<string, string | number | boolean | string[] | undefined>;
  headers?: Record<string, string>;
};

/** Header to mark requests as retries, preventing infinite retry loops */
const RETRY_MARKER_HEADER = "x-sentry-cli-retry";

/**
 * Execute a request with 401 retry using token refresh.
 */
async function executeWithRetry(
  initialRequest: () => Promise<Response>,
  retryRequest: () => Promise<Response | null>
): Promise<Response> {
  const response = await initialRequest();
  if (response.status !== 401) {
    return response;
  }
  try {
    const retryResponse = await retryRequest();
    return retryResponse ?? response;
  } catch {
    return response;
  }
}

/**
 * Build the full URL for a raw API request.
 */
function buildRawRequestUrl(
  endpoint: string,
  params?: Record<string, string | number | boolean | string[] | undefined>
): string {
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;
  const searchParams = buildSearchParams(params);
  const baseUrl = getDefaultBaseUrl();
  const url = `${baseUrl}/api/0${normalizedEndpoint}`;
  return searchParams ? `${url}?${searchParams.toString()}` : url;
}

/**
 * Check if custom headers include Content-Type (case-insensitive).
 */
function hasCustomContentType(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
}

/**
 * Make a raw API request that returns full response details.
 * Unlike other functions, this does not throw on non-2xx responses.
 * Used by the 'sentry api' command for direct API access.
 *
 * @param endpoint - API endpoint path (e.g., "/organizations/")
 * @param options - Request options including method, body, params, and custom headers
 * @returns Response status, headers, and parsed body
 * @throws {AuthError} Only on authentication failure (not on API errors)
 */
export function rawApiRequest(
  endpoint: string,
  options: RawApiRequestOptions = {}
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const { method = "GET", body, params, headers: customHeaders = {} } = options;

  return withApiSpan(method, endpoint, async () => {
    const fullUrl = buildRawRequestUrl(endpoint, params);
    const isStringBody = typeof body === "string";

    // Build headers - only add Content-Type: application/json if user didn't
    // provide one and body is not a string
    const headers: Record<string, string> = { ...customHeaders };
    if (!(hasCustomContentType(customHeaders) || isStringBody)) {
      headers["Content-Type"] = "application/json";
    }

    // Serialize body
    let requestBody: string | undefined;
    if (body !== undefined) {
      requestBody = isStringBody ? (body as string) : JSON.stringify(body);
    }

    // Get auth token
    const { refreshToken } = await import("./db/auth.js");
    const { token } = await refreshToken();

    const makeRequest = (authToken: string, isRetry: boolean) =>
      fetch(fullUrl, {
        method,
        headers: {
          ...headers,
          Authorization: `Bearer ${authToken}`,
          ...(isRetry ? { [RETRY_MARKER_HEADER]: "1" } : {}),
        },
        body: requestBody,
      });

    // Initial request with 401 retry
    const response = await executeWithRetry(
      () => makeRequest(token, false),
      async () => {
        const { token: newToken, refreshed } = await refreshToken({
          force: true,
        });
        return refreshed ? makeRequest(newToken, true) : null;
      }
    );

    return parseRawResponse(response);
  });
}

/**
 * Parse response into raw API response format.
 */
async function parseRawResponse(
  response: Response
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, headers: response.headers, body };
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy apiRequest and apiRequestToRegion (for backward compatibility)
// ─────────────────────────────────────────────────────────────────────────────

type ApiRequestOptions<T = unknown> = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  params?: Record<string, string | number | boolean | string[] | undefined>;
  schema?: import("zod").ZodType<T>;
};

/**
 * Make an authenticated request to the Sentry API.
 * This is a legacy function - prefer using specific functions like listOrganizations().
 *
 * @deprecated Use specific API functions instead
 */
export function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<T> {
  const { method = "GET", body, params, schema } = options;
  const client = createRegionClient(getDefaultBaseUrl());

  return withApiSpan(method, endpoint, async () => {
    const normalizedEndpoint = endpoint.startsWith("/")
      ? endpoint
      : `/${endpoint}`;
    const url = `/api/0${normalizedEndpoint}`;

    const searchParams = buildSearchParams(params);
    const fullUrl = searchParams ? `${url}?${searchParams.toString()}` : url;

    let response: unknown;
    switch (method) {
      case "GET":
        response = await client.get({ url: fullUrl });
        break;
      case "POST":
        response = await client.post({ url: fullUrl, body });
        break;
      case "PUT":
        response = await client.put({ url: fullUrl, body });
        break;
      case "DELETE":
        response = await client.delete({ url: fullUrl });
        break;
      case "PATCH":
        response = await client.patch({ url: fullUrl, body });
        break;
      default:
        response = await client.get({ url: fullUrl });
    }

    const data = extractData(response as { data?: T }) as T;

    if (schema) {
      return schema.parse(data);
    }

    return data;
  });
}

/**
 * Make an authenticated request to a specific Sentry region.
 * This is a legacy function - prefer using specific functions.
 *
 * @deprecated Use specific API functions instead
 */
export function apiRequestToRegion<T>(
  regionUrl: string,
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<T> {
  const { method = "GET", body, params, schema } = options;
  const client = createRegionClient(regionUrl);

  return withApiSpan(method, endpoint, async () => {
    const normalizedEndpoint = endpoint.startsWith("/")
      ? endpoint
      : `/${endpoint}`;
    const url = `/api/0${normalizedEndpoint}`;

    const searchParams = buildSearchParams(params);
    const fullUrl = searchParams ? `${url}?${searchParams.toString()}` : url;

    let response: unknown;
    switch (method) {
      case "GET":
        response = await client.get({ url: fullUrl });
        break;
      case "POST":
        response = await client.post({ url: fullUrl, body });
        break;
      case "PUT":
        response = await client.put({ url: fullUrl, body });
        break;
      case "DELETE":
        response = await client.delete({ url: fullUrl });
        break;
      case "PATCH":
        response = await client.patch({ url: fullUrl, body });
        break;
      default:
        response = await client.get({ url: fullUrl });
    }

    const data = extractData(response as { data?: T }) as T;

    if (schema) {
      return schema.parse(data);
    }

    return data;
  });
}
