/**
 * SQLite adapter providing a unified API.
 *
 * This module is the single import point for all SQLite access in the
 * codebase. It provides a `.query(sql).get()` / `.all()` / `.run()`
 * interface and a manual `transaction()` wrapper.
 *
 * Uses `node:sqlite` (Node 22.15+ with `--experimental-sqlite` flag).
 */

import { logger } from "../logger.js";

const log = logger.withTag("sqlite");

/** Valid SQLite binding value. */
export type SQLQueryBindings =
  | string
  | number
  | bigint
  | boolean
  | null
  | Uint8Array
  | undefined;

/**
 * Prepared statement wrapper exposing `.get()`, `.all()`, `.run()`.
 *
 * Uses a Proxy to pass through any additional methods while normalising
 * `.get()` to return `null` (not `undefined`) for no-row results.
 */
type StatementWrapper = {
  get(...params: SQLQueryBindings[]): Record<string, SQLQueryBindings> | null;
  all(...params: SQLQueryBindings[]): Record<string, SQLQueryBindings>[];
  run(...params: SQLQueryBindings[]): void;
  [method: string]: unknown;
};

// biome-ignore lint/suspicious/noExplicitAny: backing driver types vary
function wrapStatement(stmt: any): StatementWrapper {
  return new Proxy(stmt, {
    get(target, prop) {
      if (prop === "get") {
        return (...params: SQLQueryBindings[]) =>
          // Normalise no-row result to null (node:sqlite returns undefined).
          (target.get(...params) as Record<string, SQLQueryBindings>) ?? null;
      }
      const value = Reflect.get(target, prop);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  }) as StatementWrapper;
}

/**
 * Resolve the SQLite database constructor.
 * Uses `node:sqlite` (Node 22.15+ with `--experimental-sqlite`).
 */
// biome-ignore lint/suspicious/noExplicitAny: driver types loaded lazily
const SqliteImpl: any = require("node:sqlite").DatabaseSync;

/**
 * SQLite database wrapper.
 *
 * - `exec(sql)` — execute raw SQL (DDL, multi-statement)
 * - `query(sql)` — prepare a statement → `.get()` / `.all()` / `.run()`
 * - `close()` — close the connection
 * - `transaction(fn)` — wrap a function in BEGIN/COMMIT/ROLLBACK
 */
export class Database {
  // biome-ignore lint/suspicious/noExplicitAny: backing driver resolved at runtime
  private readonly db: any;

  constructor(path: string) {
    this.db = new SqliteImpl(path);
  }

  /** Execute raw SQL (DDL statements, multi-statement strings). */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Prepare a SQL statement.
   * Returns a wrapper with `.get()`, `.all()`, `.run()`.
   */
  query(sql: string): StatementWrapper {
    const prepFn = this.db.query ?? this.db.prepare;
    return wrapStatement(prepFn.call(this.db, sql));
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  /**
   * Wrap a function in a transaction. Returns a callable that executes
   * the function within BEGIN/COMMIT, with ROLLBACK on error.
   */
  transaction<T>(fn: () => T): () => T {
    if (typeof this.db.transaction === "function") {
      return this.db.transaction(fn);
    }
    return () => {
      this.db.exec("BEGIN");
      try {
        const result = fn();
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch (rollbackError) {
          log.debug("ROLLBACK failed after transaction error", rollbackError);
        }
        throw error;
      }
    };
  }
}
