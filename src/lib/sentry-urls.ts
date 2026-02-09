/**
 * Sentry URL Utilities
 *
 * Utilities for constructing Sentry web URLs.
 * Supports self-hosted instances via SENTRY_URL environment variable.
 */

import { DEFAULT_SENTRY_HOST, DEFAULT_SENTRY_URL } from "./constants.js";

/**
 * Get the Sentry web base URL.
 * Supports self-hosted instances via SENTRY_URL env var.
 */
export function getSentryBaseUrl(): string {
  return process.env.SENTRY_URL ?? DEFAULT_SENTRY_URL;
}

/**
 * Check if a URL is a Sentry SaaS domain.
 *
 * Used to determine if multi-region support should be enabled and to
 * validate region URLs before sending authenticated requests.
 *
 * @param url - URL string to validate
 * @returns true if the hostname is sentry.io or a subdomain of sentry.io
 */
export function isSentrySaasUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === DEFAULT_SENTRY_HOST ||
      parsed.hostname.endsWith(`.${DEFAULT_SENTRY_HOST}`)
    );
  } catch {
    return false;
  }
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

// Settings URLs

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

// Profiling URLs

/**
 * Build URL to the profiling flamegraph view for a transaction.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug
 * @param transactionName - Transaction name to view profiles for
 * @returns Full URL to the profiling flamegraph view
 */
export function buildProfileUrl(
  orgSlug: string,
  projectSlug: string,
  transactionName: string
): string {
  const encodedTransaction = encodeURIComponent(transactionName);
  return `${getSentryBaseUrl()}/organizations/${orgSlug}/profiling/profile/${projectSlug}/flamegraph/?query=transaction%3A${encodedTransaction}`;
}

/**
 * Build URL to the profiling summary page for a project.
 *
 * @param orgSlug - Organization slug
 * @param projectId - Numeric project ID (Sentry frontend requires numeric ID for ?project= param)
 * @returns Full URL to the profiling summary page
 */
export function buildProfilingSummaryUrl(
  orgSlug: string,
  projectId: string | number
): string {
  return `${getSentryBaseUrl()}/organizations/${orgSlug}/profiling/?project=${projectId}`;
}

// Logs URLs

/**
 * Build URL to the Logs explorer, optionally filtered to a specific log entry.
 *
 * @param orgSlug - Organization slug
 * @param logId - Optional log item ID to filter to
 * @returns Full URL to the Logs explorer
 */
export function buildLogsUrl(orgSlug: string, logId?: string): string {
  const base = `${getSentryBaseUrl()}/organizations/${orgSlug}/explore/logs/`;
  return logId ? `${base}?query=sentry.item_id:${logId}` : base;
}

/**
 * Build URL to view a trace in Sentry.
 *
 * @param orgSlug - Organization slug
 * @param traceId - Trace ID (32-character hex string)
 * @returns Full URL to the trace view
 */
export function buildTraceUrl(orgSlug: string, traceId: string): string {
  return `${getSentryBaseUrl()}/organizations/${orgSlug}/traces/${traceId}/`;
}
