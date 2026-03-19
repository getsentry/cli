/**
 * Node.js Polyfill Tests — Bun.spawn and Bun.Glob
 *
 * Tests the spawn and glob logic used by the Node.js polyfill in
 * script/node-polyfills.ts.
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
import { spawn as nodeSpawn } from "node:child_process";

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
  private readonly pattern: string;
  constructor(pattern: string) {
    this.pattern = pattern;
  }
  match(input: string): boolean {
    return getPicomatch()(this.pattern, { dot: true })(input);
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
