/**
 * Region resolution for multi-region Sentry support.
 *
 * Provides utilities to resolve the correct region URL for an organization,
 * using cached data when available or fetching from the API when needed.
 */

import { retrieveAnOrganization } from "@sentry/api";
import { getOrgByNumericId, getOrgRegion, setOrgRegion } from "./db/regions.js";
import { stripDsnOrgPrefix } from "./dsn/index.js";
import { AuthError } from "./errors.js";
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
      // Propagate auth errors so callers can prompt login
      if (result.error instanceof AuthError) {
        throw result.error;
      }
      return baseUrl;
    }

    const regionUrl = result.data?.links?.regionUrl ?? baseUrl;

    // Cache for future use
    await setOrgRegion(orgSlug, regionUrl);

    return regionUrl;
  } catch (error) {
    // Propagate auth errors so callers can prompt login
    if (error instanceof AuthError) {
      throw error;
    }
    // Other errors (network, 404, etc.) fall back to default
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

/**
 * Try to resolve a DSN-style org identifier using the local org cache.
 *
 * Strips the DSN `o` prefix and looks up the numeric ID in the org_regions
 * table. Returns the cached slug if found, or `undefined` to signal that
 * the input isn't a DSN-style identifier or isn't in the cache.
 */
async function lookupDsnOrgInCache(
  orgSlug: string
): Promise<string | undefined> {
  const numericId = stripDsnOrgPrefix(orgSlug);
  if (numericId === orgSlug) {
    return;
  }
  const match = await getOrgByNumericId(numericId);
  return match?.slug;
}

/**
 * Resolve the effective org slug for API calls, with offline cache fallback.
 *
 * When users or AI agents extract org identifiers from DSN hosts
 * (e.g., `o1081365` from `o1081365.ingest.us.sentry.io`), the `o`-prefixed
 * form isn't recognized by the Sentry API. This function resolves the
 * identifier using the locally cached org list:
 *
 * 1. Check if the slug is already cached → return as-is
 * 2. If it looks like a DSN identifier (`oNNNNN`), look up the numeric ID
 *    in the org cache → return the matching slug
 * 3. If cache miss, refresh the org list from the API (one fan-out call)
 *    and retry both lookups
 * 4. Fall back to returning the original slug for downstream error handling
 *
 * @param orgSlug - Raw org identifier from user input
 * @returns The org slug to use for API calls (may be normalized)
 */
export async function resolveEffectiveOrg(orgSlug: string): Promise<string> {
  // Fast path: slug is already known
  const cached = await getOrgRegion(orgSlug);
  if (cached) {
    return orgSlug;
  }

  // Offline lookup: try as a DSN-style numeric ID
  const cachedSlug = await lookupDsnOrgInCache(orgSlug);
  if (cachedSlug) {
    return cachedSlug;
  }

  // Cache is cold or identifier is unknown — refresh the org list.
  // listOrganizations() populates org_regions with slug, region, and org_id.
  try {
    const { listOrganizations } = await import("./api-client.js");
    await listOrganizations();
  } catch (error) {
    if (error instanceof AuthError) {
      return orgSlug;
    }
    throw error;
  }

  // Retry: check if slug is now cached
  const afterRefresh = await getOrgRegion(orgSlug);
  if (afterRefresh) {
    return orgSlug;
  }

  // Retry: check numeric ID after refresh
  const refreshedSlug = await lookupDsnOrgInCache(orgSlug);
  if (refreshedSlug) {
    return refreshedSlug;
  }

  // Neither worked — return original, let downstream produce the error
  return orgSlug;
}
