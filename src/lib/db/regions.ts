/**
 * Organization region cache for multi-region support.
 *
 * Sentry has multiple regions (US, EU, etc.) and organizations are bound
 * to a specific region. This module caches the organization-to-region
 * mapping to avoid repeated lookups.
 *
 * The `org_id` column (added in schema v8) enables offline resolution
 * of numeric org IDs extracted from DSN hosts (e.g., `o1081365` →
 * look up by `org_id = '1081365'` → get the slug).
 */

import { getDatabase } from "./index.js";
import { runUpsert } from "./utils.js";

const TABLE = "org_regions";

type OrgRegionRow = {
  org_slug: string;
  org_id: string | null;
  org_name: string | null;
  region_url: string;
  updated_at: number;
};

/** Entry for batch-caching org regions with optional metadata. */
export type OrgRegionEntry = {
  slug: string;
  regionUrl: string;
  orgId?: string;
  orgName?: string;
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
 * Look up an organization slug by its numeric ID.
 *
 * Used to resolve DSN-style org identifiers (e.g., `o1081365` → strip
 * prefix → look up `1081365` → get the slug `my-org`).
 *
 * @param numericId - The bare numeric org ID (without "o" prefix)
 * @returns The org slug and region URL if found, undefined otherwise
 */
export async function getOrgByNumericId(
  numericId: string
): Promise<{ slug: string; regionUrl: string } | undefined> {
  const db = getDatabase();
  const row = db
    .query(`SELECT org_slug, region_url FROM ${TABLE} WHERE org_id = ?`)
    .get(numericId) as
    | Pick<OrgRegionRow, "org_slug" | "region_url">
    | undefined;

  if (!row) {
    return;
  }
  return { slug: row.org_slug, regionUrl: row.region_url };
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
 * Each entry includes the org slug, region URL, and optionally the
 * numeric org ID for offline ID→slug lookups.
 *
 * @param entries - Array of org region entries
 */
export async function setOrgRegions(entries: OrgRegionEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const db = getDatabase();
  const now = Date.now();

  db.transaction(() => {
    for (const entry of entries) {
      const row: Record<string, string | number | null> = {
        org_slug: entry.slug,
        region_url: entry.regionUrl,
        updated_at: now,
      };
      if (entry.orgId) {
        row.org_id = entry.orgId;
      }
      if (entry.orgName) {
        row.org_name = entry.orgName;
      }
      runUpsert(db, TABLE, row, ["org_slug"]);
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

/** Cached org entry with the fields needed to reconstruct a SentryOrganization. */
export type CachedOrg = {
  slug: string;
  id: string;
  name: string;
};

/**
 * Maximum age (ms) for cached organization entries.
 * Entries older than this are considered stale and ignored, forcing a
 * fresh API fetch. 7 days balances offline usability with picking up
 * new org memberships.
 */
const ORG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Get all cached organizations with id, slug, and name.
 *
 * Returns organizations that have all three fields populated and were
 * updated within the TTL window. Rows with missing `org_id` or `org_name`
 * (from before schema v9) or stale `updated_at` are excluded — callers
 * should fall back to the API when the result is empty.
 *
 * @returns Array of cached org entries, or empty if cache is cold/stale/incomplete
 */
export async function getCachedOrganizations(): Promise<CachedOrg[]> {
  const db = getDatabase();
  const cutoff = Date.now() - ORG_CACHE_TTL_MS;
  const rows = db
    .query(
      `SELECT org_slug, org_id, org_name FROM ${TABLE} WHERE org_id IS NOT NULL AND org_name IS NOT NULL AND updated_at > ?`
    )
    .all(cutoff) as Pick<OrgRegionRow, "org_slug" | "org_id" | "org_name">[];

  return rows.map((row) => ({
    slug: row.org_slug,
    // org_id and org_name are guaranteed non-null by the WHERE clause
    id: row.org_id as string,
    name: row.org_name as string,
  }));
}
