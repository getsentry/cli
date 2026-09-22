/**
 * Cache of full event IDs this CLI has already shown.
 *
 * `event list` used to print a 12-character prefix. Agents copy that cell
 * into `sentry event view`, and Sentry search cannot match a partial event
 * ID (wildcards on `id` are rejected). The cache resolves a prefix of an
 * ID we printed, on this machine, without an API scan of the newest page.
 *
 * Entries are best-effort and capped. Cleared on logout because they are
 * scoped to the signed-in account's projects.
 */

import { HEX_ID_RE } from "../hex-id.js";
import { logger } from "../logger.js";
import { getDatabase } from "./index.js";
import { runUpsert } from "./utils.js";

const log = logger.withTag("seen-event-ids");

/** How many printed event IDs to keep. Older rows are dropped on write. */
const MAX_SEEN_EVENT_IDS = 500;

/** Prefixes shorter than this are too ambiguous to resolve from the cache. */
const MIN_PREFIX_LENGTH = 8;

const HEX_PREFIX_RE = /^[0-9a-f]+$/;

type SeenEventRow = {
  event_id: string;
};

/**
 * Remember full event IDs returned by a list or view command.
 *
 * Non-hex and non-32-char values are ignored. Failures are logged and
 * swallowed — recording must never fail the command that displayed the ID.
 *
 * @param orgSlug - Organization that owns the events
 * @param projectSlug - Project slug, or `""` when the issue payload had none
 * @param eventIds - Event IDs from the API response
 */
export function rememberSeenEventIds(
  orgSlug: string,
  projectSlug: string,
  eventIds: readonly string[]
): void {
  if (!orgSlug) {
    return;
  }
  const ids = [
    ...new Set(
      eventIds.map((id) => id.toLowerCase()).filter((id) => HEX_ID_RE.test(id))
    ),
  ];
  if (ids.length === 0) {
    return;
  }

  try {
    const db = getDatabase();
    const now = Date.now();
    for (const eventId of ids) {
      runUpsert(
        db,
        "seen_event_ids",
        {
          event_id: eventId,
          org_slug: orgSlug,
          project_slug: projectSlug,
          cached_at: now,
        },
        ["event_id"]
      );
    }
    db.query(
      `DELETE FROM seen_event_ids
       WHERE event_id NOT IN (
         SELECT event_id FROM seen_event_ids
         ORDER BY cached_at DESC
         LIMIT ?
       )`
    ).run(MAX_SEEN_EVENT_IDS);
  } catch (error) {
    log.debug("Failed to remember seen event IDs", error);
  }
}

/**
 * Resolve a hex prefix to full event IDs this CLI has printed.
 *
 * An empty `org` or `project` does not filter that dimension, so
 * `event view <prefix>` with no target can still hit an ID we listed.
 *
 * @param prefix - Lowercase hex prefix, at least 8 characters
 * @param scope - Optional org and project. Empty string means "any"
 * @returns Matching full IDs, newest first, at most 6
 */
export function findCachedEventIds(
  prefix: string,
  scope?: { org?: string; project?: string }
): string[] {
  const normalized = prefix.toLowerCase();
  if (
    normalized.length < MIN_PREFIX_LENGTH ||
    !HEX_PREFIX_RE.test(normalized)
  ) {
    return [];
  }
  const org = scope?.org ?? "";
  const project = scope?.project ?? "";

  try {
    const db = getDatabase();
    const rows = db
      .query(
        `SELECT event_id FROM seen_event_ids
         WHERE event_id LIKE ? ESCAPE '\\'
           AND (? = '' OR org_slug = ?)
           AND (? = '' OR project_slug = ?)
         ORDER BY cached_at DESC
         LIMIT 6`
      )
      .all(`${normalized}%`, org, org, project, project) as SeenEventRow[];
    return rows.map((row) => row.event_id);
  } catch (error) {
    log.debug("Failed to read seen event IDs", error);
    return [];
  }
}

/**
 * Drop every remembered event ID.
 *
 * Called from auth logout so the next account does not resolve prefixes
 * against the previous account's events.
 */
export function clearAllSeenEventIds(): void {
  const db = getDatabase();
  db.query("DELETE FROM seen_event_ids").run();
}
