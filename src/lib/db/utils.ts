/**
 * SQL builder utilities for common database operations.
 * Reduces boilerplate for UPSERT and other repetitive patterns.
 */

import type { SQLQueryBindings } from "bun:sqlite";

/** Valid SQLite binding value (matches bun:sqlite's SQLQueryBindings) */
export type SqlValue = SQLQueryBindings;

/**
 * Result of building an SQL query with parameterized values.
 */
export type SqlQuery = {
  /** The SQL string with ? placeholders */
  sql: string;
  /** The values to bind to the placeholders */
  values: SqlValue[];
};

/**
 * Options for the upsert function.
 */
export type UpsertOptions<T> = {
  /** Columns to exclude from the UPDATE SET clause */
  excludeFromUpdate?: (keyof T)[];
};

/**
 * Build an UPSERT (INSERT ... ON CONFLICT DO UPDATE) statement for SQLite.
 *
 * This helper eliminates repetitive UPSERT boilerplate by automatically
 * generating the INSERT and ON CONFLICT DO UPDATE clauses from an object.
 *
 * @param table - The table name to insert into
 * @param data - Object with column names as keys and values to insert
 * @param conflictColumns - Column(s) that form the unique constraint
 * @param options - Optional configuration
 * @returns Object with { sql, values } ready for db.query(sql).run(...values)
 *
 * @example
 * // Simple upsert
 * const { sql, values } = upsert('auth', { id: 1, token: 'abc' }, ['id']);
 * db.query(sql).run(...values);
 * // INSERT INTO auth (id, token) VALUES (?, ?)
 * // ON CONFLICT(id) DO UPDATE SET token = excluded.token
 *
 * @example
 * // Exclude columns from update
 * const { sql, values } = upsert(
 *   'users',
 *   { id: 1, name: 'Bob', created_at: now },
 *   ['id'],
 *   { excludeFromUpdate: ['created_at'] }
 * );
 * // created_at won't be updated on conflict, only on insert
 */
export function upsert<T extends Record<string, SqlValue>>(
  table: string,
  data: T,
  conflictColumns: (keyof T)[],
  options: UpsertOptions<T> = {}
): SqlQuery {
  const columns = Object.keys(data);
  const values = Object.values(data) as SqlValue[];

  if (columns.length === 0) {
    throw new Error("upsert: data object must have at least one column");
  }

  if (conflictColumns.length === 0) {
    throw new Error("upsert: must specify at least one conflict column");
  }

  const placeholders = columns.map(() => "?").join(", ");

  const conflictSet = new Set(conflictColumns as string[]);
  const excludeSet = new Set((options.excludeFromUpdate ?? []) as string[]);

  const updateColumns = columns.filter(
    (col) => !(conflictSet.has(col) || excludeSet.has(col))
  );

  const updateClause =
    updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((col) => `${col} = excluded.${col}`).join(", ")}`
      : "DO NOTHING";

  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(${(conflictColumns as string[]).join(", ")}) ${updateClause}`;

  return { sql, values };
}

/** Minimal db interface needed for query execution */
type QueryRunner = { query(sql: string): { run(...values: SqlValue[]): void } };

/**
 * Execute an UPSERT statement directly on the database.
 *
 * Convenience wrapper that combines upsert() SQL generation with execution.
 * For advanced options like excludeFromUpdate, use upsert() directly.
 *
 * @param db - The database instance to execute on
 * @param table - The table name to insert into
 * @param data - Object with column names as keys and values to insert
 * @param conflictColumns - Column(s) that form the unique constraint
 *
 * @example
 * runUpsert(db, 'auth', { id: 1, token: 'abc' }, ['id']);
 */
export function runUpsert<T extends Record<string, SqlValue>>(
  db: QueryRunner,
  table: string,
  data: T,
  conflictColumns: (keyof T)[]
): void {
  const { sql, values } = upsert(table, data, conflictColumns);
  db.query(sql).run(...values);
}

/**
 * Build multiple UPSERT statements for batch operations.
 * Returns an array of SqlQuery objects to be executed in a transaction.
 *
 * @param table - The table name to insert into
 * @param rows - Array of objects with column names as keys
 * @param conflictColumns - Column(s) that form the unique constraint
 * @param options - Optional configuration
 * @returns Array of { sql, values } objects
 *
 * @example
 * const queries = bulkUpsert('regions', [
 *   { org_slug: 'acme', region_url: 'https://us.sentry.io' },
 *   { org_slug: 'corp', region_url: 'https://eu.sentry.io' },
 * ], ['org_slug']);
 *
 * db.transaction(() => {
 *   for (const { sql, values } of queries) {
 *     db.query(sql).run(...values);
 *   }
 * })();
 */
export function bulkUpsert<T extends Record<string, SqlValue>>(
  table: string,
  rows: T[],
  conflictColumns: (keyof T)[],
  options: UpsertOptions<T> = {}
): SqlQuery[] {
  if (rows.length === 0) {
    return [];
  }

  return rows.map((row) => upsert(table, row, conflictColumns, options));
}
