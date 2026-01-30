/**
 * Sentry API Client
 *
 * Handles authenticated requests to the Sentry API.
 * Uses ky for retry logic, timeouts, and better error handling.
 */

import kyHttpClient, { type KyInstance } from "ky";
import { z } from "zod";
import {
  type ProjectKey,
  ProjectKeySchema,
  type SentryEvent,
  SentryEventSchema,
  type SentryIssue,
  SentryIssueSchema,
  type SentryOrganization,
  SentryOrganizationSchema,
  type SentryProject,
  SentryProjectSchema,
  type TraceResponse,
  type TraceSpan,
} from "../types/index.js";
import type { AutofixResponse, AutofixState } from "../types/seer.js";
import { getUserAgent } from "./constants.js";
import { refreshToken } from "./db/auth.js";
import { ApiError } from "./errors.js";

const DEFAULT_SENTRY_URL = "https://sentry.io";

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30_000;

/** Maximum retry attempts for failed requests */
const MAX_RETRIES = 2;

/** Maximum backoff delay between retries in milliseconds */
const MAX_BACKOFF_MS = 10_000;

/** HTTP status codes that trigger automatic retry */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

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

// ─────────────────────────────────────────────────────────────────────────────
// Request Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Core Request Functions
// ─────────────────────────────────────────────────────────────────────────────

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
export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions<T> = {}
): Promise<T> {
  const { method = "GET", body, params, schema } = options;
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
}

// ─────────────────────────────────────────────────────────────────────────────
// High-level API Methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List organizations the user has access to
 */
export function listOrganizations(): Promise<SentryOrganization[]> {
  return apiRequest<SentryOrganization[]>("/organizations/", {
    schema: z.array(SentryOrganizationSchema),
  });
}

/**
 * Get a specific organization
 */
export function getOrganization(orgSlug: string): Promise<SentryOrganization> {
  return apiRequest<SentryOrganization>(`/organizations/${orgSlug}/`, {
    schema: SentryOrganizationSchema,
  });
}

/**
 * List projects in an organization
 */
export function listProjects(orgSlug: string): Promise<SentryProject[]> {
  return apiRequest<SentryProject[]>(`/organizations/${orgSlug}/projects/`, {
    schema: z.array(SentryProjectSchema),
  });
}

/**
 * Find a project by DSN public key.
 *
 * Uses the /api/0/projects/ endpoint with query=dsn:<key> to search
 * across all accessible projects. This works for both SaaS and self-hosted
 * DSNs, even when the org ID is not embedded in the DSN.
 *
 * @param publicKey - The DSN public key (username portion of DSN URL)
 * @returns The matching project, or null if not found
 */
export async function findProjectByDsnKey(
  publicKey: string
): Promise<SentryProject | null> {
  const projects = await apiRequest<SentryProject[]>("/projects/", {
    params: { query: `dsn:${publicKey}` },
    schema: z.array(SentryProjectSchema),
  });

  return projects[0] ?? null;
}

/**
 * Get a specific project
 */
export function getProject(
  orgSlug: string,
  projectSlug: string
): Promise<SentryProject> {
  return apiRequest<SentryProject>(`/projects/${orgSlug}/${projectSlug}/`, {
    schema: SentryProjectSchema,
  });
}

/**
 * Get project keys (DSNs) for a project
 */
export function getProjectKeys(
  orgSlug: string,
  projectSlug: string
): Promise<ProjectKey[]> {
  return apiRequest<ProjectKey[]>(`/projects/${orgSlug}/${projectSlug}/keys/`, {
    schema: z.array(ProjectKeySchema),
  });
}

/**
 * List issues for a project
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
  return apiRequest<SentryIssue[]>(
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
 * Get an issue by short ID (e.g., SPOTLIGHT-ELECTRON-4D)
 * Requires organization context to resolve the short ID.
 * The shortId is normalized to uppercase for case-insensitive matching.
 *
 * @see https://docs.sentry.io/api/events/retrieve-an-issue/
 */
export function getIssueByShortId(
  orgSlug: string,
  shortId: string
): Promise<SentryIssue> {
  // Normalize to uppercase for case-insensitive matching
  const normalizedShortId = shortId.toUpperCase();
  return apiRequest<SentryIssue>(
    `/organizations/${orgSlug}/issues/${normalizedShortId}/`,
    {
      schema: SentryIssueSchema,
    }
  );
}

/**
 * Get the latest event for an issue.
 * Uses org-scoped endpoint for proper multi-region support.
 *
 * @param orgSlug - Organization slug (required for multi-region routing)
 * @param issueId - Issue ID (numeric)
 */
export function getLatestEvent(
  orgSlug: string,
  issueId: string
): Promise<SentryEvent> {
  return apiRequest<SentryEvent>(
    `/organizations/${orgSlug}/issues/${issueId}/events/latest/`
  );
}

/**
 * Get a specific event by ID
 * @see https://docs.sentry.io/api/events/retrieve-an-event-for-a-project/
 */
export function getEvent(
  orgSlug: string,
  projectSlug: string,
  eventId: string
): Promise<SentryEvent> {
  return apiRequest<SentryEvent>(
    `/projects/${orgSlug}/${projectSlug}/events/${eventId}/`,
    {
      schema: SentryEventSchema,
    }
  );
}

/**
 * Get trace data including all transactions and spans.
 * Returns the full trace tree for visualization.
 *
 * @param orgSlug - Organization slug
 * @param traceId - The trace ID (from event.contexts.trace.trace_id)
 * @returns Trace response with transactions array and orphan_errors
 */
export function getTrace(
  orgSlug: string,
  traceId: string
): Promise<TraceResponse> {
  return apiRequest<TraceResponse>(
    `/organizations/${orgSlug}/events-trace/${traceId}/`
  );
}

/**
 * Get detailed trace with nested children structure.
 * Uses the same endpoint as Sentry's dashboard for hierarchical span trees.
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
  return apiRequest<TraceSpan[]>(
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

// ─────────────────────────────────────────────────────────────────────────────
// Autofix (Seer) API Methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trigger root cause analysis for an issue using Seer AI.
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
  return apiRequest<{ run_id: number }>(
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    {
      method: "POST",
      body: { step: "root_cause" },
    }
  );
}

/**
 * Get the current autofix state for an issue.
 *
 * @param orgSlug - The organization slug
 * @param issueId - The numeric Sentry issue ID
 * @returns The autofix state, or null if no autofix has been run
 */
export async function getAutofixState(
  orgSlug: string,
  issueId: string
): Promise<AutofixState | null> {
  const response = await apiRequest<AutofixResponse>(
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`
  );

  return response.autofix;
}

/**
 * Trigger solution planning for an existing autofix run.
 * Continues from root cause analysis to generate a solution.
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
  return apiRequest(`/organizations/${orgSlug}/issues/${issueId}/autofix/`, {
    method: "POST",
    body: {
      run_id: runId,
      step: "solution",
    },
  });
}
