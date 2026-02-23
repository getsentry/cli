/**
 * Isolated tests for Homebrew upgrade execution.
 *
 * Uses mock.module() to stub node:child_process/spawn, which leaks module
 * state — kept isolated so it doesn't affect other test files.
 */

import { describe, expect, mock, test } from "bun:test";
import {
  execFile,
  execFileSync,
  execSync,
  fork,
  spawnSync,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { UpgradeError } from "../../src/lib/errors.js";

/**
 * Build a minimal fake ChildProcess EventEmitter that emits 'close'
 * with the given exit code after a microtask tick.
 */
function fakeProcess(exitCode: number): EventEmitter {
  const emitter = new EventEmitter();
  // Emit close asynchronously so the Promise can attach listeners first
  queueMicrotask(() => emitter.emit("close", exitCode));
  return emitter;
}

// Mock node:child_process before importing the module under test.
// Bun hoists mock.module() calls, so this runs before any imports below.
// Pass through real non-spawn exports so transitive deps are unaffected.
let spawnImpl: (cmd: string, args: string[], opts: object) => EventEmitter =
  () => fakeProcess(0);

mock.module("node:child_process", () => ({
  execFile,
  execFileSync,
  execSync,
  fork,
  spawnSync,
  spawn: (cmd: string, args: string[], opts: object) =>
    spawnImpl(cmd, args, opts),
}));

// Import after mock is registered
const { executeUpgrade } = await import("../../src/lib/upgrade.js");

describe("executeUpgrade (brew)", () => {
  test("returns null on successful brew upgrade", async () => {
    spawnImpl = () => fakeProcess(0);

    const result = await executeUpgrade("brew", "1.0.0");
    expect(result).toBeNull();
  });

  test("throws UpgradeError with execution_failed reason on non-zero exit", async () => {
    spawnImpl = () => fakeProcess(1);

    await expect(executeUpgrade("brew", "1.0.0")).rejects.toThrow(UpgradeError);

    try {
      await executeUpgrade("brew", "1.0.0");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpgradeError);
      expect((err as UpgradeError).reason).toBe("execution_failed");
      expect((err as UpgradeError).message).toContain("exit code 1");
    }
  });

  test("throws UpgradeError with execution_failed reason on spawn error", async () => {
    spawnImpl = () => {
      const emitter = new EventEmitter();
      queueMicrotask(() => emitter.emit("error", new Error("brew not found")));
      return emitter;
    };

    try {
      await executeUpgrade("brew", "1.0.0");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpgradeError);
      expect((err as UpgradeError).reason).toBe("execution_failed");
      expect((err as UpgradeError).message).toContain("brew not found");
    }
  });

  test("invokes brew with correct arguments", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];

    spawnImpl = (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return fakeProcess(0);
    };

    await executeUpgrade("brew", "1.0.0");

    expect(capturedCmd).toBe("brew");
    expect(capturedArgs).toEqual(["upgrade", "getsentry/tools/sentry"]);
  });
});
