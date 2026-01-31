/**
 * Organization region cache for multi-region support.
 *
 * Sentry has multiple regions (US, EU, etc.) and organizations are bound
 * to a specific region. This module caches the organization-to-region
 * mapping to avoid repeated lookups.
 */

import { getDatabase } from "./index.js";
import { runUpsert } from "./utils.js";

const TABLE = "org_regions";

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
    .query(`SELECT region_url FROM ${TABLE} WHERE org_slug = ?`)
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

  runUpsert(
    db,
    TABLE,
    { org_slug: orgSlug, region_url: regionUrl, updated_at: now },
    ["org_slug"]
  );
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

  db.transaction(() => {
    for (const [orgSlug, regionUrl] of entries) {
      runUpsert(
        db,
        TABLE,
        { org_slug: orgSlug, region_url: regionUrl, updated_at: now },
        ["org_slug"]
      );
    }
  })();
}

/**
 * Clear all cached organization regions.
 * Should be called when the user logs out.
 */
export async function clearOrgRegions(): Promise<void> {
  const db = getDatabase();
  db.query(`DELETE FROM ${TABLE}`).run();
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
    .query(`SELECT org_slug, region_url FROM ${TABLE}`)
    .all() as Pick<OrgRegionRow, "org_slug" | "region_url">[];

  return new Map(rows.map((row) => [row.org_slug, row.region_url]));
}
