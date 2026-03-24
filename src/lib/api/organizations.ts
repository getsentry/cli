/**
 * Organization API functions
 *
 * CRUD operations and region discovery for Sentry organizations.
 */

import {
  retrieveAnOrganization,
  listYourOrganizations as sdkListOrganizations,
} from "@sentry/api";

import {
  type Region,
  type SentryOrganization,
  type UserRegionsResponse,
  UserRegionsResponseSchema,
} from "../../types/index.js";

import { getActiveEnvVarName, isEnvTokenActive } from "../db/auth.js";
import { ApiError, withAuthGuard } from "../errors.js";
import {
  getApiBaseUrl,
  getControlSiloUrl,
  getSdkConfig,
} from "../sentry-client.js";

import {
  apiRequestToRegion,
  getOrgSdkConfig,
  unwrapResult,
} from "./infrastructure.js";

/**
 * Get the list of regions the user has organization membership in.
 * This endpoint is on the control silo (sentry.io) and returns all regions.
 *
 * @returns Array of regions with name and URL
 */
export async function getUserRegions(): Promise<Region[]> {
  // /users/me/regions/ is an internal endpoint - use raw request
  const { data } = await apiRequestToRegion<UserRegionsResponse>(
    getControlSiloUrl(),
    "/users/me/regions/",
    { schema: UserRegionsResponseSchema }
  );
  return data.regions;
}

/**
 * List organizations in a specific region.
 *
 * @param regionUrl - The region's base URL
 * @returns Organizations in that region
 */
export async function listOrganizationsInRegion(
  regionUrl: string
): Promise<SentryOrganization[]> {
  const config = getSdkConfig(regionUrl);

  const result = await sdkListOrganizations({
    ...config,
  });

  try {
    const data = unwrapResult(result, "Failed to list organizations");
    return data as unknown as SentryOrganization[];
  } catch (error) {
    // Enrich 403 errors with contextual guidance (CLI-89, 24 users).
    // Only mention token scopes when using a custom env-var token —
    // the regular `sentry auth login` OAuth flow always grants org:read.
    if (error instanceof ApiError && error.status === 403) {
      const lines: string[] = [];
      if (error.detail) {
        lines.push(error.detail, "");
      }
      if (isEnvTokenActive()) {
        lines.push(
          `Your ${getActiveEnvVarName()} token may lack the required 'org:read' scope.`,
          "Check token scopes at: https://sentry.io/settings/auth-tokens/"
        );
      } else {
        lines.push(
          "You may not have access to this organization.",
          "Re-authenticate with: sentry auth login"
        );
      }
      throw new ApiError(
        error.message,
        error.status,
        lines.join("\n  "),
        error.endpoint
      );
    }
    throw error;
  }
}

/**
 * List all organizations, returning cached data when available.
 *
 * On first call (cold cache), fetches from the API and populates the cache.
 * On subsequent calls, returns organizations from the SQLite cache without
 * any HTTP requests. This avoids the expensive getUserRegions() +
 * listOrganizationsInRegion() fan-out (~800ms) on every command.
 *
 * Callers that need guaranteed-fresh data (e.g., `org list`, `auth status`)
 * should use {@link listOrganizationsUncached} instead.
 */
export async function listOrganizations(): Promise<SentryOrganization[]> {
  const { getCachedOrganizations } = await import("../db/regions.js");

  const cached = getCachedOrganizations();
  if (cached.length > 0) {
    return cached.map((org) => ({
      id: org.id,
      slug: org.slug,
      name: org.name,
      ...(org.orgRole ? { orgRole: org.orgRole } : {}),
    }));
  }

  // Cache miss — fetch from API (also populates cache for next time)
  return listOrganizationsUncached();
}

/**
 * List all organizations by fetching from the API, bypassing the cache.
 *
 * Performs a fan-out to each region and combines results.
 * Populates the org_regions cache with slug, region URL, org ID, and org name.
 *
 * Use this when you need guaranteed-fresh data (e.g., `org list`, `auth status`).
 * Most callers should use {@link listOrganizations} instead.
 */
export async function listOrganizationsUncached(): Promise<
  SentryOrganization[]
> {
  const { setOrgRegions } = await import("../db/regions.js");

  // Self-hosted instances may not have the regions endpoint (404)
  const regionsResult = await withAuthGuard(() => getUserRegions());
  const regions = regionsResult.ok ? regionsResult.value : ([] as Region[]);

  if (regions.length === 0) {
    // Fall back to default API for self-hosted instances
    const orgs = await listOrganizationsInRegion(getApiBaseUrl());
    const baseUrl = getApiBaseUrl();
    setOrgRegions(
      orgs.map((org) => ({
        slug: org.slug,
        regionUrl: baseUrl,
        orgId: org.id,
        orgName: org.name,
        orgRole: (org as Record<string, unknown>).orgRole as string | undefined,
      }))
    );
    return orgs;
  }

  const settled = await Promise.allSettled(
    regions.map(async (region) => {
      const orgs = await listOrganizationsInRegion(region.url);
      return orgs.map((org) => ({
        org,
        regionUrl: org.links?.regionUrl ?? region.url,
      }));
    })
  );

  // Collect successful results while tracking 403 errors.
  // Transient failures (network, 5xx) are swallowed — they don't affect other
  // regions. But 403 errors indicate a token scope problem that affects ALL
  // regions, so if every region failed with 403 we re-throw the enriched error
  // instead of returning an empty list (CLI-89 follow-up).
  const flatResults: { org: SentryOrganization; regionUrl: string }[] = [];
  let lastScopeError: ApiError | undefined;
  let hasSuccessfulRegion = false;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      hasSuccessfulRegion = true;
      flatResults.push(...result.value);
    } else if (
      result.reason instanceof ApiError &&
      result.reason.status === 403
    ) {
      lastScopeError = result.reason;
    }
  }

  // All regions rejected with 403 — the token lacks org:read scope globally.
  // A fulfilled-but-empty region (200 OK, no memberships) is still a success,
  // so we only throw when no region succeeded at all.
  if (!hasSuccessfulRegion && lastScopeError) {
    throw lastScopeError;
  }
  const orgs = flatResults.map((r) => r.org);

  const regionEntries = flatResults.map((r) => ({
    slug: r.org.slug,
    regionUrl: r.regionUrl,
    orgId: r.org.id,
    orgName: r.org.name,
    orgRole: (r.org as Record<string, unknown>).orgRole as string | undefined,
  }));
  setOrgRegions(regionEntries);

  return orgs;
}

/**
 * Get a specific organization.
 * Uses region-aware routing for multi-region support.
 */
export async function getOrganization(
  orgSlug: string
): Promise<SentryOrganization> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveAnOrganization({
    ...config,
    path: { organization_id_or_slug: orgSlug },
  });

  const data = unwrapResult(result, "Failed to get organization");
  return data as unknown as SentryOrganization;
}
