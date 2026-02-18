/**
 * Sentry URL Parser
 *
 * Extracts org, project, issue, event, and trace identifiers from Sentry web URLs.
 * Supports both SaaS (*.sentry.io) and self-hosted instances.
 *
 * For self-hosted URLs, also configures the SENTRY_URL environment variable
 * so that subsequent API calls reach the correct instance.
 */

import { isSentrySaasUrl } from "./sentry-urls.js";

/**
 * Components extracted from a Sentry web URL.
 *
 * All fields except `baseUrl` and `org` are optional — presence depends
 * on which URL pattern was matched.
 */
export type ParsedSentryUrl = {
  /** Scheme + host of the Sentry instance (e.g., "https://sentry.io" or "https://sentry.example.com") */
  baseUrl: string;
  /** Organization slug from the URL path */
  org: string;
  /** Issue identifier — numeric group ID (e.g., "32886") or short ID (e.g., "CLI-G") */
  issueId?: string;
  /** Event ID from /issues/{id}/events/{eventId}/ paths */
  eventId?: string;
  /** Project slug from /settings/{org}/projects/{project}/ paths */
  project?: string;
  /** Trace ID from /organizations/{org}/traces/{traceId}/ paths */
  traceId?: string;
};

/**
 * Try to match /organizations/{org}/... path patterns.
 *
 * @returns Parsed result or null if pattern doesn't match
 */
function matchOrganizationsPath(
  baseUrl: string,
  segments: string[]
): ParsedSentryUrl | null {
  if (segments[0] !== "organizations" || !segments[1]) {
    return null;
  }

  const org = segments[1];

  // /organizations/{org}/issues/{id}/ (optionally with /events/{eventId}/)
  if (segments[2] === "issues" && segments[3]) {
    const eventId =
      segments[4] === "events" && segments[5] ? segments[5] : undefined;
    return { baseUrl, org, issueId: segments[3], eventId };
  }

  // /organizations/{org}/traces/{traceId}/
  if (segments[2] === "traces" && segments[3]) {
    return { baseUrl, org, traceId: segments[3] };
  }

  // /organizations/{org}/ (org only)
  return { baseUrl, org };
}

/**
 * Try to match /settings/{org}/projects/{project}/ path pattern.
 *
 * @returns Parsed result or null if pattern doesn't match
 */
function matchSettingsPath(
  baseUrl: string,
  segments: string[]
): ParsedSentryUrl | null {
  if (
    segments[0] !== "settings" ||
    !segments[1] ||
    segments[2] !== "projects" ||
    !segments[3]
  ) {
    return null;
  }

  return { baseUrl, org: segments[1], project: segments[3] };
}

/**
 * Parse a Sentry web URL and extract its components.
 *
 * Recognizes these path patterns (both SaaS and self-hosted):
 * - `/organizations/{org}/issues/{id}/`
 * - `/organizations/{org}/issues/{id}/events/{eventId}/`
 * - `/settings/{org}/projects/{project}/`
 * - `/organizations/{org}/traces/{traceId}/`
 * - `/organizations/{org}/`
 *
 * @param input - Raw string that may or may not be a URL
 * @returns Parsed components, or null if input is not a recognized Sentry URL
 */
export function parseSentryUrl(input: string): ParsedSentryUrl | null {
  // Quick reject — must look like a URL
  if (!(input.startsWith("http://") || input.startsWith("https://"))) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const baseUrl = `${url.protocol}//${url.host}`;
  const segments = url.pathname.split("/").filter(Boolean);

  return (
    matchOrganizationsPath(baseUrl, segments) ??
    matchSettingsPath(baseUrl, segments)
  );
}

/**
 * Configure `SENTRY_URL` for self-hosted instances detected from a parsed URL.
 *
 * Sets the env var when the URL is NOT a Sentry SaaS domain (*.sentry.io),
 * since SaaS uses multi-region routing instead.
 *
 * The parsed URL always takes precedence over any existing `SENTRY_URL` value
 * because an explicit URL argument is the strongest signal of user intent.
 *
 * @param baseUrl - The scheme + host extracted from the URL (e.g., "https://sentry.example.com")
 */
export function applySentryUrlContext(baseUrl: string): void {
  if (isSentrySaasUrl(baseUrl)) {
    // Clear any self-hosted URL so API calls fall back to default SaaS routing.
    // Without this, a stale SENTRY_URL would route SaaS requests to the wrong host.
    // biome-ignore lint/performance/noDelete: process.env requires delete to truly unset; assignment coerces to string in Node.js
    delete process.env.SENTRY_URL;
    return;
  }
  process.env.SENTRY_URL = baseUrl;
}
