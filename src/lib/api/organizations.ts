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
    // Enrich 403 errors with token scope guidance (CLI-89, 24 users).
    // A 403 from the organizations endpoint usually means the auth token
    // lacks the org:read scope — either it's an internal integration token
    // with limited scopes, or a self-hosted token without the right permissions.
    if (error instanceof ApiError && error.status === 403) {
      const lines: string[] = [];
      if (error.detail) {
        lines.push(error.detail, "");
      }
      lines.push(
        "Your auth token may lack the required 'org:read' scope.",
        "Re-authenticate with: sentry auth login",
        "Or check token scopes at: https://sentry.io/settings/auth-tokens/"
      );
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

  const cached = await getCachedOrganizations();
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
    await setOrgRegions(
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

  const results = await Promise.all(
    regions.map(async (region) => {
      try {
        const orgs = await listOrganizationsInRegion(region.url);
        return orgs.map((org) => ({
          org,
          regionUrl: org.links?.regionUrl ?? region.url,
        }));
      } catch {
        return [];
      }
    })
  );

  const flatResults = results.flat();
  const orgs = flatResults.map((r) => r.org);

  const regionEntries = flatResults.map((r) => ({
    slug: r.org.slug,
    regionUrl: r.regionUrl,
    orgId: r.org.id,
    orgName: r.org.name,
    orgRole: (r.org as Record<string, unknown>).orgRole as string | undefined,
  }));
  await setOrgRegions(regionEntries);

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
