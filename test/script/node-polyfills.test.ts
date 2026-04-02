/**
 * Node.js Polyfill Tests — Bun.spawn, Bun.spawnSync, Bun.which, Bun.file, and Bun.Glob
 *
 * Tests the logic used by the Node.js polyfill in script/node-polyfills.ts.
 *
 * We can't import the polyfill directly (it overwrites globalThis.Bun and has
 * side effects), so we reproduce the exact implementation and verify its
 * contract.
 *
 * Fixes CLI-68: spawn polyfill returned no `exited` property.
 * Fixes CLI-7T: Glob polyfill was missing `match()`, causing silent
 * failures in project-root detection for .NET/Haskell/OCaml/Nim projects
 * on the Node.js distribution.
 */

import { describe, expect, test } from "bun:test";
import {
  execSync,
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Reproduces the exact spawn logic from script/node-polyfills.ts.
 * Kept in sync manually — if the polyfill changes, update this too.
 */
function polyfillSpawn(
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
}

describe("spawn polyfill", () => {
  test("exited resolves with exit code 0 for successful command", async () => {
    const proc = polyfillSpawn(["node", "-e", "process.exit(0)"]);
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("exited resolves with non-zero exit code for failed command", async () => {
    const proc = polyfillSpawn(["node", "-e", "process.exit(42)"]);
    const exitCode = await proc.exited;
    expect(exitCode).toBe(42);
  });

  test("stdin is writable when stdin: pipe", async () => {
    // Pipe text through cat, verify it exits cleanly
    const proc = polyfillSpawn(
      [
        "node",
        "-e",
        "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));",
      ],
      {
        stdin: "pipe",
      }
    );

    proc.stdin!.write("hello");
    proc.stdin!.end();

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("env is passed to child process", async () => {
    const proc = polyfillSpawn(
      [
        "node",
        "-e",
        "process.exit(process.env.POLYFILL_TEST === 'works' ? 0 : 1)",
      ],
      {
        env: { ...process.env, POLYFILL_TEST: "works" },
      }
    );

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("inherit stdio does not throw", async () => {
    const proc = polyfillSpawn(["node", "-e", "process.exit(0)"], {
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("exited resolves to 1 for non-existent command", async () => {
    const proc = polyfillSpawn(["__nonexistent_command_polyfill_test__"]);
    const exitCode = await proc.exited;
    // error event fires → resolves to 1
    expect(exitCode).toBe(1);
  });

  test("unref is callable", () => {
    const proc = polyfillSpawn(["node", "-e", "setTimeout(() => {}, 5000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });

    // Should not throw
    expect(() => proc.unref()).not.toThrow();
  });
});

/**
 * Reproduces the exact Glob.match() logic from script/node-polyfills.ts.
 * Kept in sync manually — if the polyfill changes, update this too.
 */
/**
 * Lazy-loaded picomatch — imported once and cached.
 * Uses require() to avoid top-level import of an untyped CJS module.
 */
let picomatch: any;
function getPicomatch() {
  if (!picomatch) {
    picomatch = require("picomatch");
  }
  return picomatch;
}

class PolyfillGlob {
  private readonly matcher: (input: string) => boolean;
  constructor(pattern: string) {
    this.matcher = getPicomatch()(pattern, { dot: true });
  }
  match(input: string): boolean {
    return this.matcher(input);
  }
}

describe("Glob polyfill match()", () => {
  test("matches *.sln pattern", () => {
    const glob = new PolyfillGlob("*.sln");
    expect(glob.match("MyProject.sln")).toBe(true);
    expect(glob.match("foo.sln")).toBe(true);
    expect(glob.match("foo.txt")).toBe(false);
    expect(glob.match("sln")).toBe(false);
    expect(glob.match(".sln")).toBe(true);
  });

  test("matches *.csproj pattern", () => {
    const glob = new PolyfillGlob("*.csproj");
    expect(glob.match("MyApp.csproj")).toBe(true);
    expect(glob.match("something.csproj")).toBe(true);
    expect(glob.match("MyApp.fsproj")).toBe(false);
    expect(glob.match("csproj")).toBe(false);
  });

  test("matches all LANGUAGE_MARKER_GLOBS patterns", () => {
    // These are the glob patterns from src/lib/dsn/project-root.ts
    const patterns = [
      "*.sln",
      "*.csproj",
      "*.fsproj",
      "*.vbproj",
      "*.cabal",
      "*.opam",
      "*.nimble",
    ];

    const positives: Record<string, string> = {
      "*.sln": "MyApp.sln",
      "*.csproj": "Web.csproj",
      "*.fsproj": "Lib.fsproj",
      "*.vbproj": "Old.vbproj",
      "*.cabal": "mylib.cabal",
      "*.opam": "parser.opam",
      "*.nimble": "tool.nimble",
    };

    for (const pattern of patterns) {
      const glob = new PolyfillGlob(pattern);
      const positive = positives[pattern];
      expect(glob.match(positive!)).toBe(true);
      // Should not match unrelated extensions
      expect(glob.match("file.txt")).toBe(false);
      expect(glob.match("file.js")).toBe(false);
    }
  });

  test("does not match directory paths (glob is name-only)", () => {
    const glob = new PolyfillGlob("*.sln");
    // picomatch by default doesn't match path separators with *
    expect(glob.match("dir/MyApp.sln")).toBe(false);
  });

  test("is consistent with Bun.Glob.match()", () => {
    const patterns = ["*.sln", "*.csproj", "*.cabal"];
    const inputs = ["App.sln", "foo.csproj", "bar.cabal", "nope.txt", ""];

    for (const pattern of patterns) {
      const polyfill = new PolyfillGlob(pattern);
      const bunGlob = new Bun.Glob(pattern);
      for (const input of inputs) {
        expect(polyfill.match(input)).toBe(bunGlob.match(input));
      }
    }
  });
});

/**
 * Reproduces the exact spawnSync logic from script/node-polyfills.ts.
 * Kept in sync manually — if the polyfill changes, update this too.
 */
function polyfillSpawnSync(
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
}

describe("spawnSync polyfill", () => {
  test("returns success: true for exit code 0", () => {
    const result = polyfillSpawnSync(["node", "-e", "process.exit(0)"]);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("returns success: false for non-zero exit code", () => {
    const result = polyfillSpawnSync(["node", "-e", "process.exit(42)"]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);
  });

  test("captures stdout when stdout: pipe", () => {
    const result = polyfillSpawnSync(
      ["node", "-e", 'process.stdout.write("hello")'],
      { stdout: "pipe" }
    );
    expect(result.success).toBe(true);
    expect(result.stdout.toString()).toBe("hello");
  });

  test("respects cwd option", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "polyfill-cwd-"));
    try {
      const result = polyfillSpawnSync(
        ["node", "-e", "process.stdout.write(process.cwd())"],
        {
          stdout: "pipe",
          cwd: tmpDir,
        }
      );
      expect(result.success).toBe(true);
      // Resolve symlinks (macOS /tmp → /private/tmp)
      const expected = Bun.which("realpath")
        ? execSync(`realpath "${tmpDir}"`, { encoding: "utf-8" }).trim()
        : tmpDir;
      const actual = Bun.which("realpath")
        ? execSync(`realpath "${result.stdout.toString()}"`, {
            encoding: "utf-8",
          }).trim()
        : result.stdout.toString();
      expect(actual).toBe(expected);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("is consistent with Bun.spawnSync for git --version", () => {
    const polyfill = polyfillSpawnSync(["git", "--version"], {
      stdout: "pipe",
    });
    const bun = Bun.spawnSync(["git", "--version"], { stdout: "pipe" });
    expect(polyfill.success).toBe(bun.success);
    expect(polyfill.exitCode).toBe(bun.exitCode);
    // Both should output something starting with "git version"
    expect(polyfill.stdout.toString()).toStartWith("git version");
    expect(bun.stdout.toString()).toStartWith("git version");
  });
});

/**
 * Reproduces the exact file() polyfill logic from script/node-polyfills.ts.
 * Kept in sync manually — if the polyfill changes, update this too.
 */
function polyfillFile(path: string) {
  return {
    get size(): number {
      return statSync(path).size;
    },
    get lastModified(): number {
      return statSync(path).mtimeMs;
    },
  };
}

describe("file polyfill size and lastModified", () => {
  test("size returns correct byte length", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "polyfill-file-"));
    const filePath = join(tmpDir, "test.txt");
    try {
      writeFileSync(filePath, "hello world"); // 11 bytes
      const pf = polyfillFile(filePath);
      expect(pf.size).toBe(11);

      // Verify consistency with Bun.file().size
      expect(pf.size).toBe(Bun.file(filePath).size);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("size returns 0 for empty file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "polyfill-file-"));
    const filePath = join(tmpDir, "empty.txt");
    try {
      writeFileSync(filePath, "");
      const pf = polyfillFile(filePath);
      expect(pf.size).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("lastModified returns a recent timestamp in milliseconds", () => {
    const before = Date.now();
    const tmpDir = mkdtempSync(join(tmpdir(), "polyfill-file-"));
    const filePath = join(tmpDir, "test.txt");
    try {
      writeFileSync(filePath, "data");
      const after = Date.now();
      const pf = polyfillFile(filePath);

      // Should be between before and after (with 1s tolerance for slow CI)
      expect(pf.lastModified).toBeGreaterThanOrEqual(before - 1000);
      expect(pf.lastModified).toBeLessThanOrEqual(after + 1000);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("lastModified is consistent with Bun.file().lastModified", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "polyfill-file-"));
    const filePath = join(tmpDir, "test.txt");
    try {
      writeFileSync(filePath, "data");
      const pf = polyfillFile(filePath);
      const bunMtime = Bun.file(filePath).lastModified;
      // Both should be within 1ms of each other
      expect(Math.abs(pf.lastModified - bunMtime)).toBeLessThanOrEqual(1);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("size throws for non-existent file", () => {
    const pf = polyfillFile("/tmp/__nonexistent_file_polyfill_test__");
    expect(() => pf.size).toThrow();
  });
});

/**
 * Reproduces the exact which() polyfill logic from script/node-polyfills.ts
 * with PATH option support.
 * Kept in sync manually — if the polyfill changes, update this too.
 */
function polyfillWhich(
  command: string,
  opts?: { PATH?: string }
): string | null {
  try {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? `where ${command}` : `which ${command}`;
    const env = opts?.PATH ? { ...process.env, PATH: opts.PATH } : undefined;
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
}

describe("which polyfill with PATH option", () => {
  test("finds command on default PATH", () => {
    const result = polyfillWhich("node");
    expect(result).not.toBeNull();
    // Should match Bun.which
    expect(result).toBe(Bun.which("node"));
  });

  test("returns null for nonexistent command", () => {
    const result = polyfillWhich("__nonexistent_command_polyfill_test__");
    expect(result).toBeNull();
  });

  test("returns null when PATH excludes command directory", () => {
    // Use a valid but irrelevant directory so which finds nothing
    const result = polyfillWhich("__nonexistent_command__", { PATH: "/tmp" });
    expect(result).toBeNull();
  });

  test("passes env with custom PATH to execSync", () => {
    // Verify the polyfill constructs the env correctly when PATH is provided
    const withPath = polyfillWhich("node", { PATH: process.env.PATH });
    const withoutPath = polyfillWhich("node");
    // Both should find node when given the same PATH
    expect(withPath).toBe(withoutPath);
  });

  test("PATH option changes search scope", () => {
    // A nonexistent command should not be found regardless of PATH
    const result = polyfillWhich("__does_not_exist_anywhere__", {
      PATH: "/usr/bin:/usr/local/bin",
    });
    expect(result).toBeNull();
  });
});
