/**
 * Sentry URL Utilities
 *
 * Utilities for constructing Sentry web URLs.
 * Supports self-hosted instances via SENTRY_URL environment variable.
 */

const DEFAULT_SENTRY_URL = "https://sentry.io";

/**
 * Get the Sentry web base URL.
 * Supports self-hosted instances via SENTRY_URL env var.
 */
export function getSentryBaseUrl(): string {
  return process.env.SENTRY_URL ?? DEFAULT_SENTRY_URL;
}

/**
 * Build URL to view an organization in Sentry.
 *
 * @param orgSlug - Organization slug
 * @returns Full URL to the organization page
 */
export function buildOrgUrl(orgSlug: string): string {
  return `${getSentryBaseUrl()}/organizations/${orgSlug}/`;
}

/**
 * Build URL to view a project in Sentry.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug
 * @returns Full URL to the project settings page
 */
export function buildProjectUrl(orgSlug: string, projectSlug: string): string {
  return `${getSentryBaseUrl()}/settings/${orgSlug}/projects/${projectSlug}/`;
}

/**
 * Build URL to search for an event in Sentry.
 * Uses the issues search with event.id filter.
 *
 * @param orgSlug - Organization slug
 * @param eventId - Event ID (hexadecimal)
 * @returns Full URL to search results showing the event
 */
export function buildEventSearchUrl(orgSlug: string, eventId: string): string {
  return `${getSentryBaseUrl()}/organizations/${orgSlug}/issues/?query=event.id:${eventId}`;
}
