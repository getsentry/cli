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

import { withAuthGuard } from "../errors.js";
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

  const data = unwrapResult(result, "Failed to list organizations");
  return data as unknown as SentryOrganization[];
}

/**
 * List all organizations the user has access to across all regions.
 * Performs a fan-out to each region and combines results.
 * Also caches the region URL for each organization.
 */
export async function listOrganizations(): Promise<SentryOrganization[]> {
  const { setOrgRegions } = await import("../db/regions.js");

  // Self-hosted instances may not have the regions endpoint (404)
  const regionsResult = await withAuthGuard(() => getUserRegions());
  const regions = regionsResult.ok ? regionsResult.value : ([] as Region[]);

  if (regions.length === 0) {
    // Fall back to default API for self-hosted instances
    return listOrganizationsInRegion(getApiBaseUrl());
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
