/**
 * Isolated tests for subprocess-based upgrade execution.
 *
 * Uses mock.module() to stub node:child_process/spawn, which leaks module
 * state — kept isolated so it doesn't affect other test files.
 *
 * Covers: executeUpgrade (brew + package managers), runCommand, isInstalledWith,
 * detectLegacyInstallationMethod, and detectInstallationMethod legacy path.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  execFile,
  execFileSync,
  execSync,
  fork,
  spawnSync,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { UpgradeError } from "../../src/lib/errors.js";
import { useTestConfigDir } from "../helpers.js";

// ---------------------------------------------------------------------------
// Fake ChildProcess helpers
// ---------------------------------------------------------------------------

type FakeStdio = {
  on: (event: string, cb: (chunk: Buffer) => void) => FakeStdio;
  resume: () => void;
};

type FakeProc = EventEmitter & {
  stdout: FakeStdio;
  stderr: FakeStdio;
};

/**
 * Build a minimal fake ChildProcess EventEmitter that emits 'close'
 * with the given exit code after a microtask tick.
 *
 * @param exitCode - Exit code to emit on 'close'
 * @param stdoutData - Optional data to emit on stdout before close
 */
function fakeProcess(exitCode: number, stdoutData = ""): FakeProc {
  const emitter = new EventEmitter() as FakeProc;

  const listeners: Array<(chunk: Buffer) => void> = [];
  emitter.stdout = {
    on: (_event: string, cb: (chunk: Buffer) => void) => {
      listeners.push(cb);
      return emitter.stdout;
    },
    // biome-ignore lint/suspicious/noEmptyBlockStatements: stub
    resume: () => {},
  };
  emitter.stderr = {
    on: (_event: string, _cb: (chunk: Buffer) => void) => emitter.stderr,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: stub
    resume: () => {},
  };

  queueMicrotask(() => {
    if (stdoutData) {
      for (const cb of listeners) {
        cb(Buffer.from(stdoutData));
      }
    }
    emitter.emit("close", exitCode);
  });

  return emitter;
}

/**
 * Build a fake ChildProcess that emits an 'error' event instead of closing.
 */
function fakeErrorProcess(message: string): FakeProc {
  const emitter = new EventEmitter() as FakeProc;
  emitter.stdout = {
    on: (_e: string, _cb: (chunk: Buffer) => void) => emitter.stdout,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: stub
    resume: () => {},
  };
  emitter.stderr = {
    on: (_e: string, _cb: (chunk: Buffer) => void) => emitter.stderr,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: stub
    resume: () => {},
  };
  queueMicrotask(() => emitter.emit("error", new Error(message)));
  return emitter;
}

// ---------------------------------------------------------------------------
// mock.module — must be declared before any imports of the module under test.
// Bun hoists mock.module() calls so they run before top-level awaits.
// Pass through real non-spawn exports so transitive deps are unaffected.
// ---------------------------------------------------------------------------

let spawnImpl: (cmd: string, args: string[], opts: object) => FakeProc = () =>
  fakeProcess(0);

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
const { detectInstallationMethod, executeUpgrade } = await import(
  "../../src/lib/upgrade.js"
);

const { clearInstallInfo } = await import("../../src/lib/db/install-info.js");

// ---------------------------------------------------------------------------
// executeUpgrade — brew
// ---------------------------------------------------------------------------

describe("executeUpgrade (brew)", () => {
  test("returns null on successful brew upgrade", async () => {
    spawnImpl = () => fakeProcess(0);
    expect(await executeUpgrade("brew", "1.0.0")).toBeNull();
  });

  test("throws UpgradeError on non-zero brew exit", async () => {
    spawnImpl = () => fakeProcess(1);
    try {
      await executeUpgrade("brew", "1.0.0");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpgradeError);
      expect((err as UpgradeError).reason).toBe("execution_failed");
      expect((err as UpgradeError).message).toContain("exit code 1");
    }
  });

  test("throws UpgradeError on brew spawn error", async () => {
    spawnImpl = () => fakeErrorProcess("brew not found");
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

// ---------------------------------------------------------------------------
// executeUpgrade — package managers (npm, pnpm, bun, yarn)
// ---------------------------------------------------------------------------

describe("executeUpgrade (package managers)", () => {
  test("npm: returns null on success", async () => {
    spawnImpl = () => fakeProcess(0);
    expect(await executeUpgrade("npm", "1.0.0")).toBeNull();
  });

  test("npm: uses correct install arguments", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];
    spawnImpl = (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return fakeProcess(0);
    };
    await executeUpgrade("npm", "1.2.3");
    expect(capturedCmd).toBe("npm");
    expect(capturedArgs).toEqual(["install", "-g", "sentry@1.2.3"]);
  });

  test("pnpm: uses correct install arguments", async () => {
    let capturedArgs: string[] = [];
    spawnImpl = (_cmd, args) => {
      capturedArgs = args;
      return fakeProcess(0);
    };
    await executeUpgrade("pnpm", "1.2.3");
    expect(capturedArgs).toEqual(["install", "-g", "sentry@1.2.3"]);
  });

  test("bun: uses correct install arguments", async () => {
    let capturedArgs: string[] = [];
    spawnImpl = (_cmd, args) => {
      capturedArgs = args;
      return fakeProcess(0);
    };
    await executeUpgrade("bun", "1.2.3");
    expect(capturedArgs).toEqual(["install", "-g", "sentry@1.2.3"]);
  });

  test("yarn: uses 'global add' arguments", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];
    spawnImpl = (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return fakeProcess(0);
    };
    await executeUpgrade("yarn", "1.2.3");
    expect(capturedCmd).toBe("yarn");
    expect(capturedArgs).toEqual(["global", "add", "sentry@1.2.3"]);
  });

  test("npm: throws UpgradeError on non-zero exit", async () => {
    spawnImpl = () => fakeProcess(1);
    try {
      await executeUpgrade("npm", "1.0.0");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpgradeError);
      expect((err as UpgradeError).reason).toBe("execution_failed");
      expect((err as UpgradeError).message).toContain("npm install failed");
    }
  });

  test("npm: throws UpgradeError on spawn error", async () => {
    spawnImpl = () => fakeErrorProcess("npm not found");
    try {
      await executeUpgrade("npm", "1.0.0");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpgradeError);
      expect((err as UpgradeError).reason).toBe("execution_failed");
      expect((err as UpgradeError).message).toContain("npm not found");
    }
  });
});

// ---------------------------------------------------------------------------
// executeUpgrade — unknown method (default switch case)
// ---------------------------------------------------------------------------

describe("executeUpgrade (unknown method)", () => {
  test("throws UpgradeError with unknown_method reason", async () => {
    try {
      await executeUpgrade("unknown" as never, "1.0.0");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpgradeError);
      expect((err as UpgradeError).reason).toBe("unknown_method");
    }
  });
});

// ---------------------------------------------------------------------------
// runCommand via isInstalledWith (indirect coverage of runCommand)
// ---------------------------------------------------------------------------

describe("detectInstallationMethod — legacy pm detection via isInstalledWith", () => {
  useTestConfigDir("test-detect-legacy-");

  let originalExecPath: string;

  beforeEach(() => {
    originalExecPath = process.execPath;
    // Non-Homebrew, non-known-curl execPath so detection falls through to pm checks
    Object.defineProperty(process, "execPath", {
      value: "/usr/bin/sentry",
      configurable: true,
    });
    clearInstallInfo();
  });

  afterEach(() => {
    Object.defineProperty(process, "execPath", {
      value: originalExecPath,
      configurable: true,
    });
    clearInstallInfo();
  });

  test("detects npm when 'npm list -g sentry' output includes 'sentry@'", async () => {
    spawnImpl = (_cmd, args) =>
      fakeProcess(0, args.includes("sentry") ? "sentry@1.0.0" : "");
    const method = await detectInstallationMethod();
    expect(method).toBe("npm");
  });

  test("detects yarn when 'yarn global list' output includes 'sentry@'", async () => {
    // npm is checked first — make npm/pnpm/bun return empty; only yarn matches
    spawnImpl = (cmd) => {
      if (cmd === "yarn") return fakeProcess(0, "sentry@1.0.0");
      return fakeProcess(0, "");
    };
    const method = await detectInstallationMethod();
    expect(method).toBe("yarn");
  });

  test("returns 'unknown' when no package manager lists sentry", async () => {
    spawnImpl = () => fakeProcess(0, ""); // all return empty stdout
    const method = await detectInstallationMethod();
    expect(method).toBe("unknown");
  });

  test("returns 'unknown' when all package manager spawns error", async () => {
    spawnImpl = () => fakeErrorProcess("command not found");
    const method = await detectInstallationMethod();
    expect(method).toBe("unknown");
  });

  test("auto-saves detected method when non-unknown", async () => {
    spawnImpl = (_cmd, args) =>
      fakeProcess(0, args.includes("sentry") ? "sentry@2.0.0" : "");
    await detectInstallationMethod();
    // After detection, install info should be auto-saved with method=npm
    const { getInstallInfo } = await import("../../src/lib/db/install-info.js");
    const stored = getInstallInfo();
    expect(stored?.method).toBe("npm");
  });

  test("returns stored method on second call (auto-save fast path)", async () => {
    // First call: npm detected and auto-saved
    spawnImpl = (_cmd, args) =>
      fakeProcess(0, args.includes("sentry") ? "sentry@1.0.0" : "");
    await detectInstallationMethod();

    // Second call: spawn should not be called again (stored info takes precedence)
    let spawnCalled = false;
    spawnImpl = () => {
      spawnCalled = true;
      return fakeProcess(0, "sentry@1.0.0");
    };
    const method = await detectInstallationMethod();
    expect(method).toBe("npm");
    expect(spawnCalled).toBe(false);
  });
});
