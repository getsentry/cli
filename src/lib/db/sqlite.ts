/**
 * SQLite adapter that provides a unified API surface for database access.
 * This module is the single import point for all SQLite access in the
 * codebase, replacing direct `bun:sqlite` imports.
 *
 * Runtime detection:
 * - **Bun**: Re-exports `bun:sqlite`'s Database directly (zero overhead).
 * - **Node.js**: Wraps `node:sqlite`'s DatabaseSync with a bun:sqlite-
 *   compatible API (`.query()` → `.prepare()`, manual transaction wrapper).
 *
 * Call sites continue to use `.query(sql).get()` / `.all()` / `.run()`
 * and `db.transaction()` exactly as before — no migration churn needed.
 */

/** Valid SQLite binding value */
export type SQLQueryBindings =
  | string
  | number
  | bigint
  | null
  | Uint8Array
  | undefined;

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

const isBun = typeof globalThis.Bun !== "undefined";

// ---------------------------------------------------------------------------
// Node.js implementation (wraps node:sqlite DatabaseSync)
// ---------------------------------------------------------------------------

/**
 * Minimal statement wrapper matching the bun:sqlite query API.
 * Wraps node:sqlite's StatementSync to expose `.get()`, `.all()`, `.run()`.
 */
class NodeStatementWrapper {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite types loaded lazily
  private readonly stmt: any;

  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite types loaded lazily
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

/**
 * Node.js SQLite database wrapper with bun:sqlite-compatible API.
 * Used only when running under Node.js (not Bun).
 */
class NodeDatabase {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite types loaded lazily
  private readonly db: any;

  constructor(path: string) {
    // Lazy-load node:sqlite to avoid crashing on runtimes without it.
    // biome-ignore lint/suspicious/noExplicitAny: node:sqlite types loaded lazily
    const { DatabaseSync } = require("node:sqlite") as any;
    this.db = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query(sql: string): NodeStatementWrapper {
    return new NodeStatementWrapper(this.db.prepare(sql));
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): () => T {
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

// ---------------------------------------------------------------------------
// Unified export — picks the right implementation at runtime
// ---------------------------------------------------------------------------

/**
 * SQLite Database class.
 *
 * Under Bun this is the native `bun:sqlite` Database (zero-overhead re-export).
 * Under Node.js this is a wrapper around `node:sqlite`'s DatabaseSync that
 * provides the same `.exec()`, `.query()`, `.close()`, `.transaction()` API.
 */
// biome-ignore lint/suspicious/noExplicitAny: conditional runtime export
export const Database: any = isBun
  ? require("bun:sqlite").Database
  : NodeDatabase;

// Re-export the type so `import type { Database }` works correctly.
// The type matches the bun:sqlite Database shape used across the codebase.
export type Database = InstanceType<typeof Database>;
