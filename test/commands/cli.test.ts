/**
 * CLI Route Tests
 *
 * Tests for the sentry cli command group.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { feedbackCommand } from "../../src/commands/cli/feedback.js";
import { recordInstallCommand } from "../../src/commands/cli/record-install.js";
import { upgradeCommand } from "../../src/commands/cli/upgrade.js";
import { closeDatabase } from "../../src/lib/db/index.js";
import { getInstallInfo } from "../../src/lib/db/install-info.js";
import { cleanupTestDir, createTestConfigDir } from "../helpers.js";

describe("feedbackCommand.func", () => {
  test("throws ValidationError for empty message", async () => {
    // Access func through loader
    const func = await feedbackCommand.loader();
    const mockContext = {
      stdout: { write: mock(() => true) },
      stderr: { write: mock(() => true) },
    };

    await expect(func.call(mockContext, {}, "")).rejects.toThrow(
      "Please provide a feedback message."
    );
  });

  test("throws ValidationError for whitespace-only message", async () => {
    const func = await feedbackCommand.loader();
    const mockContext = {
      stdout: { write: mock(() => true) },
      stderr: { write: mock(() => true) },
    };

    await expect(func.call(mockContext, {}, "   ")).rejects.toThrow(
      "Please provide a feedback message."
    );
  });

  test("writes telemetry disabled message when Sentry is disabled", async () => {
    const func = await feedbackCommand.loader();
    const stderrWrite = mock(() => true);
    const mockContext = {
      stdout: { write: mock(() => true) },
      stderr: { write: stderrWrite },
    };

    // Sentry is disabled in test environment (no DSN)
    await func.call(mockContext, {}, "test", "feedback");

    expect(stderrWrite).toHaveBeenCalledWith(
      "Feedback not sent: telemetry is disabled.\n"
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      "Unset SENTRY_CLI_NO_TELEMETRY to enable feedback.\n"
    );
  });
});

// Test the upgrade command func
describe("upgradeCommand.func", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Note: We skip testing "unknown installation method" case because
  // detectInstallationMethod() runs actual shell commands (npm list, etc.)
  // which can be slow/flaky in CI. The unknown method handling is tested
  // indirectly through the upgrade.ts unit tests in lib/upgrade.test.ts.

  test("shows installation info with specified method", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: "v0.0.0-dev" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const func = await upgradeCommand.loader();
    const stdoutWrite = mock(() => true);
    const mockContext = {
      process: { execPath: "/test/path/sentry" },
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
    };

    // Use method flag to bypass detection (curl uses GitHub)
    await func.call(mockContext, { check: false, method: "curl" });

    expect(stdoutWrite).toHaveBeenCalledWith("Installation method: curl\n");
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining("Current version:")
    );
    expect(stdoutWrite).toHaveBeenCalledWith("\nAlready up to date.\n");
  });

  test("check mode shows update available", async () => {
    // curl uses GitHub API which returns { tag_name: "vX.X.X" }
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: "v99.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const func = await upgradeCommand.loader();
    const stdoutWrite = mock(() => true);
    const mockContext = {
      process: { execPath: "/test/path/sentry" },
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
    };

    await func.call(mockContext, { check: true, method: "curl" });

    expect(stdoutWrite).toHaveBeenCalledWith(
      "\nRun 'sentry cli upgrade' to update.\n"
    );
  });

  test("check mode with version shows versioned command", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: "v99.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const func = await upgradeCommand.loader();
    const stdoutWrite = mock(() => true);
    const mockContext = {
      process: { execPath: "/test/path/sentry" },
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
    };

    await func.call(mockContext, { check: true, method: "curl" }, "2.0.0");

    expect(stdoutWrite).toHaveBeenCalledWith("Target version: 2.0.0\n");
    expect(stdoutWrite).toHaveBeenCalledWith(
      "\nRun 'sentry cli upgrade 2.0.0' to update.\n"
    );
  });

  test("check mode shows already on target when versions match", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: "v0.0.0-dev" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const func = await upgradeCommand.loader();
    const stdoutWrite = mock(() => true);
    const mockContext = {
      process: { execPath: "/test/path/sentry" },
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
    };

    await func.call(mockContext, { check: true, method: "curl" });

    expect(stdoutWrite).toHaveBeenCalledWith(
      "\nYou are already on the target version.\n"
    );
  });

  test("throws UpgradeError when specified version does not exist", async () => {
    // First call: fetch latest (returns 99.0.0)
    // Second call: check if version exists (returns 404)
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      if (callCount === 1) {
        // Latest version check
        return new Response(JSON.stringify({ tag_name: "v99.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Version exists check - return 404
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const func = await upgradeCommand.loader();
    const stdoutWrite = mock(() => true);
    const mockContext = {
      process: { execPath: "/test/path/sentry" },
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
    };

    // Specify a version that doesn't exist
    await expect(
      func.call(mockContext, { check: false, method: "curl" }, "999.0.0")
    ).rejects.toThrow("Version 999.0.0 not found");
  });
});

// Test the record-install command func
describe("recordInstallCommand.func", () => {
  let testConfigDir: string;

  beforeEach(async () => {
    testConfigDir = await createTestConfigDir("test-record-install-");
    process.env.SENTRY_CONFIG_DIR = testConfigDir;
  });

  afterEach(async () => {
    closeDatabase();
    delete process.env.SENTRY_CONFIG_DIR;
    await cleanupTestDir(testConfigDir);
  });

  test("records curl install info", async () => {
    const func = await recordInstallCommand.loader();
    const mockContext = {
      process: { execPath: "/home/user/.local/bin/sentry" },
      stdout: { write: mock(() => true) },
      stderr: { write: mock(() => true) },
    };

    func.call(mockContext, { method: "curl" });

    const info = getInstallInfo();
    expect(info?.method).toBe("curl");
    expect(info?.path).toBe("/home/user/.local/bin/sentry");
  });

  test("records npm install info", async () => {
    const func = await recordInstallCommand.loader();
    const mockContext = {
      process: { execPath: "/usr/local/bin/sentry" },
      stdout: { write: mock(() => true) },
      stderr: { write: mock(() => true) },
    };

    func.call(mockContext, { method: "npm" });

    const info = getInstallInfo();
    expect(info?.method).toBe("npm");
  });

  test("uses provided path over execPath", async () => {
    const func = await recordInstallCommand.loader();
    const mockContext = {
      process: { execPath: "/default/path" },
      stdout: { write: mock(() => true) },
      stderr: { write: mock(() => true) },
    };

    func.call(mockContext, { method: "curl", path: "/custom/path/sentry" });

    const info = getInstallInfo();
    expect(info?.path).toBe("/custom/path/sentry");
  });

  test("overwrites existing install info", async () => {
    const func = await recordInstallCommand.loader();
    const mockContext = {
      process: { execPath: "/path1" },
      stdout: { write: mock(() => true) },
      stderr: { write: mock(() => true) },
    };

    func.call(mockContext, { method: "curl" });
    expect(getInstallInfo()?.method).toBe("curl");

    mockContext.process.execPath = "/path2";
    func.call(mockContext, { method: "npm" });
    expect(getInstallInfo()?.method).toBe("npm");
    expect(getInstallInfo()?.path).toBe("/path2");
  });
});
