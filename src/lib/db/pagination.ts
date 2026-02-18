/**
 * Pagination cursor storage for `--cursor last` support.
 *
 * Stores the most recent "next page" cursor for each (command, context) pair,
 * using a composite primary key so different contexts (e.g., different orgs)
 * maintain independent cursors.
 * Cursors expire after a short TTL to prevent stale pagination.
 *
 * Also exports shared helpers for building context keys and resolving cursor
 * flags, used by list commands that support cursor-based pagination.
 */

import { ContextError } from "../errors.js";
import { getApiBaseUrl } from "../sentry-client.js";
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

/**
 * Build a context key for org-scoped pagination cursor storage.
 *
 * Encodes the API base URL and org slug so cursors from different hosts or
 * orgs are never mixed up in the cursor cache.
 *
 * @param org - Organization slug
 * @returns Composite context key string
 */
export function buildOrgContextKey(org: string): string {
  return `host:${getApiBaseUrl()}|type:org:${org}`;
}

/**
 * Resolve the cursor value from a `--cursor` flag.
 *
 * Handles the magic `"last"` value by looking up the cached cursor for the
 * given context key. Throws a {@link ContextError} if `"last"` is requested
 * but no cursor has been cached yet.
 *
 * @param cursorFlag - Raw value of the `--cursor` flag (undefined if not set)
 * @param commandKey - Command identifier used for cursor storage
 * @param contextKey - Serialized query context used for cursor storage
 * @returns Resolved cursor string, or `undefined` if no cursor was specified
 */
export function resolveOrgCursor(
  cursorFlag: string | undefined,
  commandKey: string,
  contextKey: string
): string | undefined {
  if (!cursorFlag) {
    return;
  }
  if (cursorFlag === "last") {
    const cached = getPaginationCursor(commandKey, contextKey);
    if (!cached) {
      throw new ContextError(
        "Pagination cursor",
        "No saved cursor for this query. Run without --cursor first."
      );
    }
    return cached;
  }
  return cursorFlag;
}
