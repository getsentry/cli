/**
 * Node.js polyfills for Bun APIs. Injected at bundle time via esbuild.
 */
import {
  execSync,
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from "node:child_process";
import { statSync } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
// biome-ignore lint/performance/noNamespaceImport: runtime access to optional `zstdCompress`/`zstdDecompress` exports
import * as zlibModule from "node:zlib";
import { constants as zlibConstants } from "node:zlib";
// node:sqlite is imported lazily inside NodeDatabasePolyfill to avoid
// crashing on Node.js versions without node:sqlite support when the
// bundle is loaded as a library (the consumer may never use SQLite).

import picomatch from "picomatch";
import { compare as semverCompare } from "semver";
import { glob } from "tinyglobby";
import { uuidv7 } from "uuidv7";

declare global {
  var Bun: typeof BunPolyfill;
}

type SqliteValue = string | number | bigint | null | Uint8Array;

/** Lazy-loaded node:sqlite DatabaseSync constructor. */
function getNodeSqlite(): typeof import("node:sqlite").DatabaseSync {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:sqlite").DatabaseSync;
}

/** Wraps node:sqlite StatementSync to match bun:sqlite query() API. */
class NodeStatementPolyfill {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite types loaded lazily
  private readonly stmt: any;

  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite types loaded lazily
  constructor(stmt: any) {
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
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite types loaded lazily
  private readonly db: any;

  constructor(path: string) {
    // SQLite configuration (busy_timeout, foreign_keys, WAL mode) is applied
    // via PRAGMA statements in src/lib/db/index.ts after construction
    const DatabaseSync = getNodeSqlite();
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
      /** File size in bytes (synchronous, like Bun.file().size). Returns 0 for non-existent files. */
      get size(): number {
        try {
          return statSync(path).size;
        } catch {
          return 0;
        }
      },
      /** Last-modified time in ms since epoch (like Bun.file().lastModified). Returns 0 for non-existent files. */
      get lastModified(): number {
        try {
          return statSync(path).mtimeMs;
        } catch {
          return 0;
        }
      },
      async exists(): Promise<boolean> {
        try {
          await access(path);
          return true;
        } catch {
          return false;
        }
      },
      // Follows symlinks (stat, not lstat) — matches Bun.file().stat() semantics.
      stat: stat.bind(null, path),
      text(): Promise<string> {
        return readFile(path, "utf-8");
      },
      async json<T = unknown>(): Promise<T> {
        const text = await readFile(path, "utf-8");
        return JSON.parse(text);
      },
    };
  },

  async write(
    path: string,
    content: string | Response | ArrayBuffer | Uint8Array
  ): Promise<void> {
    if (content instanceof Response) {
      const buffer = await content.arrayBuffer();
      await writeFile(path, Buffer.from(buffer));
    } else if (content instanceof ArrayBuffer) {
      await writeFile(path, Buffer.from(content));
    } else if (content instanceof Uint8Array) {
      await writeFile(path, content);
    } else {
      await writeFile(path, content, "utf-8");
    }
  },

  which(command: string, opts?: { PATH?: string }): string | null {
    try {
      const isWindows = process.platform === "win32";
      const cmd = isWindows ? `where ${command}` : `which ${command}`;
      // If a custom PATH is provided, override it in the subprocess env.
      // Use !== undefined (not truthy) so empty-string PATH is respected.
      const env =
        opts?.PATH !== undefined
          ? { ...process.env, PATH: opts.PATH }
          : undefined;
      return (
        execSync(cmd, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"],
          env,
        })
          .trim()
          .split("\n")[0] || null
      );
    } catch {
      return null;
    }
  },

  /**
   * Synchronously spawn a subprocess. Matches Bun.spawnSync() used by
   * git.ts for pre-flight checks in `sentry init`.
   */
  spawnSync(
    cmd: string[],
    opts?: {
      stdout?: "pipe" | "ignore" | "inherit";
      stderr?: "pipe" | "ignore" | "inherit";
      cwd?: string;
    }
  ) {
    const [command, ...args] = cmd;
    const result = nodeSpawnSync(command, args, {
      stdio: ["ignore", opts?.stdout ?? "ignore", opts?.stderr ?? "ignore"],
      cwd: opts?.cwd,
    });
    return {
      success: result.status === 0,
      exitCode: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },

  spawn(
    cmd: string[],
    opts?: {
      stdin?: "pipe" | "ignore" | "inherit";
      stdout?: "pipe" | "ignore" | "inherit";
      stderr?: "pipe" | "ignore" | "inherit";
      env?: Record<string, string | undefined>;
    }
  ) {
    const [command, ...args] = cmd;
    const proc = nodeSpawn(command, args, {
      stdio: [
        opts?.stdin ?? "ignore",
        opts?.stdout ?? "ignore",
        opts?.stderr ?? "ignore",
      ],
      env: opts?.env,
    });

    // Promise that resolves with the exit code when the process exits.
    // Bun's proc.exited resolves to the numeric exit code; we match that
    // contract, falling back to 1 on signal-only termination.
    const exited = new Promise<number>((resolve) => {
      proc.on("close", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });

    return {
      stdin: proc.stdin,
      exited,
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
    /** Compiled matcher — created once at construction, reused on every match() call. */
    private matcher: (input: string) => boolean;

    constructor(pattern: string) {
      this.pattern = pattern;
      // Compile once with dot:true to match Bun.Glob behavior where
      // `*` matches dotfiles by default (unlike picomatch defaults).
      this.matcher = picomatch(pattern, { dot: true });
    }

    /**
     * Synchronously test whether a string matches the glob pattern.
     * Mirrors Bun.Glob.match() used by project-root detection for
     * language marker globs (*.sln, *.csproj, etc.).
     */
    match(input: string): boolean {
      return this.matcher(input);
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

  semver: {
    order: semverCompare,
  },
};

/**
 * Coerce arbitrary compression input (string, ArrayBuffer, TypedArray)
 * into a contiguous Buffer without copying where possible.
 */
function toBufferForCompression(
  data: NodeJS.TypedArray | Buffer | string | ArrayBuffer
): Buffer {
  if (typeof data === "string") {
    return Buffer.from(data, "utf-8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

// Feature-detected zstd polyfill. `node:zlib.zstdCompress` lands in Node
// 22.15; we do NOT install the polyfill below on older Node because
// Bun.zstdCompress's absence lets the telemetry transport's runtime
// probe fall back to gzip cleanly (see src/lib/telemetry/zstd-transport.ts).
//
// Kept out of the BunPolyfill literal so the `typeof Bun.zstdCompress`
// probe genuinely returns `"undefined"` on older runtimes — assigning
// a noop stub would defeat the feature-detect.
const zlibOptionalZstdCompress = (zlibModule as { zstdCompress?: unknown })
  .zstdCompress;
const zlibOptionalZstdDecompress = (zlibModule as { zstdDecompress?: unknown })
  .zstdDecompress;

if (
  typeof zlibOptionalZstdCompress === "function" &&
  typeof zlibOptionalZstdDecompress === "function"
) {
  const nodeZstdCompress = promisify(
    zlibOptionalZstdCompress as (
      buf: Buffer,
      options: { params?: Record<number, number> },
      cb: (err: Error | null, result: Buffer) => void
    ) => void
  );
  const nodeZstdDecompress = promisify(
    zlibOptionalZstdDecompress as (
      buf: Buffer,
      cb: (err: Error | null, result: Buffer) => void
    ) => void
  );

  (BunPolyfill as unknown as { zstdCompress: unknown }).zstdCompress = (
    data: NodeJS.TypedArray | Buffer | string | ArrayBuffer,
    opts?: { level?: number }
  ): Promise<Buffer> =>
    nodeZstdCompress(toBufferForCompression(data), {
      params: {
        [zlibConstants.ZSTD_c_compressionLevel]: opts?.level ?? 3,
      },
    });

  (BunPolyfill as unknown as { zstdDecompress: unknown }).zstdDecompress = (
    data: NodeJS.TypedArray | Buffer | string | ArrayBuffer
  ): Promise<Buffer> => nodeZstdDecompress(toBufferForCompression(data));
}

globalThis.Bun = BunPolyfill as typeof Bun;
