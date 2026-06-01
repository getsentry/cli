/**
 * Unit tests for run-commands spawn options.
 *
 * Kept separate because node:child_process must be mocked before importing
 * the tool module.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RunCommandsPayload } from "../../../../src/lib/init/types.js";

const { spawnCalls } = vi.hoisted(() => ({
  spawnCalls: [] as Array<{
    command: string;
    args: string[];
    options: { shell?: boolean };
  }>,
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const { Readable } = await import("node:stream");

  return {
    execFileSync: (_file: string, args: string[]) => {
      const command = args.at(-1);
      if (process.platform !== "win32") {
        return `/usr/local/bin/${command}\n`;
      }
      return command === "pnpm"
        ? "C:\\Tools\\pnpm.CMD\r\n"
        : `C:\\Tools\\${command}.exe\r\n`;
    },
    spawn: (command: string, args: string[], options: { shell?: boolean }) => {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter() as any;
      child.stdout = Readable.from(["10.0.0\n"]);
      child.stderr = Readable.from([]);
      child.kill = vi.fn();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  };
});

vi.mock("@sentry/node-core/light", () => ({
  addBreadcrumb: vi.fn(),
}));

import { runCommands } from "../../../../src/lib/init/tools/run-commands.js";

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

function makePayload(command: string): RunCommandsPayload {
  return {
    type: "tool",
    operation: "run-commands",
    cwd: "/tmp",
    params: { commands: [command] },
  };
}

beforeEach(() => {
  spawnCalls.splice(0);
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe("runCommands spawn options", () => {
  test("uses the Windows shell for package-manager .cmd shims", async () => {
    setPlatform("win32");

    const result = await runCommands(makePayload("pnpm --version"), {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({
      command: "C:\\Tools\\pnpm.CMD",
      args: ["--version"],
      options: { shell: true },
    });
  });

  test("keeps Windows .exe commands shell-free", async () => {
    setPlatform("win32");

    const result = await runCommands(makePayload("dotnet --info"), {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({
      command: "C:\\Tools\\dotnet.exe",
      args: ["--info"],
      options: { shell: false },
    });
  });

  test("keeps POSIX command execution shell-free", async () => {
    setPlatform("darwin");

    const result = await runCommands(makePayload("pnpm --version"), {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({
      command: "/usr/local/bin/pnpm",
      args: ["--version"],
      options: { shell: false },
    });
  });
});
