/**
 * Tests for terminal color utilities.
 *
 * Covers: statusColor, levelColor, fixabilityColor, terminalLink,
 * and the base color functions.
 */

import { describe, expect, test } from "bun:test";
import chalk from "chalk";
import {
  fixabilityColor,
  levelColor,
  statusColor,
  terminalLink,
} from "../../../src/lib/formatters/colors.js";

// Force chalk colors even in test environment
chalk.level = 3;

/** Strip ANSI escape codes for content assertions */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("statusColor", () => {
  test("resolved → green-styled text", () => {
    const result = statusColor("text", "resolved");
    expect(result).toContain("\x1b[");
    expect(stripAnsi(result)).toBe("text");
  });

  test("unresolved → yellow-styled text", () => {
    const result = statusColor("text", "unresolved");
    expect(result).toContain("\x1b[");
    expect(stripAnsi(result)).toBe("text");
  });

  test("ignored → muted-styled text", () => {
    const result = statusColor("text", "ignored");
    expect(result).toContain("\x1b[");
    expect(stripAnsi(result)).toBe("text");
  });

  test("undefined defaults to unresolved styling", () => {
    const result = statusColor("text", undefined);
    expect(result).toContain("\x1b[");
    expect(stripAnsi(result)).toBe("text");
  });

  test("RESOLVED works case-insensitively", () => {
    const result = statusColor("text", "RESOLVED");
    expect(result).toContain("\x1b[");
    expect(stripAnsi(result)).toBe("text");
  });
});

describe("levelColor", () => {
  test("fatal → colored text", () => {
    const result = levelColor("text", "fatal");
    expect(result).toContain("\x1b[");
    expect(stripAnsi(result)).toBe("text");
  });

  test("error → colored text", () => {
    const result = levelColor("text", "error");
    expect(result).toContain("\x1b[");
  });

  test("warning → colored text", () => {
    const result = levelColor("text", "warning");
    expect(result).toContain("\x1b[");
  });

  test("info → colored text", () => {
    const result = levelColor("text", "info");
    expect(result).toContain("\x1b[");
  });

  test("debug → colored text", () => {
    const result = levelColor("text", "debug");
    expect(result).toContain("\x1b[");
  });

  test("unknown level returns uncolored text", () => {
    const result = levelColor("text", "unknown");
    expect(result).toBe("text");
  });

  test("undefined returns uncolored text", () => {
    const result = levelColor("text", undefined);
    expect(result).toBe("text");
  });
});

describe("fixabilityColor", () => {
  test("high → green-styled text", () => {
    const result = fixabilityColor("text", "high");
    expect(result).toContain("\x1b[");
    expect(stripAnsi(result)).toBe("text");
  });

  test("med → yellow-styled text", () => {
    const result = fixabilityColor("text", "med");
    expect(result).toContain("\x1b[");
    expect(stripAnsi(result)).toBe("text");
  });

  test("low → red-styled text", () => {
    const result = fixabilityColor("text", "low");
    expect(result).toContain("\x1b[");
    expect(stripAnsi(result)).toBe("text");
  });
});

describe("terminalLink", () => {
  test("wraps text in OSC 8 escape sequences", () => {
    const result = terminalLink("click me", "https://example.com");
    expect(result).toContain("]8;;https://example.com");
    expect(result).toContain("click me");
    expect(result).toContain("]8;;");
  });

  test("preserves display text", () => {
    const result = terminalLink("display", "https://url.com");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: OSC 8 uses control chars
    const stripped = result.replace(/\x1b\]8;;[^\x07]*\x07/g, "");
    expect(stripped).toBe("display");
  });
});
