/**
 * SQLite adapter providing a unified API.
 *
 * This module is the single import point for all SQLite access in the
 * codebase. It provides a `.query(sql).get()` / `.all()` / `.run()`
 * interface and a manual `transaction()` wrapper.
 *
 * Two backing drivers are supported and selected at runtime:
 *
 * - **`node:sqlite`** (`DatabaseSync`) on Node.js 22.15+ — the built-in,
 *   native driver. This is the fast path used by the standalone binary
 *   (which always embeds a modern LTS Node.js) and by modern npm installs.
 * - **`node-sqlite3-wasm`** on Node.js 18–22.14 — a pure-WASM fallback so
 *   the npm package works on older runtimes that lack `node:sqlite`. It is
 *   lazily `require()`d only in the fallback branch, which lets the binary
 *   build externalize (and therefore drop) it entirely.
 *
 * The two drivers have subtly different APIs; this adapter normalises them
 * behind a single surface. See {@link wrapStatement} for the parameter and
 * return-value differences that are reconciled here.
 */

import { rmdirSync } from "node:fs";
import { createRequire } from "node:module";
import { logger } from "../logger.js";

const _require = createRequire(import.meta.url);

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
 * Which backing SQLite driver is active.
 *
 * - `"node"` — `node:sqlite` `DatabaseSync` (Node.js 22.15+).
 * - `"wasm"` — `node-sqlite3-wasm` (Node.js 18–22.14 fallback).
 */
type DriverKind = "node" | "wasm";

/**
 * Minimum Node.js version that ships a usable built-in `node:sqlite`
 * (`DatabaseSync`). Below this the WASM fallback is used.
 */
const NODE_SQLITE_MIN_MAJOR = 22;
const NODE_SQLITE_MIN_MINOR = 15;

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

/**
 * Normalise positional bind parameters for the WASM driver.
 *
 * `node-sqlite3-wasm` expects a single array of bind values (`run([a, b])`),
 * whereas `node:sqlite` expects spread arguments (`run(a, b)`). It also
 * rejects `undefined` (throwing "Unsupported type for binding") where
 * `node:sqlite` callers never pass it — map `undefined` → `null` defensively.
 */
function toWasmParams(params: SQLQueryBindings[]): SQLQueryBindings[] {
  return params.map((p) => (p === undefined ? null : p));
}

/**
 * Wrap a driver-native prepared statement in the unified {@link StatementWrapper}.
 *
 * Reconciles the two drivers' calling conventions:
 * - **params**: `node:sqlite` takes spread args; `node-sqlite3-wasm` takes a
 *   single array. We branch on `kind` so callers can always use spread.
 * - **`.get()` no-row result**: both are normalised to `null`
 *   (`node:sqlite` returns `undefined`).
 *
 * @param stmt Driver-native statement (`node:sqlite` Statement or
 *   `node-sqlite3-wasm` Statement).
 * @param kind Which driver produced `stmt`.
 */
// biome-ignore lint/suspicious/noExplicitAny: backing driver types vary
function wrapStatement(stmt: any, kind: DriverKind): StatementWrapper {
  return new Proxy(stmt, {
    get(target, prop) {
      if (prop === "get") {
        return (...params: SQLQueryBindings[]) => {
          const row =
            kind === "wasm"
              ? target.get(toWasmParams(params))
              : target.get(...params);
          // Normalise no-row result to null (node:sqlite returns undefined).
          return (row as Record<string, SQLQueryBindings>) ?? null;
        };
      }
      if (prop === "all") {
        return (...params: SQLQueryBindings[]) =>
          kind === "wasm"
            ? target.all(toWasmParams(params))
            : target.all(...params);
      }
      if (prop === "run") {
        return (...params: SQLQueryBindings[]) =>
          kind === "wasm"
            ? target.run(toWasmParams(params))
            : target.run(...params);
      }
      const value = Reflect.get(target, prop);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  }) as StatementWrapper;
}

/** Backing-driver constructor plus which kind it is. */
type ResolvedDriver = {
  // biome-ignore lint/suspicious/noExplicitAny: driver constructors differ
  Ctor: any;
  kind: DriverKind;
};

/**
 * Whether the current runtime provides a usable built-in `node:sqlite`.
 *
 * Bun sets `process.versions.node` to a compat version but does not ship
 * `node:sqlite`; the try/catch in {@link resolveDriver} is the ultimate
 * guard, this is just the fast happy-path check.
 */
function hasNativeNodeSqlite(): boolean {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  if (major > NODE_SQLITE_MIN_MAJOR) {
    return true;
  }
  return major === NODE_SQLITE_MIN_MAJOR && minor >= NODE_SQLITE_MIN_MINOR;
}

let resolvedDriver: ResolvedDriver | null = null;

/**
 * Test-only override for which driver {@link resolveDriver} returns.
 * `null` means "use normal runtime detection".
 * @internal
 */
let forcedDriverKind: DriverKind | null = null;

/**
 * Force a specific backing driver for the next connection(s), or reset to
 * automatic detection with `null`. Clears the memoised resolution so the
 * change takes effect immediately.
 *
 * Intended for tests that need to exercise the WASM fallback on a modern
 * Node.js (where native `node:sqlite` would otherwise be chosen).
 *
 * @internal
 */
export function __setDriverForTests(kind: DriverKind | null): void {
  forcedDriverKind = kind;
  resolvedDriver = null;
}

/**
 * Resolve the SQLite database constructor for the current runtime.
 *
 * Prefers native `node:sqlite` (`DatabaseSync`); falls back to the bundled
 * `node-sqlite3-wasm` on older Node.js. Memoised after first resolution.
 *
 * The WASM driver is `require()`d only inside the fallback branch. The
 * standalone binary build (`script/build.ts`) marks `node-sqlite3-wasm`
 * external, so this branch is dead code there and adds zero bytes to the
 * SEA binary (which always runs Node.js ≥ 22.15).
 */
function resolveDriver(): ResolvedDriver {
  if (resolvedDriver) {
    return resolvedDriver;
  }

  if (
    forcedDriverKind === "node" ||
    (!forcedDriverKind && hasNativeNodeSqlite())
  ) {
    try {
      resolvedDriver = {
        Ctor: _require("node:sqlite").DatabaseSync,
        kind: "node",
      };
      return resolvedDriver;
    } catch (error) {
      // node:sqlite genuinely unavailable despite the version check
      // (e.g. Bun, or a Node build without SQLite). Fall through to WASM.
      log.debug("node:sqlite unavailable, falling back to WASM driver", error);
    }
  }

  const { Database: WasmDatabase } = _require("node-sqlite3-wasm") as {
    // biome-ignore lint/suspicious/noExplicitAny: driver types loaded lazily
    Database: any;
  };
  resolvedDriver = { Ctor: WasmDatabase, kind: "wasm" };
  return resolvedDriver;
}

/**
 * Remove a stale lock directory left by a previous `node-sqlite3-wasm`
 * process.
 *
 * The WASM driver implements SQLite file locking by `mkdir("<db>.lock")`
 * (an atomic mutex) and releasing it with `rmdir` only when SQLite lowers
 * the lock to NONE. If a process exits while still holding any lock level
 * — including a normal exit where the connection isn't explicitly downgraded
 * — the empty directory is left behind, and the next invocation's `mkdir`
 * fails with EEXIST, surfacing as "database is locked" forever.
 *
 * The Sentry CLI runs as short-lived, effectively single-writer invocations,
 * so a leftover `<db>.lock` is always stale (its owning process is gone).
 * Clearing it before open is safe and restores access; live contention is
 * still handled by SQLite's `busy_timeout`. Only the empty lock directory is
 * removed — a non-empty dir (never produced by this driver) is left intact.
 *
 * Best-effort: any failure is swallowed so a genuinely concurrent writer or a
 * permissions issue degrades to the driver's own locking error rather than a
 * crash here.
 */
function clearStaleWasmLock(dbPath: string): void {
  if (dbPath === ":memory:" || dbPath === "") {
    return;
  }
  try {
    // rmdirSync only removes empty directories, so this can never delete a
    // lock actively held with contents (this driver's locks are always empty).
    rmdirSync(`${dbPath}.lock`);
    log.debug(`Cleared stale WASM SQLite lock: ${dbPath}.lock`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOENT: no stale lock (the common case). Anything else is logged.
    if (code !== "ENOENT") {
      log.debug("Could not clear stale WASM SQLite lock", error);
    }
  }
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

  /** Which backing driver this instance uses (for param normalisation). */
  private readonly kind: DriverKind;

  constructor(path: string) {
    const { Ctor, kind } = resolveDriver();
    if (kind === "wasm") {
      clearStaleWasmLock(path);
    }
    this.db = new Ctor(path);
    this.kind = kind;
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
    return wrapStatement(this.db.prepare(sql), this.kind);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  /**
   * Wrap a function in a transaction. Returns a callable that executes
   * the function within BEGIN/COMMIT, with ROLLBACK on error.
   *
   * Neither `node:sqlite` nor `node-sqlite3-wasm` exposes a native
   * `transaction()` helper, so this always uses the manual wrapper.
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
