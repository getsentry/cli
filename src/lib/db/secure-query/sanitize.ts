/**
 * Helpers for safely handling values that must appear inside SQL.
 *
 * The golden rule: prefer bound parameters (`?`) over any of these helpers.
 * They exist only for the rare cases where a value genuinely cannot be bound
 * (e.g. a LIKE pattern fragment or a dynamic identifier).
 */

/**
 * Escape the special characters used by SQLite's `LIKE` operator so that
 * user-supplied search text is treated literally instead of as wildcards.
 *
 * Use together with `ESCAPE '\\'`, e.g.
 *
 *   db.prepare("SELECT * FROM t WHERE name LIKE ? ESCAPE '\\'")
 *     .all(`%${escapeLike(input)}%`)
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Reject obviously dangerous control characters that have no business in a
 * search term. This is a defense-in-depth measure on top of parameterization,
 * not a replacement for it.
 */
export function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f]/g, "");
}

/** Validate a column/table identifier against a strict allow-list. */
export function safeIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to interpolate unsafe identifier: ${name}`);
  }
  return name;
}
