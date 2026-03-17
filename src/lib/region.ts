/**
 * Region resolution for multi-region Sentry support.
 *
 * Provides utilities to resolve the correct region URL for an organization,
 * using cached data when available or fetching from the API when needed.
 */

import { retrieveAnOrganization } from "@sentry/api";
import { getConfiguredSentryUrl } from "./constants.js";
import { getOrgByNumericId, getOrgRegion, setOrgRegion } from "./db/regions.js";
import { stripDsnOrgPrefix } from "./dsn/index.js";
import { withAuthGuard } from "./errors.js";
import { getSdkConfig } from "./sentry-client.js";
import { getSentryBaseUrl, isSentrySaasUrl } from "./sentry-urls.js";

/**
 * Promise cache for org region resolution, keyed by orgSlug.
 *
 * When multiple DSNs share an orgId, concurrent calls to resolveOrgRegion
 * deduplicate into a single HTTP request. A resolved promise returns
 * instantly on `await`, so this also serves as a warm in-memory cache.
 *
 * Rejected promises (e.g., AuthError) are automatically evicted so that
 * retries after re-authentication can succeed without restarting the CLI.
 */
const regionCache = new Map<string, Promise<string>>();

/**
 * Resolve the region URL for an organization.
 *
 * Deduplicates concurrent calls for the same orgSlug — only one HTTP
 * request fires per unique org, even when many DSNs trigger resolution
 * in parallel.
 *
 * Resolution order:
 * 1. Return in-flight or previously resolved promise (instant)
 * 2. Check SQLite cache
 * 3. Fetch organization details via SDK to get region URL
 * 4. Fall back to default URL if resolution fails
 *
 * Uses the SDK directly (not api-client) to avoid circular dependency.
 *
 * @param orgSlug - The organization slug
 * @returns The region URL for the organization
 */
export function resolveOrgRegion(orgSlug: string): Promise<string> {
  const existing = regionCache.get(orgSlug);
  if (existing) {
    return existing;
  }

  const promise = resolveOrgRegionUncached(orgSlug);
  regionCache.set(orgSlug, promise);
  // Evict on rejection (AuthError) so retries after re-login work.
  // Non-auth errors already resolve to baseUrl fallback, so only
  // AuthError re-throws can leave a rejected promise in the cache.
  promise.catch(() => regionCache.delete(orgSlug));
  return promise;
}

/**
 * Resolve org region from SQLite cache or API.
 * Called at most once per orgSlug per process lifetime.
 */
async function resolveOrgRegionUncached(orgSlug: string): Promise<string> {
  // 1. Check SQLite cache first
  const cached = await getOrgRegion(orgSlug);
  if (cached) {
    return cached;
  }

  // 2. Fetch org details via SDK to discover the region URL
  const baseUrl = getSentryBaseUrl();
  const config = getSdkConfig(baseUrl);

  const result = await withAuthGuard(async () => {
    const response = await retrieveAnOrganization({
      ...config,
      path: { organization_id_or_slug: orgSlug },
    });

    // Throw SDK errors so withAuthGuard can discriminate:
    // AuthError propagates, others fall back to default URL
    if (response.error !== undefined) {
      throw response.error;
    }

    const regionUrl = response.data?.links?.regionUrl ?? baseUrl;

    // Cache for future use
    await setOrgRegion(orgSlug, regionUrl);

    return regionUrl;
  });

  // Other errors (network, 404, etc.) fall back to default
  // This handles self-hosted instances without multi-region
  return result.ok ? result.value : baseUrl;
}

/**
 * Check if the CLI is configured for multi-region support.
 * Returns false for self-hosted instances that don't have regional URLs.
 */
export function isMultiRegionEnabled(): boolean {
  // Self-hosted instances (custom SENTRY_HOST/SENTRY_URL) typically don't have multi-region
  const baseUrl = getConfiguredSentryUrl();
  if (baseUrl && !isSentrySaasUrl(baseUrl)) {
    return false;
  }
  return true;
}

/**
 * Try to resolve an org identifier from the local org cache.
 *
 * Checks the slug directly first, then falls back to DSN-style numeric ID
 * lookup (stripping the `o` prefix and querying by `org_id`).
 *
 * @param orgSlug - Raw org identifier (may be a slug or `oNNNNN` DSN form)
 * @returns The resolved slug if found in cache, `undefined` on cache miss
 */
async function resolveOrgFromCache(
  orgSlug: string
): Promise<string | undefined> {
  // Check if slug is directly cached
  const cached = await getOrgRegion(orgSlug);
  if (cached) {
    return orgSlug;
  }

  // Try DSN-style numeric ID lookup (e.g., `o1081365` → `1081365` → slug)
  const numericId = stripDsnOrgPrefix(orgSlug);
  if (numericId !== orgSlug) {
    const match = await getOrgByNumericId(numericId);
    if (match) {
      return match.slug;
    }
  }
}

/**
 * Resolve the effective org slug for API calls, with offline cache fallback.
 *
 * When users or AI agents extract org identifiers from DSN hosts
 * (e.g., `o1081365` from `o1081365.ingest.us.sentry.io`), the `o`-prefixed
 * form isn't recognized by the Sentry API. This function resolves the
 * identifier using the locally cached org list:
 *
 * 1. Check local cache (slug or DSN numeric ID) → return resolved slug
 * 2. If cache miss, refresh the org list from the API (one fan-out call)
 *    and retry the local cache lookup
 * 3. Fall back to returning the original slug for downstream error handling
 *
 * @param orgSlug - Raw org identifier from user input
 * @returns The org slug to use for API calls (may be normalized)
 */
export async function resolveEffectiveOrg(orgSlug: string): Promise<string> {
  // First attempt: use local cache
  const fromCache = await resolveOrgFromCache(orgSlug);
  if (fromCache) {
    return fromCache;
  }

  // Cache is cold or identifier is unknown — refresh the org list.
  // listOrganizations() populates org_regions with slug, region, and org_id.
  // Any error (auth failure, network error, etc.) falls back to the original
  // slug; the downstream API call will produce a relevant error if needed.
  try {
    const { listOrganizations } = await import("./api-client.js");
    await listOrganizations();
  } catch {
    return orgSlug;
  }

  // Retry after refresh
  const afterRefresh = await resolveOrgFromCache(orgSlug);
  return afterRefresh ?? orgSlug;
}
