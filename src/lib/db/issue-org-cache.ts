/**
 * Cache for numeric-issue-ID → organization-slug mappings.
 *
 * When a user runs `sentry issue view 123456789` without an org context,
 * the CLI must fall back to the legacy unscoped `GET /api/0/issues/{id}/`
 * endpoint (which does not support region routing) and then extract the
 * org from the response `permalink`. Follow-up fetches (events/latest,
 * trace/...) require the org slug, so without a cache every subsequent
 * command run repeats the same unscoped lookup.
 *
 * This module records the resolved numeric-id → org-slug mapping so
 * future runs can skip straight to the org-scoped endpoint. It addresses
 * the `sentry.issue.view` "Consecutive HTTP" pattern for Pattern D in
 * the issue triage (numeric-ID org discovery fan-out).
 *
 * Storage: the existing `metadata` KV table with key shape
 * `issue_org.{numericId}` and value = org slug. No schema migration
 * required. Entries are best-effort: a stale mapping (issue deleted,
 * access revoked, or moved) causes a single 404 on the cached org
 * call which the caller falls back from, and we evict the entry.
 *
 * Values are not TTL'd because issues are owned by a single org for
 * their entire lifetime — the mapping cannot change except by issue
 * deletion, which we already handle via 404 eviction.
 */

import { recordCacheHit } from "../telemetry.js";
import { getDatabase } from "./index.js";
import {
  clearMetadata,
  clearMetadataByPrefix,
  getMetadata,
  setMetadata,
} from "./utils.js";

/** Metadata key namespace for issue-id → org mappings. */
const KEY_PREFIX = "issue_org.";

function metadataKey(numericId: string): string {
  return `${KEY_PREFIX}${numericId}`;
}

/**
 * Look up the cached organization slug for a numeric issue ID.
 *
 * @param numericId - Numeric issue group ID (e.g., "7413562541")
 * @returns Org slug if cached, undefined otherwise
 */
export function getCachedIssueOrg(numericId: string): string | undefined {
  const db = getDatabase();
  const map = getMetadata(db, [metadataKey(numericId)]);
  const org = map.get(metadataKey(numericId));
  recordCacheHit("issue_org", !!org);
  return org;
}

/**
 * Remember the organization slug for a numeric issue ID.
 *
 * Silently no-ops when either argument is empty. Best-effort — callers
 * should not await this as a critical step; the DB layer already wraps
 * writes to be fault-tolerant.
 *
 * @param numericId - Numeric issue group ID (e.g., "7413562541")
 * @param orgSlug - Organization slug that owns the issue
 */
export function setCachedIssueOrg(numericId: string, orgSlug: string): void {
  if (!(numericId && orgSlug)) {
    return;
  }
  const db = getDatabase();
  setMetadata(db, { [metadataKey(numericId)]: orgSlug });
}

/**
 * Drop the cached mapping for a numeric issue ID.
 *
 * Called when an org-scoped fetch 404s so subsequent runs re-resolve
 * the org via the legacy unscoped endpoint.
 *
 * @param numericId - Numeric issue group ID
 */
export function clearCachedIssueOrg(numericId: string): void {
  if (!numericId) {
    return;
  }
  const db = getDatabase();
  clearMetadata(db, [metadataKey(numericId)]);
}

/**
 * Drop ALL issue-id → org mappings.
 *
 * Called from auth logout handlers so signing out with one account does
 * not leak mappings into a different account's session. Kept separate
 * from `clearMetadata` so the caller can target just this cache class.
 */
export function clearAllIssueOrgCache(): void {
  const db = getDatabase();
  clearMetadataByPrefix(db, KEY_PREFIX);
}
