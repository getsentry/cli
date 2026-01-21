/**
 * Node.js polyfills for Bun APIs
 *
 * Injected at esbuild bundle time to provide Node.js-compatible
 * implementations of Bun globals. This allows the same source code
 * to run on both Bun (native) and Node.js (polyfilled).
 */
import { execSync, spawn as nodeSpawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";

declare global {
  var Bun: typeof BunPolyfill;
}

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

  spawn(cmd: string[], opts?: { stdio?: string[] }) {
    const [command, ...args] = cmd;
    const proc = nodeSpawn(command, args, {
      detached: true,
      stdio: (opts?.stdio as "ignore") || "ignore",
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
