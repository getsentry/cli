/**
 * Region resolution for multi-region Sentry support.
 *
 * Provides utilities to resolve the correct region URL for an organization,
 * using cached data when available or fetching from the API when needed.
 */

import { retrieveAnOrganization } from "@sentry/api";
import { getOrgRegion, setOrgRegion } from "./db/regions.js";
import { getSdkConfig } from "./sentry-client.js";
import { getSentryBaseUrl, isSentrySaasUrl } from "./sentry-urls.js";

/**
 * Resolve the region URL for an organization.
 *
 * Resolution order:
 * 1. Check SQLite cache
 * 2. Fetch organization details via SDK to get region URL
 * 3. Fall back to default URL if resolution fails
 *
 * Uses the SDK directly (not api-client) to avoid circular dependency.
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

  // 2. Fetch org details via SDK to discover the region URL
  const baseUrl = getSentryBaseUrl();
  const config = getSdkConfig(baseUrl);

  try {
    const result = await retrieveAnOrganization({
      ...config,
      path: { organization_id_or_slug: orgSlug },
    });

    if (result.error !== undefined) {
      return baseUrl;
    }

    const regionUrl = result.data?.links?.regionUrl ?? baseUrl;

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
