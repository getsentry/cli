/**
 * Node.js Polyfill Tests — Bun.spawn
 *
 * Tests the spawn logic used by the Node.js polyfill in script/node-polyfills.ts.
 *
 * We can't import the polyfill directly (it overwrites globalThis.Bun and has
 * side effects), so we reproduce the exact spawn implementation and verify its
 * contract: exited promise, stdin piping, env passthrough, and inherit stdio.
 *
 * Fixes CLI-68: the original polyfill returned no `exited` property, causing
 * `await proc.exited` to resolve to `undefined` and the upgrade command to
 * throw "Setup failed with exit code undefined".
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
