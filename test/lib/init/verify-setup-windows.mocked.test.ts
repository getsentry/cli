/** Windows process-tree cleanup tests with child_process mocked before import. */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TEST_TMP_DIR } from "../../constants.js";
import { createMockUI } from "./ui/mock-ui.js";

const mocks = vi.hoisted(() => ({
  childKillCalls: [] as NodeJS.Signals[],
  spawnCalls: [] as Array<{ options: { detached?: boolean } }>,
  taskkillCalls: [] as Array<{
    command: string;
    args: string[];
    options: { timeout?: number };
  }>,
  taskkillStatuses: [] as number[],
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");

  return {
    ...actual,
    spawn: vi.fn(
      (_command: string, _args: string[], options: { detached?: boolean }) => {
        mocks.spawnCalls.push({ options });
        const child = new EventEmitter() as EventEmitter & {
          exitCode: number | null;
          kill: (signal: NodeJS.Signals) => boolean;
          pid: number;
          stderr: PassThrough;
          stdout: PassThrough;
        };
        child.pid = 4321;
        child.exitCode = null;
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = (signal) => {
          mocks.childKillCalls.push(signal);
          return true;
        };
        queueMicrotask(() => {
          child.stderr.write("SyntaxError: Windows verification fixture\n");
        });
        return child;
      }
    ),
    spawnSync: vi.fn(
      (command: string, args: string[], options: { timeout?: number }) => {
        mocks.taskkillCalls.push({ command, args, options });
        return {
          error: undefined,
          pid: 0,
          output: [],
          signal: null,
          status: mocks.taskkillStatuses.shift() ?? 0,
          stderr: null,
          stdout: null,
        };
      }
    ),
  };
});

vi.mock("@sentry/node-core/light", () => ({
  captureException: vi.fn(),
}));

import { verifySetup } from "../../../src/lib/init/verify-setup.js";

const originalPlatform = process.platform;
let tmpDir: string;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

beforeEach(async () => {
  setPlatform("win32");
  mocks.childKillCalls.length = 0;
  mocks.spawnCalls.length = 0;
  mocks.taskkillCalls.length = 0;
  mocks.taskkillStatuses.length = 0;
  tmpDir = await mkdtemp(join(TEST_TMP_DIR, "verify-setup-windows-test-"));
  await writeFile(
    join(tmpDir, "package.json"),
    JSON.stringify({ scripts: { dev: "node server.js" } })
  );
});

afterEach(async () => {
  setPlatform(originalPlatform);
  await rm(tmpDir, { recursive: true, force: true });
});

describe("verifySetup Windows cleanup", () => {
  test("terminates the process tree with bounded taskkill", async () => {
    const { ui } = createMockUI();

    await verifySetup(
      { status: "success", result: { platform: "javascript-nextjs" } },
      ui,
      tmpDir
    );

    expect(mocks.spawnCalls[0]?.options.detached).toBe(false);
    expect(mocks.taskkillCalls).toEqual([
      {
        command: "taskkill",
        args: ["/PID", "4321", "/T"],
        options: expect.objectContaining({ timeout: 1000 }),
      },
    ]);
    expect(mocks.childKillCalls).toEqual([]);
  });

  test("forces the tree and falls back to the child when taskkill fails", async () => {
    mocks.taskkillStatuses.push(1, 1);
    const { ui } = createMockUI();

    await verifySetup(
      { status: "success", result: { platform: "javascript-nextjs" } },
      ui,
      tmpDir
    );

    expect(mocks.taskkillCalls.map(({ args }) => args)).toEqual([
      ["/PID", "4321", "/T"],
      ["/PID", "4321", "/T", "/F"],
    ]);
    expect(mocks.childKillCalls).toEqual(["SIGKILL"]);
  });
});
