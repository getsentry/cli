/**
 * Tests for log formatters
 */

import { describe, expect, test } from "bun:test";
import {
  formatLogRow,
  formatLogsHeader,
} from "../../../src/lib/formatters/log.js";
import type { SentryLog } from "../../../src/types/index.js";

function createTestLog(overrides: Partial<SentryLog> = {}): SentryLog {
  return {
    "sentry.item_id": "test-id-123",
    timestamp: "2025-01-30T14:32:15Z",
    timestamp_precise: 1_770_060_419_044_800_300,
    message: "Test log message",
    severity: "info",
    trace: "abc123def456",
    ...overrides,
  };
}

// Strip ANSI color codes for easier testing
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("formatLogRow", () => {
  test("formats basic log entry", () => {
    const log = createTestLog();
    const result = formatLogRow(log);

    // Should contain timestamp, severity, message, and trace
    expect(result).toContain("Test log message");
    expect(result).toContain("[abc123de]"); // First 8 chars of trace
    expect(result).toEndWith("\n");
  });

  test("handles missing message", () => {
    const log = createTestLog({ message: null });
    const result = formatLogRow(log);

    // Should not throw, just show empty message area
    expect(result).toContain("INFO");
    expect(result).toEndWith("\n");
  });

  test("handles missing severity", () => {
    const log = createTestLog({ severity: null });
    const result = stripAnsi(formatLogRow(log));

    // Should default to INFO
    expect(result).toContain("INFO");
  });

  test("handles missing trace", () => {
    const log = createTestLog({ trace: null });
    const result = formatLogRow(log);

    // Should not include trace bracket
    expect(result).not.toContain("[");
    expect(result).toContain("Test log message");
  });

  test("formats different severity levels", () => {
    const levels = [
      "fatal",
      "error",
      "warning",
      "warn",
      "info",
      "debug",
      "trace",
    ];

    for (const level of levels) {
      const log = createTestLog({ severity: level });
      const result = stripAnsi(formatLogRow(log));
      expect(result).toContain(level.toUpperCase().slice(0, 7)); // Max 7 chars
    }
  });

  test("pads severity to consistent width", () => {
    const shortLevel = createTestLog({ severity: "info" });
    const longLevel = createTestLog({ severity: "warning" });

    const shortResult = stripAnsi(formatLogRow(shortLevel));
    const longResult = stripAnsi(formatLogRow(longLevel));

    // Both should have severity at same position
    const shortPos = shortResult.indexOf("INFO");
    const longPos = longResult.indexOf("WARNING");

    // The position after timestamp should be consistent
    expect(shortPos).toBe(longPos);
  });

  test("formats timestamp in local format", () => {
    const log = createTestLog({ timestamp: "2025-01-30T14:32:15Z" });
    const result = formatLogRow(log);

    // Should have date and time format (actual values depend on timezone)
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  test("handles invalid timestamp gracefully", () => {
    const log = createTestLog({ timestamp: "invalid-date" });
    const result = formatLogRow(log);

    // Should return original string instead of NaN
    expect(result).toContain("invalid-date");
    expect(result).not.toContain("NaN");
  });
});

describe("formatLogsHeader", () => {
  test("contains column titles", () => {
    const result = stripAnsi(formatLogsHeader());

    expect(result).toContain("TIMESTAMP");
    expect(result).toContain("LEVEL");
    expect(result).toContain("MESSAGE");
  });

  test("contains divider line", () => {
    const result = formatLogsHeader();

    // Should have divider characters
    expect(result).toContain("─");
  });

  test("ends with newline", () => {
    const result = formatLogsHeader();
    expect(result).toEndWith("\n");
  });
});
