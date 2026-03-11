/**
 * CLI Route Tests
 *
 * Tests for the sentry cli command group.
 *
 * Status messages go through consola (→ process.stderr). Tests capture stderr
 * via a spy on process.stderr.write and assert on the collected output.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { feedbackCommand } from "../../src/commands/cli/feedback.js";
import { upgradeCommand } from "../../src/commands/cli/upgrade.js";

/**
 * Create a mock context with a process.stderr.write spy for capturing
 * consola output, plus Stricli error capture via context.stderr.
 */
function createMockContext(overrides: Partial<{ execPath: string }> = {}): {
  context: Record<string, unknown>;
  getOutput: () => string;
  errors: string[];
  restore: () => void;
} {
  const stderrChunks: string[] = [];
  const errors: string[] = [];

  // Capture consola output (routed to process.stderr)
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  const context = {
    process: { execPath: overrides.execPath ?? "/test/path/sentry" },
    stdout: {
      write: mock((_s: string) => {
        /* unused — output goes through consola */
      }),
    },
    stderr: {
      write: (s: string) => {
        errors.push(s);
        return true;
      },
    },
  };

  return {
    context,
    getOutput: () => stderrChunks.join(""),
    errors,
    restore: () => {
      process.stderr.write = origWrite;
    },
  };
}

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

  test("throws ConfigError when Sentry is disabled", async () => {
    const func = await feedbackCommand.loader();
    const mockContext = {
      stdout: { write: mock(() => true) },
      stderr: { write: mock(() => true) },
    };

    // Sentry is disabled in test environment (no DSN)
    await expect(
      func.call(mockContext, {}, "test", "feedback")
    ).rejects.toThrow("Feedback not sent: telemetry is disabled.");
  });
});

// Test the upgrade command func
describe("upgradeCommand.func", () => {
  let originalFetch: typeof globalThis.fetch;
  let restoreStderr: (() => void) | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreStderr?.();
    restoreStderr = undefined;
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
    const { context, getOutput, restore } = createMockContext();
    restoreStderr = restore;

    // Use method flag to bypass detection (curl uses GitHub)
    await func.call(context, { check: false, method: "curl" });

    const output = getOutput();
    expect(output).toContain("Installation method: curl");
    expect(output).toContain("Current version:");
    expect(output).toContain("Already up to date.");
  });

  test("check mode shows update available", async () => {
    // curl uses GitHub API which returns { tag_name: "vX.X.X" }
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: "v99.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const func = await upgradeCommand.loader();
    const { context, getOutput, restore } = createMockContext();
    restoreStderr = restore;

    await func.call(context, { check: true, method: "curl" });

    const output = getOutput();
    expect(output).toContain("Run 'sentry cli upgrade' to update.");
  });

  test("check mode with version shows versioned command", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: "v99.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const func = await upgradeCommand.loader();
    const { context, getOutput, restore } = createMockContext();
    restoreStderr = restore;

    await func.call(context, { check: true, method: "curl" }, "2.0.0");

    const output = getOutput();
    expect(output).toContain("Target version: 2.0.0");
    expect(output).toContain("Run 'sentry cli upgrade 2.0.0' to update.");
  });

  test("check mode shows already on target when versions match", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: "v0.0.0-dev" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const func = await upgradeCommand.loader();
    const { context, getOutput, restore } = createMockContext();
    restoreStderr = restore;

    await func.call(context, { check: true, method: "curl" });

    const output = getOutput();
    expect(output).toContain("You are already on the target version.");
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
    const { context, restore } = createMockContext();
    restoreStderr = restore;

    // Specify a version that doesn't exist
    await expect(
      func.call(context, { check: false, method: "curl" }, "999.0.0")
    ).rejects.toThrow("Version 999.0.0 not found");
  });
});
