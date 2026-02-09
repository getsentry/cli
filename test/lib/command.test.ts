/**
 * Command Builder Tests
 *
 * Tests for the buildCommand wrapper that adds automatic flag telemetry.
 */

import { describe, expect, test } from "bun:test";
import { buildCommand } from "../../src/lib/command.js";

describe("buildCommand", () => {
  test("wraps command and returns a valid command object", () => {
    const command = buildCommand({
      docs: { brief: "Test command" },
      parameters: {
        flags: {
          verbose: { kind: "boolean", brief: "Verbose output", default: false },
          limit: {
            kind: "parsed",
            parse: Number,
            brief: "Limit",
            default: "10",
          },
        },
      },
      func(_flags: { verbose: boolean; limit: number }) {
        // Command functions return void
      },
    });

    // The command should be built successfully
    expect(command).toBeDefined();
  });

  test("handles commands with empty parameters", () => {
    const command = buildCommand({
      docs: { brief: "Simple command" },
      parameters: {},
      func() {
        // No-op
      },
    });

    expect(command).toBeDefined();
  });

  test("handles async command functions", () => {
    const command = buildCommand({
      docs: { brief: "Async command" },
      parameters: {
        flags: {
          delay: {
            kind: "parsed",
            parse: Number,
            brief: "Delay",
            default: "1",
          },
        },
      },
      async func(_flags: { delay: number }) {
        await Bun.sleep(1);
      },
    });

    expect(command).toBeDefined();
  });

  test("handles command functions that return Error", () => {
    const command = buildCommand({
      docs: { brief: "Error command" },
      parameters: {
        flags: {
          shouldFail: { kind: "boolean", brief: "Fail", default: false },
        },
      },
      func(_flags: { shouldFail: boolean }): Error | undefined {
        if (_flags.shouldFail) {
          return new Error("Failed");
        }
        return;
      },
    });

    expect(command).toBeDefined();
  });
});
