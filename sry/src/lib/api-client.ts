import type {
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
} from "../types/index.js";
import { getAuthToken } from "./config.js";

const SENTRY_API_BASE = "https://sentry.io/api/0";

export class SentryApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "SentryApiError";
  }
}

interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Make an authenticated request to the Sentry API
 */
export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const token = getAuthToken();

  if (!token) {
    throw new SentryApiError(
      "Not authenticated. Run 'sry auth login' first.",
      401
    );
  }

  const { method = "GET", body, params } = options;

  // Build URL with query parameters
  let url = endpoint.startsWith("http")
    ? endpoint
    : `${SENTRY_API_BASE}${endpoint}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail || JSON.stringify(errorBody);
    } catch {
      detail = await response.text();
    }
    throw new SentryApiError(
      `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      detail
    );
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

/**
 * Make a raw API request (for the 'sry api' command)
 */
export async function rawApiRequest(
  endpoint: string,
  options: ApiRequestOptions & { headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const token = getAuthToken();

  if (!token) {
    throw new SentryApiError(
      "Not authenticated. Run 'sry auth login' first.",
      401
    );
  }

  const { method = "GET", body, params, headers: customHeaders = {} } = options;

  let url = endpoint.startsWith("http")
    ? endpoint
    : `${SENTRY_API_BASE}${endpoint}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...customHeaders,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
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

// High-level API methods

/**
 * List organizations the user has access to
 */
export async function listOrganizations(): Promise<SentryOrganization[]> {
  return apiRequest<SentryOrganization[]>("/organizations/");
}

/**
 * Get a specific organization
 */
export async function getOrganization(
  orgSlug: string
): Promise<SentryOrganization> {
  return apiRequest<SentryOrganization>(`/organizations/${orgSlug}/`);
}

/**
 * List projects in an organization
 */
export async function listProjects(orgSlug: string): Promise<SentryProject[]> {
  return apiRequest<SentryProject[]>(`/organizations/${orgSlug}/projects/`);
}

/**
 * Get a specific project
 */
export async function getProject(
  orgSlug: string,
  projectSlug: string
): Promise<SentryProject> {
  return apiRequest<SentryProject>(`/projects/${orgSlug}/${projectSlug}/`);
}

/**
 * List issues for a project
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
    }
  );
}

/**
 * Get a specific issue by ID
 */
export async function getIssue(issueId: string): Promise<SentryIssue> {
  return apiRequest<SentryIssue>(`/issues/${issueId}/`);
}

/**
 * Get the latest event for an issue
 */
export async function getLatestEvent(issueId: string): Promise<SentryEvent> {
  return apiRequest<SentryEvent>(`/issues/${issueId}/events/latest/`);
}

/**
 * Update an issue's status
 */
export async function updateIssueStatus(
  issueId: string,
  status: "resolved" | "unresolved" | "ignored"
): Promise<SentryIssue> {
  return apiRequest<SentryIssue>(`/issues/${issueId}/`, {
    method: "PUT",
    body: { status },
  });
}
