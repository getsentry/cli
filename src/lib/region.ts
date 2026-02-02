/**
 * Region resolution for multi-region Sentry support.
 *
 * Provides utilities to resolve the correct region URL for an organization,
 * using cached data when available or fetching from the API when needed.
 */

import { getOrgRegion, setOrgRegion } from "./db/regions.js";
import { getSentryBaseUrl, isSentrySaasUrl } from "./sentry-urls.js";

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
    const baseUrl = getSentryBaseUrl();
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
    return getSentryBaseUrl();
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
