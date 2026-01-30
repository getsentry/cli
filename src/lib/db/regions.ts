/**
 * Organization region cache for multi-region support.
 *
 * Sentry has multiple regions (US, EU, etc.) and organizations are bound
 * to a specific region. This module caches the organization-to-region
 * mapping to avoid repeated lookups.
 */

import { getDatabase } from "./index.js";

type OrgRegionRow = {
  org_slug: string;
  region_url: string;
  updated_at: number;
};

/**
 * Get the cached region URL for an organization.
 *
 * @param orgSlug - The organization slug
 * @returns The region URL if cached, undefined otherwise
 */
export async function getOrgRegion(
  orgSlug: string
): Promise<string | undefined> {
  const db = getDatabase();
  const row = db
    .query("SELECT region_url FROM org_regions WHERE org_slug = ?")
    .get(orgSlug) as Pick<OrgRegionRow, "region_url"> | undefined;

  return row?.region_url;
}

/**
 * Cache the region URL for an organization.
 *
 * @param orgSlug - The organization slug
 * @param regionUrl - The region URL (e.g., https://us.sentry.io)
 */
export async function setOrgRegion(
  orgSlug: string,
  regionUrl: string
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  db.query(`
    INSERT INTO org_regions (org_slug, region_url, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(org_slug) DO UPDATE SET
      region_url = excluded.region_url,
      updated_at = excluded.updated_at
  `).run(orgSlug, regionUrl, now);
}

/**
 * Cache region URLs for multiple organizations in a single transaction.
 * More efficient than calling setOrgRegion() multiple times.
 *
 * @param entries - Array of [orgSlug, regionUrl] pairs
 */
export async function setOrgRegions(
  entries: [string, string][]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const db = getDatabase();
  const now = Date.now();

  const stmt = db.query(`
    INSERT INTO org_regions (org_slug, region_url, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(org_slug) DO UPDATE SET
      region_url = excluded.region_url,
      updated_at = excluded.updated_at
  `);

  db.transaction(() => {
    for (const [orgSlug, regionUrl] of entries) {
      stmt.run(orgSlug, regionUrl, now);
    }
  })();
}

/**
 * Clear all cached organization regions.
 * Should be called when the user logs out.
 */
export async function clearOrgRegions(): Promise<void> {
  const db = getDatabase();
  db.query("DELETE FROM org_regions").run();
}

/**
 * Get all cached organization regions.
 * Used for determining if user has orgs in multiple regions.
 *
 * @returns Map of org slug to region URL
 */
export async function getAllOrgRegions(): Promise<Map<string, string>> {
  const db = getDatabase();
  const rows = db
    .query("SELECT org_slug, region_url FROM org_regions")
    .all() as Pick<OrgRegionRow, "org_slug" | "region_url">[];

  return new Map(rows.map((row) => [row.org_slug, row.region_url]));
}

/**
 * Get unique region URLs from the cache.
 * Used to determine if user has orgs in multiple regions.
 *
 * @returns Set of unique region URLs
 */
export async function getUniqueRegions(): Promise<Set<string>> {
  const db = getDatabase();
  const rows = db
    .query("SELECT DISTINCT region_url FROM org_regions")
    .all() as Pick<OrgRegionRow, "region_url">[];

  return new Set(rows.map((row) => row.region_url));
}
