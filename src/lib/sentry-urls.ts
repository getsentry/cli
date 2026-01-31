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

// ─────────────────────────────────────────────────────────────────────────────
// Settings URLs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build URL to organization settings page.
 *
 * @param orgSlug - Organization slug
 * @param hash - Optional anchor hash (e.g., "hideAiFeatures")
 * @returns Full URL to the organization settings page
 */
export function buildOrgSettingsUrl(orgSlug: string, hash?: string): string {
  const url = `${getSentryBaseUrl()}/settings/${orgSlug}/`;
  return hash ? `${url}#${hash}` : url;
}

/**
 * Build URL to Seer settings page.
 *
 * @param orgSlug - Organization slug
 * @returns Full URL to the Seer settings page
 */
export function buildSeerSettingsUrl(orgSlug: string): string {
  return `${getSentryBaseUrl()}/settings/${orgSlug}/seer/`;
}

/**
 * Build URL to billing page with optional product filter.
 *
 * @param orgSlug - Organization slug
 * @param product - Optional product to highlight (e.g., "seer")
 * @returns Full URL to the billing overview page
 */
export function buildBillingUrl(orgSlug: string, product?: string): string {
  const base = `${getSentryBaseUrl()}/settings/${orgSlug}/billing/overview/`;
  return product ? `${base}?product=${product}` : base;
}
