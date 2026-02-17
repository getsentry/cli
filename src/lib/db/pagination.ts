/**
 * Pagination cursor storage for `--cursor last` support.
 *
 * Stores the most recent "next page" cursor for each (command, context) pair,
 * using a composite primary key so different contexts (e.g., different orgs)
 * maintain independent cursors.
 * Cursors expire after a short TTL to prevent stale pagination.
 */

import { getDatabase } from "./index.js";
import { runUpsert } from "./utils.js";

/** Default TTL for stored cursors: 5 minutes */
const CURSOR_TTL_MS = 5 * 60 * 1000;

type PaginationCursorRow = {
  command_key: string;
  cursor: string;
  context: string;
  expires_at: number;
};

/**
 * Get a stored pagination cursor if it exists and hasn't expired.
 *
 * @param commandKey - Command identifier (e.g., "project-list")
 * @param context - Serialized query context for lookup
 * @returns The stored cursor string, or undefined if not found/expired
 */
export function getPaginationCursor(
  commandKey: string,
  context: string
): string | undefined {
  const db = getDatabase();
  const row = db
    .query(
      "SELECT cursor, expires_at FROM pagination_cursors WHERE command_key = ? AND context = ?"
    )
    .get(commandKey, context) as PaginationCursorRow | undefined;

  if (!row) {
    return;
  }

  // Check expiry
  if (row.expires_at <= Date.now()) {
    db.query(
      "DELETE FROM pagination_cursors WHERE command_key = ? AND context = ?"
    ).run(commandKey, context);
    return;
  }

  return row.cursor;
}

/**
 * Store a pagination cursor for later retrieval via `--cursor last`.
 *
 * @param commandKey - Command identifier (e.g., "project-list")
 * @param context - Serialized query context for lookup
 * @param cursor - The cursor string to store
 * @param ttlMs - Time-to-live in milliseconds (default: 5 minutes)
 */
export function setPaginationCursor(
  commandKey: string,
  context: string,
  cursor: string,
  ttlMs = CURSOR_TTL_MS
): void {
  const db = getDatabase();
  runUpsert(
    db,
    "pagination_cursors",
    {
      command_key: commandKey,
      context,
      cursor,
      expires_at: Date.now() + ttlMs,
    },
    ["command_key", "context"]
  );
}

/**
 * Remove the stored pagination cursor for a command and context.
 * Called when a non-paginated result is displayed (no more pages).
 *
 * @param commandKey - Command identifier (e.g., "project-list")
 * @param context - Serialized query context to clear
 */
export function clearPaginationCursor(
  commandKey: string,
  context: string
): void {
  const db = getDatabase();
  db.query(
    "DELETE FROM pagination_cursors WHERE command_key = ? AND context = ?"
  ).run(commandKey, context);
}
