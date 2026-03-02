/**
 * Region resolution for multi-region Sentry support.
 *
 * Provides utilities to resolve the correct region URL for an organization,
 * using cached data when available or fetching from the API when needed.
 */

import { retrieveAnOrganization } from "@sentry/api";
import { getOrgRegion, setOrgRegion } from "./db/regions.js";
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
 * Resolve the effective org slug for API calls, with DSN prefix fallback.
 *
 * When users or AI agents extract org identifiers from DSN hosts
 * (e.g., `o1081365` from `o1081365.ingest.us.sentry.io`), the `o`-prefixed
 * form isn't recognized by the Sentry API. This function validates the org
 * via region resolution and falls back to stripping the DSN prefix only
 * when the original identifier fails.
 *
 * The fallback triggers only when:
 * 1. The org wasn't previously cached (first-time resolution)
 * 2. Region resolution didn't cache a result (API didn't recognize the org)
 * 3. The org matches the DSN `oNNNNN` pattern
 *
 * `resolveOrgRegion` caches on success but not on failure — this is the
 * signal used to detect that an org wasn't found.
 *
 * @param orgSlug - Raw org identifier from user input
 * @returns The org slug to use for API calls (may be normalized)
 */
export async function resolveEffectiveOrg(orgSlug: string): Promise<string> {
  // Fast path: already cached from a previous successful resolution
  const cached = await getOrgRegion(orgSlug);
  if (cached) {
    return orgSlug;
  }

  // Attempt to resolve — resolveOrgRegion caches on success, not on failure.
  // Auth errors mean we can't validate — return as-is and let downstream
  // API calls produce the proper auth error with context.
  try {
    await resolveOrgRegion(orgSlug);
  } catch (error) {
    if (error instanceof AuthError) {
      return orgSlug;
    }
    throw error;
  }

  // Check if the resolution succeeded (was it cached?)
  const afterResolve = await getOrgRegion(orgSlug);
  if (afterResolve) {
    return orgSlug;
  }

  // Resolution failed — try DSN prefix stripping as fallback
  const stripped = stripDsnOrgPrefix(orgSlug);
  if (stripped === orgSlug) {
    // Not a DSN-style identifier — return as-is, let downstream fail naturally
    return orgSlug;
  }

  // Try the stripped version
  try {
    await resolveOrgRegion(stripped);
  } catch (error) {
    if (error instanceof AuthError) {
      return orgSlug;
    }
    throw error;
  }

  const strippedCached = await getOrgRegion(stripped);
  if (strippedCached) {
    // Cache under original key too so future calls are instant
    await setOrgRegion(orgSlug, strippedCached);
    return stripped;
  }

  // Neither worked — return original, let downstream produce the error
  return orgSlug;
}
