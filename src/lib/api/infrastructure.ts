/**
 * API Client Infrastructure
 *
 * Shared helpers, types, constants, and raw request functions used by
 * all domain-specific API modules. This is the foundation layer that
 * other modules in `src/lib/api/` import from.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/node-core/light";
import type { z } from "zod";

import { ApiError, AuthError, stringifyUnknown } from "../errors.js";
import { resolveOrgRegion } from "../region.js";
import {
  getApiBaseUrl,
  getDefaultSdkConfig,
  getSdkConfig,
} from "../sentry-client.js";

/** Options for raw API requests to Sentry endpoints. */
export type ApiRequestOptions<T = unknown> = {
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
export function throwApiError(
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
export function unwrapResult<T>(
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
export function unwrapPaginatedResult<T>(
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
export async function getOrgSdkConfig(orgSlug: string) {
  const regionUrl = await resolveOrgRegion(orgSlug);
  return getSdkConfig(regionUrl);
}

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
export const MAX_PAGINATION_PAGES = Math.max(
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
