/**
 * Region resolution for multi-region Sentry support.
 *
 * Provides utilities to resolve the correct region URL for an organization,
 * using cached data when available or fetching from the API when needed.
 */

import { DEFAULT_SENTRY_HOST, DEFAULT_SENTRY_URL } from "./constants.js";
import { getOrgRegion, setOrgRegion } from "./db/regions.js";

/**
 * Get the default API base URL (control silo or self-hosted).
 */
export function getDefaultBaseUrl(): string {
  return process.env.SENTRY_URL || DEFAULT_SENTRY_URL;
}

/**
 * Resolve the region URL for an organization.
 *
 * Resolution order:
 * 1. Check SQLite cache
 * 2. Fetch organization details to get region URL
 * 3. Fall back to default URL if resolution fails
 *
 * @param orgSlug - The organization slug
 * @returns The region URL for the organization
 */
export async function resolveOrgRegion(orgSlug: string): Promise<string> {
  // 1. Check cache first
  const cached = await getOrgRegion(orgSlug);
  if (cached) {
    return cached;
  }

  // 2. Try to fetch org details to get region
  // Import dynamically to avoid circular dependency
  const { apiRequestToRegion } = await import("./api-client.js");
  const { SentryOrganizationSchema } = await import("../types/sentry.js");

  try {
    // First try the default URL - it may route correctly
    const baseUrl = getDefaultBaseUrl();
    const org = await apiRequestToRegion(
      baseUrl,
      `/organizations/${orgSlug}/`,
      { schema: SentryOrganizationSchema }
    );

    const regionUrl = org.links?.regionUrl ?? baseUrl;

    // Cache for future use
    await setOrgRegion(orgSlug, regionUrl);

    return regionUrl;
  } catch {
    // If fetch fails, fall back to default
    // This handles self-hosted instances without multi-region
    return getDefaultBaseUrl();
  }
}

/**
 * Check if a URL is a Sentry SaaS URL (sentry.io or regional subdomain).
 * Used to determine if multi-region support should be enabled.
 *
 * @param url - URL string to check
 * @returns true if the URL is a Sentry SaaS URL
 */
function isSentrySaasUrl(url: string): boolean {
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
 * Check if the CLI is configured for multi-region support.
 * Returns false for self-hosted instances that don't have regional URLs.
 */
export function isMultiRegionEnabled(): boolean {
  // Self-hosted instances (custom SENTRY_URL) typically don't have multi-region
  const baseUrl = process.env.SENTRY_URL;
  if (baseUrl && !isSentrySaasUrl(baseUrl)) {
    return false;
  }
  return true;
}
