/**
 * SQLite adapter providing a unified API across runtimes.
 *
 * This module is the single import point for all SQLite access in the
 * codebase. It provides a `.query(sql).get()` / `.all()` / `.run()`
 * interface and a manual `transaction()` wrapper.
 *
 * Runtime detection:
 * - **Bun**: uses `bun:sqlite` (native, fast, no io_uring issues)
 * - **Node 22.15+**: uses `node:sqlite` (requires `--experimental-sqlite` flag)
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
          // Normalise no-row result to null (bun:sqlite returns null,
          // node:sqlite returns undefined).
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
 * Resolve the SQLite database constructor for the current runtime.
 *
 * Tries `bun:sqlite` first (works in Bun runtime), then falls back to
 * `node:sqlite` (Node 22.15+ with `--experimental-sqlite`). The try-catch
 * handles vitest workers that run under Node but are launched by Bun.
 */
// biome-ignore lint/suspicious/noExplicitAny: driver types loaded lazily
let SqliteImpl: any;
try {
  SqliteImpl = require("bun:sqlite").Database;
} catch {
  SqliteImpl = require("node:sqlite").DatabaseSync;
}

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
    // bun:sqlite uses .query() (cached), node:sqlite uses .prepare().
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
    // bun:sqlite has native transaction(); node:sqlite does not.
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
