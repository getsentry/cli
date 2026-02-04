/**
 * hey-api Client Setup
 *
 * Configures the hey-api generated client with:
 * - Multi-region support (dynamic baseUrl per region)
 * - Token refresh on 401 responses
 * - Error transformation to CLI error classes
 * - Telemetry spans for HTTP requests
 */

import {
  type Client,
  createClient,
  type ResolvedRequestOptions,
} from "../client/client/index.js";
import { DEFAULT_SENTRY_URL, getUserAgent } from "./constants.js";
import { refreshToken } from "./db/auth.js";
import { ApiError, AuthError } from "./errors.js";
import { withHttpSpan } from "./telemetry.js";

/** Header to mark requests as retries, preventing infinite retry loops */
const RETRY_MARKER_HEADER = "x-sentry-cli-retry";

/**
 * Token provider for hey-api auth.
 * Called on each request to get the current bearer token.
 */
export async function getToken(): Promise<string> {
  const { token } = await refreshToken();
  return token;
}

/**
 * Get the default Sentry API base URL.
 * Supports self-hosted instances via SENTRY_URL env var.
 */
export function getDefaultBaseUrl(): string {
  return process.env.SENTRY_URL || DEFAULT_SENTRY_URL;
}

/**
 * Create a hey-api client configured for a specific region.
 *
 * The hey-api SDK functions include `/api/0/` in their URL paths,
 * so baseUrl should just be the region URL without `/api/0`.
 *
 * @param regionUrl - The region's base URL (e.g., https://us.sentry.io)
 * @returns Configured Client instance with interceptors
 */
export function createRegionClient(regionUrl: string): Client {
  // Remove trailing slash if present
  const baseUrl = regionUrl.endsWith("/") ? regionUrl.slice(0, -1) : regionUrl;

  const client = createClient({
    baseUrl,
    // Always parse as JSON - Sentry API always returns JSON
    // This ensures compatibility with responses that don't set Content-Type
    parseAs: "json",
    headers: {
      "User-Agent": getUserAgent(),
      "Content-Type": "application/json",
    },
  });

  setupInterceptors(client);
  return client;
}

/**
 * Create a hey-api client for the default region.
 * Used for endpoints that don't require region-specific routing.
 */
export function createDefaultClient(): Client {
  return createRegionClient(getDefaultBaseUrl());
}

/**
 * Setup interceptors for the client.
 *
 * Adds:
 * - Request interceptor: Adds auth token, telemetry
 * - Response interceptor: Handles 401 token refresh
 * - Error interceptor: Transforms errors to CLI error classes
 */
function setupInterceptors(client: Client): void {
  // Request interceptor - add auth token
  client.interceptors.request.use(async (request, _options) => {
    // getToken() throws AuthError if not authenticated
    // We let this propagate to fail early with a clear error message
    const token = await getToken();
    request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  });

  // Response interceptor - handle 401 token refresh
  client.interceptors.response.use(
    async (response, request, options: ResolvedRequestOptions) => {
      // On 401, try to refresh the token and retry
      const isRetry = request.headers.get(RETRY_MARKER_HEADER) === "1";
      if (response.status === 401 && !isRetry) {
        try {
          const { token: newToken, refreshed } = await refreshToken({
            force: true,
          });

          // Only retry if token was actually refreshed (not for manual API tokens)
          if (refreshed) {
            // Create a new request with the refreshed token
            const newHeaders = new Headers(request.headers);
            newHeaders.set("Authorization", `Bearer ${newToken}`);
            newHeaders.set(RETRY_MARKER_HEADER, "1");

            const retryResponse = await fetch(
              new Request(request.url, {
                method: request.method,
                headers: newHeaders,
                body: options.serializedBody,
              })
            );

            return retryResponse;
          }
        } catch {
          // Token refresh failed, return original 401 response
          return response;
        }
      }
      return response;
    }
  );

  // Error interceptor - transform to CLI error classes
  client.interceptors.error.use(
    async (
      error: unknown,
      response: Response | undefined,
      request: Request,
      _options
    ) => transformError(error, response, request)
  );
}

/**
 * Extract error detail from response body.
 */
async function extractErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.clone().text();
    try {
      const json = JSON.parse(text) as { detail?: string };
      return json.detail ?? text;
    } catch {
      return text;
    }
  } catch {
    return response.statusText;
  }
}

/**
 * Transform HTTP response errors into CLI error classes.
 */
async function transformHttpError(
  response: Response,
  request: Request
): Promise<Error> {
  const status = response.status;
  const detail = await extractErrorDetail(response);

  // Transform 401 to AuthError
  if (status === 401) {
    return new AuthError("invalid", detail);
  }

  // Transform 403 to AuthError if it's an auth issue
  if (status === 403 && detail.toLowerCase().includes("auth")) {
    return new AuthError("invalid", detail);
  }

  return new ApiError(
    `API request failed: ${status} ${response.statusText}`,
    status,
    detail,
    request.url
  );
}

/**
 * Transform raw errors into CLI error classes.
 */
async function transformError(
  error: unknown,
  response: Response | undefined,
  request: Request
): Promise<Error> {
  // Already a CLI error, pass through
  if (error instanceof ApiError || error instanceof AuthError) {
    return error;
  }

  // Network errors (fetch failures, timeouts)
  if (error instanceof TypeError) {
    return new ApiError(`Network error: ${error.message}`, 0, error.message);
  }

  // HTTP errors from response
  if (response) {
    return await transformHttpError(response, request);
  }

  // Unknown error type
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError(`Request failed: ${message}`, 0, message);
}

/**
 * Execute an API call with telemetry span wrapping.
 *
 * @param method - HTTP method
 * @param url - Request URL or path
 * @param fn - The async function that performs the request
 * @returns The result of the function
 */
export function withApiSpan<T>(
  method: string,
  url: string,
  fn: () => Promise<T>
): Promise<T> {
  return withHttpSpan(method, url, fn);
}

/**
 * Throw the appropriate error for an API error response.
 */
function throwApiError(error: unknown): never {
  if (error instanceof Error) {
    throw error;
  }
  const detail = typeof error === "string" ? error : JSON.stringify(error);
  throw new ApiError("API returned error", 0, detail);
}

/**
 * Helper to extract data from hey-api response.
 * Handles both throwOnError modes and response styles.
 *
 * hey-api returns:
 * - Success: { data, request, response }
 * - Error: { error, request, response } (no data property)
 */
export function extractData<T>(
  response: { data?: T; error?: unknown } | T | undefined
): T {
  if (response === undefined) {
    throw new ApiError("Empty response from API", 0);
  }

  // Check if response is an object (could be hey-api response structure)
  if (typeof response === "object" && response !== null) {
    const r = response as { data?: T; error?: unknown };

    // Check for error first (error responses don't have data property)
    if ("error" in r && r.error !== undefined) {
      throwApiError(r.error);
    }

    // Check for data property (successful responses)
    if ("data" in r) {
      if (r.data === undefined) {
        throw new ApiError("Empty data in API response", 0);
      }
      return r.data;
    }
  }

  // Direct data response (arrays, objects without data/error structure)
  return response as T;
}
