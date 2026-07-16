/**
 * Tests for the dual-driver SQLite adapter.
 *
 * The adapter selects `node:sqlite` (Node.js 22.15+) or `node-sqlite3-wasm`
 * (older Node.js) at runtime. The two drivers have opposite parameter
 * conventions — `node:sqlite` takes spread args, `node-sqlite3-wasm` takes a
 * single array — so these tests run the *same* adapter-level operations
 * against *both* backing drivers to prove the normalisation in
 * `wrapStatement`/`toWasmParams` keeps callers driver-agnostic.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { __setDriverForTests, Database } from "../../../src/lib/db/sqlite.js";

type DriverKind = "node" | "wasm";

const DRIVERS: DriverKind[] = ["node", "wasm"];

afterEach(() => {
  // Always return to automatic detection so we don't leak forced state.
  __setDriverForTests(null);
});

describe.each(DRIVERS)("sqlite adapter [%s driver]", (kind) => {
  function open(): Database {
    __setDriverForTests(kind);
    return new Database(":memory:");
  }

  test("run + get roundtrips positional params", () => {
    const db = open();
    db.exec("CREATE TABLE t (a TEXT, b INTEGER)");
    db.query("INSERT INTO t (a, b) VALUES (?, ?)").run("hello", 42);

    const row = db.query("SELECT a, b FROM t WHERE b = ?").get(42);
    expect(row).toEqual({ a: "hello", b: 42 });
    db.close();
  });

  test("get returns null (not undefined) for no rows", () => {
    const db = open();
    db.exec("CREATE TABLE t (a TEXT)");
    const row = db.query("SELECT a FROM t WHERE a = ?").get("missing");
    expect(row).toBeNull();
    db.close();
  });

  test("all returns every matching row", () => {
    const db = open();
    db.exec("CREATE TABLE t (a TEXT, b INTEGER)");
    const insert = db.query("INSERT INTO t (a, b) VALUES (?, ?)");
    insert.run("x", 1);
    insert.run("y", 2);

    const rows = db.query("SELECT a, b FROM t ORDER BY b").all();
    expect(rows).toEqual([
      { a: "x", b: 1 },
      { a: "y", b: 2 },
    ]);
    db.close();
  });

  test("multiple positional params bind in order (no silent misbinding)", () => {
    // Regression guard: node-sqlite3-wasm treats a 2nd spread arg as an
    // options object, silently dropping the bind. The adapter must convert
    // spread args to an array for the WASM driver.
    const db = open();
    db.exec("CREATE TABLE t (a TEXT, b INTEGER, c TEXT)");
    db.query("INSERT INTO t (a, b, c) VALUES (?, ?, ?)").run(
      "first",
      99,
      "last"
    );

    const row = db.query("SELECT a, b, c FROM t").get();
    expect(row).toEqual({ a: "first", b: 99, c: "last" });
    db.close();
  });

  test("undefined bind is treated as null", () => {
    const db = open();
    db.exec("CREATE TABLE t (a TEXT, b INTEGER)");
    // node:sqlite rejects undefined; the adapter maps undefined→null for the
    // WASM driver. For the node driver, passing null explicitly is the
    // equivalent caller contract.
    if (kind === "wasm") {
      db.query("INSERT INTO t (a, b) VALUES (?, ?)").run("u", undefined);
      const row = db.query("SELECT a, b FROM t").get();
      expect(row).toEqual({ a: "u", b: null });
    } else {
      db.query("INSERT INTO t (a, b) VALUES (?, ?)").run("u", null);
      const row = db.query("SELECT a, b FROM t").get();
      expect(row).toEqual({ a: "u", b: null });
    }
    db.close();
  });

  test("transaction commits on success", () => {
    const db = open();
    db.exec("CREATE TABLE t (a INTEGER)");
    const insertTwo = db.transaction(() => {
      db.query("INSERT INTO t (a) VALUES (?)").run(1);
      db.query("INSERT INTO t (a) VALUES (?)").run(2);
    });
    insertTwo();

    const rows = db.query("SELECT a FROM t ORDER BY a").all();
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    db.close();
  });

  test("transaction rolls back on error", () => {
    const db = open();
    db.exec("CREATE TABLE t (a INTEGER)");
    db.query("INSERT INTO t (a) VALUES (?)").run(1);

    const boom = db.transaction(() => {
      db.query("INSERT INTO t (a) VALUES (?)").run(2);
      throw new Error("boom");
    });
    expect(boom).toThrow("boom");

    // The row inserted before the throw must be rolled back.
    const rows = db.query("SELECT a FROM t").all();
    expect(rows).toEqual([{ a: 1 }]);
    db.close();
  });

  test("blob (Uint8Array) roundtrips", () => {
    const db = open();
    db.exec("CREATE TABLE t (data BLOB)");
    const blob = new Uint8Array([1, 2, 3, 255]);
    db.query("INSERT INTO t (data) VALUES (?)").run(blob);

    const row = db.query("SELECT data FROM t").get() as {
      data: Uint8Array;
    };
    expect(Array.from(row.data)).toEqual([1, 2, 3, 255]);
    db.close();
  });
});

/**
 * The WASM driver (node-sqlite3-wasm) locks the database by creating an
 * empty `<db>.lock` directory and removes it only when SQLite lowers the
 * lock to NONE. A process that exits while still holding a lock leaves the
 * directory behind, and the next open's `mkdir` fails with EEXIST →
 * "database is locked". The adapter clears such a stale lock before opening.
 */
describe("wasm driver stale-lock recovery", () => {
  let dir: string;

  afterEach(() => {
    __setDriverForTests(null);
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("clears a leftover <db>.lock directory before opening", () => {
    __setDriverForTests("wasm");
    dir = mkdtempSync(join(tmpdir(), "sqlite-lock-"));
    const dbPath = join(dir, "cli.db");

    // Simulate a stale lock left by a previous (now-dead) process, backdated
    // well beyond the staleness window so it's treated as orphaned.
    const lockDir = `${dbPath}.lock`;
    mkdirSync(lockDir);
    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(lockDir, old, old);
    expect(existsSync(lockDir)).toBe(true);

    // Opening must succeed despite the stale lock, and the DB must be usable.
    const db = new Database(dbPath);
    db.exec("CREATE TABLE t (a INTEGER)");
    db.query("INSERT INTO t (a) VALUES (?)").run(1);
    expect(db.query("SELECT a FROM t").get()).toEqual({ a: 1 });
    db.close();
  });

  test("does not remove a recent (possibly live) lock", () => {
    __setDriverForTests("wasm");
    dir = mkdtempSync(join(tmpdir(), "sqlite-lock-live-"));
    const dbPath = join(dir, "cli.db");

    // A freshly-created lock may belong to a concurrent process — it must be
    // left intact (the WASM driver would then surface its own busy error).
    const lockDir = `${dbPath}.lock`;
    mkdirSync(lockDir);

    // Constructing the adapter must not clear a recent lock.
    // The driver still opens (it acquires locks lazily per operation), but the
    // pre-existing lock directory must survive the constructor's cleanup pass.
    new Database(dbPath).close();
    expect(existsSync(lockDir)).toBe(true);
  });
});
