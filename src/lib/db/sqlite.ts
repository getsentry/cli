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

/** Valid SQLite binding value */
export type SQLQueryBindings =
  | string
  | number
  | bigint
  | null
  | Uint8Array
  | undefined;

/**
 * Prepared statement wrapper exposing `.get()`, `.all()`, `.run()`.
 */
class StatementWrapper {
  // biome-ignore lint/suspicious/noExplicitAny: backing driver types vary
  private readonly stmt: any;

  // biome-ignore lint/suspicious/noExplicitAny: backing driver types vary
  constructor(stmt: any) {
    this.stmt = stmt;
  }

  get(
    ...params: SQLQueryBindings[]
  ): Record<string, SQLQueryBindings> | undefined {
    return this.stmt.get(...params) as
      | Record<string, SQLQueryBindings>
      | undefined;
  }

  all(...params: SQLQueryBindings[]): Record<string, SQLQueryBindings>[] {
    return this.stmt.all(...params) as Record<string, SQLQueryBindings>[];
  }

  run(...params: SQLQueryBindings[]): void {
    this.stmt.run(...params);
  }
}

/** Resolve the underlying SQLite constructor. */
function getSqliteConstructor(): new (path: string) => {
  exec(sql: string): void;
  prepare(sql: string): unknown;
  close(): void;
} {
  try {
    // Primary: node:sqlite (Node 22+)
    return require("node:sqlite").DatabaseSync;
  } catch {
    // Fallback: bun:sqlite — remove once test runner migrates off Bun
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

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query(sql: string): StatementWrapper {
    // node:sqlite uses .prepare(), bun:sqlite uses .query()
    const prepFn = this.db.prepare ?? this.db.query;
    return new StatementWrapper(prepFn.call(this.db, sql));
  }

  close(): void {
    this.db.close();
  }

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
        this.db.exec("ROLLBACK");
        throw error;
      }
    };
  }
}
