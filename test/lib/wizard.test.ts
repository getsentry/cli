/**
 * Wizard Module Tests
 *
 * Tests for the runWizard function that spawns @sentry/wizard.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

// Store original Bun.which for restoration
const originalBunWhich = Bun.which;

// Mock spawn function and captured calls
let mockSpawn: ReturnType<typeof mock>;
let lastSpawnedProc: EventEmitter | null = null;
let spawnCalls: Array<{ command: string; args: string[]; options: unknown }> =
  [];

beforeEach(() => {
  spawnCalls = [];
  lastSpawnedProc = null;

  // Create mock spawn that returns an EventEmitter
  mockSpawn = mock((command: string, args: string[], options: unknown) => {
    spawnCalls.push({ command, args, options });
    const proc = new EventEmitter();
    lastSpawnedProc = proc;
    return proc;
  });

  // Mock node:child_process
  mock.module("node:child_process", () => ({
    spawn: mockSpawn,
  }));
});

afterEach(() => {
  // Restore Bun.which
  (Bun as { which: typeof Bun.which }).which = originalBunWhich;
});

/**
 * Helper to mock Bun.which
 */
function mockBunWhich(returnValue: string | null) {
  (Bun as { which: typeof Bun.which }).which = () => returnValue;
}

describe("runWizard", () => {
  test("rejects when npx is not found", async () => {
    mockBunWhich(null);

    // Import after mocking
    const { runWizard } = await import("../../src/lib/wizard.js");

    await expect(runWizard({})).rejects.toThrow(
      "npx not found. Please install Node.js/npm to use the init command."
    );
  });

  test("resolves when wizard exits with code 0", async () => {
    mockBunWhich("/usr/local/bin/npx");

    const { runWizard } = await import("../../src/lib/wizard.js");

    const promise = runWizard({});

    // Give the promise time to set up the event listener
    await Bun.sleep(10);

    // Emit close with success code
    lastSpawnedProc?.emit("close", 0);

    await expect(promise).resolves.toBeUndefined();
  });

  test("rejects when wizard exits with non-zero code", async () => {
    mockBunWhich("/usr/local/bin/npx");

    const { runWizard } = await import("../../src/lib/wizard.js");

    const promise = runWizard({});

    await Bun.sleep(10);

    // Emit close with error code
    lastSpawnedProc?.emit("close", 1);

    await expect(promise).rejects.toThrow("Wizard exited with code 1");
  });

  test("rejects when spawn emits error", async () => {
    mockBunWhich("/usr/local/bin/npx");

    const { runWizard } = await import("../../src/lib/wizard.js");

    const promise = runWizard({});

    await Bun.sleep(10);

    // Emit error event
    lastSpawnedProc?.emit("error", new Error("ENOENT: command not found"));

    await expect(promise).rejects.toThrow(
      "Failed to start wizard: ENOENT: command not found"
    );
  });

  test("passes correct arguments to spawn with no options", async () => {
    mockBunWhich("/usr/local/bin/npx");

    const { runWizard } = await import("../../src/lib/wizard.js");

    const promise = runWizard({});

    await Bun.sleep(10);
    lastSpawnedProc?.emit("close", 0);
    await promise;

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe("/usr/local/bin/npx");
    expect(spawnCalls[0].args).toEqual(["@sentry/wizard@latest"]);
    expect(spawnCalls[0].options).toMatchObject({
      stdio: "inherit",
    });
  });

  test("passes correct arguments to spawn with all options", async () => {
    mockBunWhich("/usr/bin/npx");

    const { runWizard } = await import("../../src/lib/wizard.js");

    const promise = runWizard({
      integration: "nextjs",
      org: "my-org",
      project: "my-project",
      url: "https://sentry.example.com",
      debug: true,
      uninstall: true,
      quiet: true,
      skipConnect: true,
      saas: true,
      signup: true,
      disableTelemetry: true,
    });

    await Bun.sleep(10);
    lastSpawnedProc?.emit("close", 0);
    await promise;

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe("/usr/bin/npx");
    expect(spawnCalls[0].args).toEqual([
      "@sentry/wizard@latest",
      "-i",
      "nextjs",
      "--org",
      "my-org",
      "--project",
      "my-project",
      "-u",
      "https://sentry.example.com",
      "--debug",
      "--uninstall",
      "--quiet",
      "--skip-connect",
      "--saas",
      "-s",
      "--disable-telemetry",
    ]);
  });

  test("rejects with specific exit code in error message", async () => {
    mockBunWhich("/usr/local/bin/npx");

    const { runWizard } = await import("../../src/lib/wizard.js");

    const promise = runWizard({ integration: "flutter" });

    await Bun.sleep(10);
    lastSpawnedProc?.emit("close", 127);

    await expect(promise).rejects.toThrow("Wizard exited with code 127");
  });
});
