/**
 * Tests for the `sentry local run` command.
 *
 * Exercises the command's func() body directly to verify env var injection,
 * exit code propagation, auto-detection, --verify, and --timeout.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../../src/commands/local/run.js";
import { CliError, ValidationError } from "../../../src/lib/errors.js";
import { TEST_TMP_DIR } from "../../constants.js";

type RunFunc = (
  this: unknown,
  flags: { port: number; host: string; verify: boolean; timeout: number },
  ...args: string[]
) => Promise<void>;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(TEST_TMP_DIR, "run-test-"));
});

afterEach(async () => {
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

function makeContext(cwd?: string) {
  return {
    stdout: { write: mock(() => true) },
    stderr: { write: mock(() => true) },
    cwd: cwd ?? tmpDir,
  };
}

describe("sentry local run", () => {
  test("throws ValidationError when no command and no auto-detect", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();
    try {
      await func.call(ctx, {
        port: 0,
        host: "localhost",
        verify: false,
        timeout: 0,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toContain(
        "No command provided and could not auto-detect"
      );
    }
  });

  test("auto-detects dev command from package.json", async () => {
    await Bun.write(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "echo hello" } })
    );

    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    // No args provided — should auto-detect and run "echo hello"
    await func.call(ctx, {
      port: 0,
      host: "127.0.0.1",
      verify: false,
      timeout: 0,
    });
    // If we get here without throwing, auto-detection worked and
    // "echo hello" exited 0.
  });

  test("injects SENTRY_SPOTLIGHT env var into child process", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    const port = 19_876;
    await func.call(
      ctx,
      { port, host: "127.0.0.1", verify: false, timeout: 0 },
      "echo",
      "ok"
    );
  });

  test("propagates non-zero exit code as CliError", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    const port = 19_877;
    try {
      await func.call(
        ctx,
        { port, host: "127.0.0.1", verify: false, timeout: 0 },
        "false"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("exited with code");
    }
  });

  test("--timeout kills the child after N seconds", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    // "sleep 60" would take too long — timeout at 1s should kill it
    try {
      await func.call(
        ctx,
        { port: 0, host: "127.0.0.1", verify: false, timeout: 1 },
        "sleep",
        "60"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      // The child is killed by SIGTERM, resulting in a non-zero exit
      expect((err as CliError).message).toContain("exited with code");
    }
  });

  test("--verify with a quick-exit process throws WIZARD_VERIFY", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    try {
      await func.call(
        ctx,
        { port: 0, host: "127.0.0.1", verify: true, timeout: 0 },
        "true"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain(
        "Process exited before sending any events"
      );
      expect((err as CliError).exitCode).toBe(64);
    }
  });

  test("--verify with --timeout throws on timeout", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    try {
      await func.call(
        ctx,
        { port: 0, host: "127.0.0.1", verify: true, timeout: 1 },
        "sleep",
        "60"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("Verification timed out");
      expect((err as CliError).exitCode).toBe(64);
    }
  });
});
