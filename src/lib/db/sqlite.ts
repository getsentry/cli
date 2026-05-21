/**
 * SQLite adapter wrapping node:sqlite's DatabaseSync with a convenient API.
 *
 * This module is the single import point for all SQLite access in the
 * codebase. It provides a `.query(sql).get()` / `.all()` / `.run()`
 * interface and a manual `transaction()` wrapper.
 *
 * Uses `node:sqlite` (Node 22+) as the backing implementation. Falls back
 * to `bun:sqlite` when `node:sqlite` is unavailable (Bun runtime) — this
 * fallback will be removed once the test runner migrates off Bun.
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
 * Uses a Proxy to pass through any additional driver-specific methods
 * (e.g. bun:sqlite's `.values()`) while normalising `.get()` to return
 * `null` (not `undefined`) for no-row results.
 */
type StatementWrapper = {
  get(...params: SQLQueryBindings[]): Record<string, SQLQueryBindings> | null;
  all(...params: SQLQueryBindings[]): Record<string, SQLQueryBindings>[];
  run(...params: SQLQueryBindings[]): void;
  /** Allow driver-specific methods (e.g. bun:sqlite `.values()`) to pass through. */
  [method: string]: unknown;
};

// biome-ignore lint/suspicious/noExplicitAny: backing driver types vary
function wrapStatement(stmt: any): StatementWrapper {
  return new Proxy(stmt, {
    get(target, prop) {
      if (prop === "get") {
        return (...params: SQLQueryBindings[]) =>
          // node:sqlite returns undefined for no rows; bun:sqlite returns null.
          // Normalise to null so callers can rely on a single sentinel.
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
 * Resolve the underlying SQLite database constructor.
 *
 * Prefers `node:sqlite` (Node 22+). Falls back to `bun:sqlite` when
 * `node:sqlite` is unavailable (Bun runtime). The fallback will be
 * removed once the test runner migrates off Bun.
 */
function getSqliteConstructor(): new (
  path: string
) => {
  exec(sql: string): void;
  close(): void;
} {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch (error) {
    log.debug("node:sqlite unavailable, falling back to bun:sqlite", error);
    return require("bun:sqlite").Database;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: resolved dynamically
const SqliteImpl: any = getSqliteConstructor();

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
   *
   * Uses bun:sqlite's `.query()` (cached statements) when available,
   * falling back to node:sqlite's `.prepare()`.
   */
  query(sql: string): StatementWrapper {
    // bun:sqlite exposes both .query() (cached) and .prepare() (fresh).
    // Prefer .query() to preserve the caching semantics all consumers
    // were written against. node:sqlite only has .prepare().
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
    // bun:sqlite has native transaction(); node:sqlite does not
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
