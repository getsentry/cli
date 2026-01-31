/**
 * Node.js polyfills for Bun APIs. Injected at bundle time via esbuild.
 */
import { execSync, spawn as nodeSpawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { glob } from "tinyglobby";
import { uuidv7 } from "uuidv7";

declare global {
  var Bun: typeof BunPolyfill;
}

type SqliteValue = string | number | bigint | null | Uint8Array;

/** Wraps node:sqlite StatementSync to match bun:sqlite query() API. */
class NodeStatementPolyfill {
  private readonly stmt: ReturnType<DatabaseSync["prepare"]>;

  constructor(stmt: ReturnType<DatabaseSync["prepare"]>) {
    this.stmt = stmt;
  }

  get(...params: SqliteValue[]): Record<string, SqliteValue> | undefined {
    return this.stmt.get(...params) as Record<string, SqliteValue> | undefined;
  }

  all(...params: SqliteValue[]): Record<string, SqliteValue>[] {
    return this.stmt.all(...params) as Record<string, SqliteValue>[];
  }

  run(...params: SqliteValue[]): void {
    this.stmt.run(...params);
  }
}

/** Wraps node:sqlite DatabaseSync to match bun:sqlite Database API. */
class NodeDatabasePolyfill {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    // SQLite configuration (busy_timeout, foreign_keys, WAL mode) is applied
    // via PRAGMA statements in src/lib/db/index.ts after construction
    this.db = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query(sql: string): NodeStatementPolyfill {
    return new NodeStatementPolyfill(this.db.prepare(sql));
  }

  close(): void {
    this.db.close();
  }

  /**
   * Wraps a function in a transaction. Returns a callable that executes
   * the function within BEGIN/COMMIT, with ROLLBACK on error.
   * Matches Bun's db.transaction() API.
   */
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

const bunSqlitePolyfill = { Database: NodeDatabasePolyfill };
(globalThis as Record<string, unknown>).__bun_sqlite_polyfill =
  bunSqlitePolyfill;

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

  randomUUIDv7(): string {
    return uuidv7();
  },
};

globalThis.Bun = BunPolyfill as typeof Bun;
