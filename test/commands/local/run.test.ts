/**
 * Tests for the `sentry local run` command.
 *
 * Exercises the command's func() body directly to verify env var injection
 * and exit code propagation.
 */

import { describe, expect, mock, test } from "bun:test";
import { runCommand } from "../../../src/commands/local/run.js";
import { CliError, ValidationError } from "../../../src/lib/errors.js";

type RunFunc = (
  this: unknown,
  flags: { port: number; host: string },
  args: string[]
) => Promise<unknown>;

function makeContext() {
  return {
    stdout: { write: mock(() => true) },
    stderr: { write: mock(() => true) },
    cwd: "/tmp",
  };
}

describe("sentry local run", () => {
  test("throws ValidationError when no command provided", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();
    try {
      await func.call(ctx, { port: 0, host: "localhost" }, []);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toContain("No command provided");
    }
  });

  test("injects SENTRY_SPOTLIGHT env var into child process", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    // Use a high ephemeral port unlikely to conflict.
    // The command auto-starts a background server since none is running.
    // `printenv SENTRY_SPOTLIGHT` prints the var and exits 0.
    const port = 19_876;
    await func.call(ctx, { port, host: "127.0.0.1" }, [
      "printenv",
      "SENTRY_SPOTLIGHT",
    ]);
    // If we got here without error, the child exited 0 and env vars were set.
  });

  test("propagates non-zero exit code as CliError", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    // `false` is a POSIX command that always exits with code 1.
    const port = 19_877;
    try {
      await func.call(ctx, { port, host: "127.0.0.1" }, ["false"]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("exited with code");
    }
  });
});
