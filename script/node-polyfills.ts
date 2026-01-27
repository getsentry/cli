/**
 * Node.js polyfills for Bun APIs
 *
 * Injected at esbuild bundle time to provide Node.js-compatible
 * implementations of Bun globals. This allows the same source code
 * to run on both Bun (native) and Node.js (polyfilled).
 */
import { execSync, spawn as nodeSpawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { glob } from "tinyglobby";

declare global {
  var Bun: typeof BunPolyfill;
}

// ─────────────────────────────────────────────────────────────────────────────
// bun:sqlite Polyfill using node:sqlite
// ─────────────────────────────────────────────────────────────────────────────

type SqliteValue = string | number | bigint | null | Uint8Array;

/**
 * Polyfill for bun:sqlite Statement using node:sqlite StatementSync.
 * Wraps node:sqlite's prepare() result to match bun:sqlite's query() API.
 */
class NodeStatementPolyfill {
  private stmt: ReturnType<DatabaseSync["prepare"]>;

  constructor(stmt: ReturnType<DatabaseSync["prepare"]>) {
    this.stmt = stmt;
  }

  /**
   * Get a single row.
   */
  get(...params: SqliteValue[]): Record<string, SqliteValue> | undefined {
    return this.stmt.get(...params) as Record<string, SqliteValue> | undefined;
  }

  /**
   * Get all rows.
   */
  all(...params: SqliteValue[]): Record<string, SqliteValue>[] {
    return this.stmt.all(...params) as Record<string, SqliteValue>[];
  }

  /**
   * Run a statement (INSERT, UPDATE, DELETE).
   */
  run(...params: SqliteValue[]): void {
    this.stmt.run(...params);
  }
}

/**
 * Polyfill for bun:sqlite Database using node:sqlite DatabaseSync.
 * Provides the same API surface as Bun's Database class.
 */
class NodeDatabasePolyfill {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, {
      timeout: 100, // 100ms - fast fail for CLI responsiveness
      enableForeignKeyConstraints: true,
    });
  }

  /**
   * Execute raw SQL (for DDL statements, PRAGMA, etc.).
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Prepare a statement for execution.
   * In bun:sqlite this is called `query()`, but we expose it as both
   * `query()` and `prepare()` for compatibility.
   */
  query(sql: string): NodeStatementPolyfill {
    return new NodeStatementPolyfill(this.db.prepare(sql));
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// Export as a module-like object that can be required
const bunSqlitePolyfill = {
  Database: NodeDatabasePolyfill,
};

// Make it available globally for the bundle
(globalThis as Record<string, unknown>).__bun_sqlite_polyfill = bunSqlitePolyfill;

// ─────────────────────────────────────────────────────────────────────────────
// Bun Global Polyfill
// ─────────────────────────────────────────────────────────────────────────────

const BunPolyfill = {
  file(path: string) {
    return {
      async exists(): Promise<boolean> {
        try {
          await access(path);
          return true;
        } catch {
          return false;
        }
      },
      text(): Promise<string> {
        return readFile(path, "utf-8");
      },
      async json<T = unknown>(): Promise<T> {
        const text = await readFile(path, "utf-8");
        return JSON.parse(text);
      },
    };
  },

  async write(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf-8");
  },

  which(command: string): string | null {
    try {
      const isWindows = process.platform === "win32";
      const cmd = isWindows ? `where ${command}` : `which ${command}`;
      return (
        execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] })
          .trim()
          .split("\n")[0] || null
      );
    } catch {
      return null;
    }
  },

  spawn(
    cmd: string[],
    opts?: { stdout?: "pipe" | "ignore"; stderr?: "pipe" | "ignore" }
  ) {
    const [command, ...args] = cmd;
    // Map Bun's stdout/stderr options to Node's stdio array format
    // Currently only supports "ignore" - "pipe" would require returning streams
    const stdio: ("pipe" | "ignore")[] = [
      "ignore", // stdin
      opts?.stdout ?? "ignore",
      opts?.stderr ?? "ignore",
    ];
    const proc = nodeSpawn(command, args, {
      detached: true,
      stdio,
    });
    return {
      unref() {
        proc.unref();
      },
    };
  },

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  Glob: class BunGlobPolyfill {
    private pattern: string;
    constructor(pattern: string) {
      this.pattern = pattern;
    }
    async *scan(opts?: { cwd?: string }): AsyncIterable<string> {
      const results = await glob(this.pattern, {
        cwd: opts?.cwd || process.cwd(),
      });
      for (const result of results) {
        yield result;
      }
    }
  },
};

globalThis.Bun = BunPolyfill as typeof Bun;
