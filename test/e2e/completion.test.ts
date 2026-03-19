/**
 * Completion Latency E2E Tests
 *
 * Spawns the actual CLI binary with `__complete` args and measures
 * wall-clock latency. The completion fast-path skips @sentry/bun,
 * Stricli, and middleware — these tests catch regressions that would
 * re-introduce heavy imports into the completion path.
 *
 * Pre-optimization baseline: ~530ms (dev), ~320ms (binary)
 * Post-optimization target:  ~60ms  (dev), ~190ms (binary)
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getCliCommand } from "../fixture.js";

const cliDir = join(import.meta.dir, "../..");

/** Spawn a CLI process and measure wall-clock duration. */
async function measureCommand(
  args: string[],
  env?: Record<string, string | undefined>
): Promise<{
  duration: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const cmd = getCliCommand();
  const start = performance.now();
  const proc = Bun.spawn([...cmd, ...args], {
    cwd: cliDir,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  return {
    duration: performance.now() - start,
    exitCode: proc.exitCode ?? 1,
    stdout,
    stderr,
  };
}

describe("completion latency", () => {
  test("completion is faster than a normal command", async () => {
    // Normal command loads telemetry, Stricli, all commands
    const normal = await measureCommand(["--version"]);

    // Completion skips all heavy imports
    const completion = await measureCommand([
      "__complete",
      "issue",
      "list",
      "",
    ]);

    expect(normal.exitCode).toBe(0);
    expect(completion.exitCode).toBe(0);

    // Completion should not be slower than a normal command
    expect(completion.duration).toBeLessThan(normal.duration);
  });

  test("completion exits under latency budget", async () => {
    const result = await measureCommand(["__complete", "issue", "list", ""]);

    expect(result.exitCode).toBe(0);

    // 500ms budget — generous for CI (dev is ~60ms, binary ~190ms),
    // but catches regressions from the pre-fix ~530ms baseline.
    expect(result.duration).toBeLessThan(500);
  });

  test("completion exits cleanly with no stderr", async () => {
    const result = await measureCommand(["__complete", "org", "view", ""]);

    expect(result.exitCode).toBe(0);
    // No error output — completions should be silent on stderr
    expect(result.stderr).toBe("");
  });

  test("completion with empty args exits cleanly", async () => {
    const result = await measureCommand(["__complete", ""]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});
