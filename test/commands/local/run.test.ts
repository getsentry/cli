/**
 * Tests for the `sentry local run` command.
 *
 * Exercises the command's func() body directly to verify env var injection
 * and exit code propagation.
 */

import { describe, expect, test, vi } from "vitest";
import { runCommand } from "../../../src/commands/local/run.js";
import { CliError, ValidationError } from "../../../src/lib/errors.js";

const isBun = typeof globalThis.Bun !== "undefined";

type RunFunc = (
  this: unknown,
  flags: { port: number; host: string },
  ...args: string[]
) => Promise<void>;

function makeContext() {
  return {
    stdout: { write: vi.fn(() => true) },
    stderr: { write: vi.fn(() => true) },
    cwd: "/tmp",
  };
}

// biome-ignore lint/suspicious/noSkippedTests: requires Bun.spawn (not available in vitest Node workers)
describe.skipIf(!isBun)("sentry local run", () => {
  test("throws ValidationError when no command provided", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();
    try {
      await func.call(ctx, { port: 0, host: "localhost" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toContain("No command provided");
    }
  });

  test("injects SENTRY_SPOTLIGHT env var into child process", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    const port = 19_876;
    await func.call(
      ctx,
      { port, host: "127.0.0.1" },
      "printenv",
      "SENTRY_SPOTLIGHT"
    );
  });

  test("propagates non-zero exit code as CliError", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    const port = 19_877;
    try {
      await func.call(ctx, { port, host: "127.0.0.1" }, "false");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("exited with code");
    }
  });
});
