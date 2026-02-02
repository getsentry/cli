/**
 * CLI Route Tests
 *
 * Tests for the sentry cli command group.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { feedbackCommand } from "../../src/commands/cli/feedback.js";
import { upgradeCommand } from "../../src/commands/cli/upgrade.js";

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
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
    };

    // Specify a version that doesn't exist
    await expect(
      func.call(mockContext, { check: false, method: "curl" }, "999.0.0")
    ).rejects.toThrow("Version 999.0.0 not found");
  });
});
