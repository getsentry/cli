/**
 * Sentry API Client Configuration
 *
 * Provides request configuration for @sentry/api SDK functions,
 * including authentication, retry logic, timeout, and multi-region support.
 *
 * Instead of managing client instances, we pass configuration per-request
 * through the SDK function options (baseUrl, fetch, headers).
 */

import { DEFAULT_SENTRY_URL, getUserAgent } from "./constants.js";
import { refreshToken } from "./db/auth.js";
import { withHttpSpan } from "./telemetry.js";

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

/** Header to mark requests as retries, preventing infinite token refresh loops */
const RETRY_MARKER_HEADER = "x-sentry-cli-retry";

/** Calculate exponential backoff delay, capped at MAX_BACKOFF_MS */
function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Check if an error is a user-initiated abort */
function isUserAbort(error: unknown, signal?: AbortSignal | null): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError" &&
    Boolean(signal?.aborted)
  );
}

/**
 * Prepare request headers with auth token and default headers.
 *
 * Only sets Authorization and User-Agent. Content-Type is intentionally NOT
 * set here — callers are responsible for setting it based on their needs:
 * - SDK functions set their own Content-Type
 * - apiRequestToRegion always sends JSON and sets it explicitly
 * - rawApiRequest may or may not want Content-Type (e.g., string bodies)
 *
 * The returned Headers instance is intentionally shared and mutated across
 * retry attempts (e.g., handleUnauthorized updates the Authorization header
 * and sets the retry marker). Do not clone before passing to retry logic.
 */
function prepareHeaders(init: RequestInit | undefined, token: string): Headers {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", getUserAgent());
  }
  return headers;
}

/**
 * Handle 401 response by refreshing the token.
 * @returns true if the token was refreshed and request should be retried
 */
async function handleUnauthorized(headers: Headers): Promise<boolean> {
  if (headers.get(RETRY_MARKER_HEADER)) {
    return false;
  }
  try {
    const { token: newToken, refreshed } = await refreshToken({ force: true });
    if (refreshed) {
      headers.set("Authorization", `Bearer ${newToken}`);
      headers.set(RETRY_MARKER_HEADER, "1");
      return true;
    }
  } catch {
    // Token refresh failed
  }
  return false;
}

/** Link an external abort signal to an AbortController */
function linkAbortSignal(
  signal: AbortSignal | undefined | null,
  controller: AbortController
): void {
  if (!signal) {
    return;
  }
  if (signal.aborted) {
    controller.abort();
    return;
  }
  signal.addEventListener("abort", () => controller.abort(), { once: true });
}

/**
 * Execute a single fetch attempt with timeout.
 *
 * @returns The Response, or throws on network/timeout errors
 */
async function fetchWithTimeout(
  input: Request | string | URL,
  init: RequestInit | undefined,
  headers: Headers,
  externalSignal?: AbortSignal | null
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  linkAbortSignal(externalSignal, controller);

  try {
    const response = await fetch(input, {
      ...init,
      headers,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/** Result of a single fetch attempt - drives the retry loop */
type AttemptResult =
  | { action: "done"; response: Response }
  | { action: "retry" }
  | { action: "throw"; error: unknown };

/**
 * Decide what to do with a successful HTTP response.
 * Returns 'done' for final responses, 'retry' for retryable errors and 401s.
 */
async function handleResponse(
  response: Response,
  headers: Headers,
  isLastAttempt: boolean
): Promise<AttemptResult> {
  if (response.status === 401) {
    const refreshed = await handleUnauthorized(headers);
    return refreshed ? { action: "retry" } : { action: "done", response };
  }

  if (RETRYABLE_STATUS_CODES.includes(response.status) && !isLastAttempt) {
    return { action: "retry" };
  }

  return { action: "done", response };
}

/**
 * Decide what to do with a fetch error.
 * Throws immediately for user-initiated aborts or last attempt;
 * returns 'retry' otherwise.
 */
function handleFetchError(
  error: unknown,
  signal: AbortSignal | undefined | null,
  isLastAttempt: boolean
): AttemptResult {
  if (isUserAbort(error, signal)) {
    return { action: "throw", error };
  }
  if (isLastAttempt) {
    return { action: "throw", error };
  }
  return { action: "retry" };
}

/** Extract the URL pathname for span naming */
function extractUrlPath(input: Request | string | URL): string {
  let raw: string;
  if (typeof input === "string") {
    raw = input;
  } else if (input instanceof URL) {
    raw = input.href;
  } else {
    raw = input.url;
  }
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}

/**
 * Create a fetch function with authentication, timeout, retry, and 401 refresh.
 *
 * This wraps the native fetch with:
 * - Auth token injection (Bearer token)
 * - Request timeout via AbortController
 * - Automatic retry on transient HTTP errors (408, 429, 5xx)
 * - 401 handling: force-refreshes the token and retries once
 * - Exponential backoff between retries
 * - User-Agent header for API analytics
 * - Automatic HTTP span tracing for every request
 *
 * @returns A fetch-compatible function for use with @sentry/api SDK functions
 */
function createAuthenticatedFetch(): (
  input: Request | string | URL,
  init?: RequestInit
) => Promise<Response> {
  return function authenticatedFetch(
    input: Request | string | URL,
    init?: RequestInit
  ): Promise<Response> {
    const method = init?.method ?? "GET";
    const urlPath = extractUrlPath(input);

    return withHttpSpan(method, urlPath, async () => {
      const { token } = await refreshToken();
      const headers = prepareHeaders(init, token);

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const isLastAttempt = attempt === MAX_RETRIES;
        const result = await executeAttempt(
          input,
          init,
          headers,
          isLastAttempt
        );

        if (result.action === "done") {
          return result.response;
        }
        if (result.action === "throw") {
          throw result.error;
        }

        await Bun.sleep(backoffDelay(attempt));
      }

      // Unreachable: the last attempt always returns 'done' or 'throw'
      throw new Error("Exhausted all retry attempts");
    });
  };
}

/**
 * Execute a single fetch attempt and classify the outcome.
 */
async function executeAttempt(
  input: Request | string | URL,
  init: RequestInit | undefined,
  headers: Headers,
  isLastAttempt: boolean
): Promise<AttemptResult> {
  try {
    const response = await fetchWithTimeout(input, init, headers, init?.signal);
    return handleResponse(response, headers, isLastAttempt);
  } catch (error) {
    return handleFetchError(error, init?.signal, isLastAttempt);
  }
}

/** Singleton authenticated fetch instance - reused across all requests */
let cachedFetch: typeof fetch | null = null;

/**
 * Get the shared authenticated fetch instance.
 * Cast to `typeof fetch` for compatibility with @sentry/api SDK options.
 */
function getAuthenticatedFetch(): typeof fetch {
  if (!cachedFetch) {
    cachedFetch = createAuthenticatedFetch() as unknown as typeof fetch;
  }
  return cachedFetch;
}

/**
 * Get the Sentry API base URL.
 * Supports self-hosted instances via SENTRY_URL env var.
 */
export function getApiBaseUrl(): string {
  return process.env.SENTRY_URL || DEFAULT_SENTRY_URL;
}

/**
 * Get the control silo URL.
 * This is always sentry.io for SaaS, or the custom URL for self-hosted.
 */
export function getControlSiloUrl(): string {
  return CONTROL_SILO_URL;
}

/**
 * Get request configuration for an @sentry/api SDK function call.
 *
 * Returns the common options needed by every SDK function call:
 * - `baseUrl`: The API base URL for the target region
 * - `fetch`: Authenticated fetch with retry, timeout, and 401 refresh
 * - `throwOnError`: Always false (we handle errors ourselves)
 *
 * @param regionUrl - The base URL for the target region (e.g., https://us.sentry.io)
 * @returns Configuration object to spread into SDK function options
 *
 * @example
 * ```ts
 * const config = getSdkConfig("https://us.sentry.io");
 * const result = await listYourOrganizations({ ...config });
 * ```
 */
export function getSdkConfig(regionUrl: string) {
  const normalizedBase = regionUrl.endsWith("/")
    ? regionUrl.slice(0, -1)
    : regionUrl;

  return {
    // SDK functions already include /api/0/ in their URL paths,
    // so baseUrl should be the plain region URL without /api/0.
    baseUrl: normalizedBase,
    fetch: getAuthenticatedFetch(),
    throwOnError: false as const,
  };
}

/**
 * Get SDK config for the default API (control silo or self-hosted).
 */
export function getDefaultSdkConfig() {
  return getSdkConfig(getApiBaseUrl());
}

/**
 * Get SDK config for the control silo.
 * Used for endpoints that are always on the control silo (OAuth, user accounts, regions).
 */
export function getControlSdkConfig() {
  return getSdkConfig(CONTROL_SILO_URL);
}

/**
 * Reset the cached fetch instance.
 * Useful for testing or when auth state changes.
 */
export function resetAuthenticatedFetch(): void {
  cachedFetch = null;
}
