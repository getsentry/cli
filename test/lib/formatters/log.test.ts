/**
 * Tests for log formatters
 */

import { describe, expect, test } from "bun:test";
import {
  formatLogDetails,
  formatLogRow,
  formatLogsHeader,
} from "../../../src/lib/formatters/log.js";
import type { DetailedSentryLog, SentryLog } from "../../../src/types/index.js";

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

function createDetailedTestLog(
  overrides: Partial<DetailedSentryLog> = {}
): DetailedSentryLog {
  return {
    "sentry.item_id": "test-log-id-123456789012345678901234",
    timestamp: "2025-01-30T14:32:15Z",
    timestamp_precise: 1_770_060_419_044_800_300,
    message: "Test log message",
    severity: "info",
    trace: "abc123def456abc123def456abc12345",
    project: "test-project",
    environment: "production",
    release: "1.0.0",
    "sdk.name": "sentry.javascript.node",
    "sdk.version": "8.0.0",
    span_id: null,
    "code.function": null,
    "code.file.path": null,
    "code.line.number": null,
    "sentry.otel.kind": null,
    "sentry.otel.status_code": null,
    "sentry.otel.instrumentation_scope.name": null,
    ...overrides,
  };
}

describe("formatLogDetails", () => {
  test("formats basic log entry with header", () => {
    const log = createDetailedTestLog();
    const lines = formatLogDetails(log, "test-org");
    const result = lines.join("\n");

    expect(result).toContain("Log test-log-id");
    expect(result).toContain("═"); // Header separator
  });

  test("includes ID, timestamp, and severity", () => {
    const log = createDetailedTestLog();
    const lines = formatLogDetails(log, "test-org");
    const result = stripAnsi(lines.join("\n"));

    expect(result).toContain("ID:");
    expect(result).toContain("test-log-id-123456789012345678901234");
    expect(result).toContain("Timestamp:");
    expect(result).toContain("Severity:");
    expect(result).toContain("INFO");
  });

  test("includes message when present", () => {
    const log = createDetailedTestLog({ message: "Custom error message" });
    const lines = formatLogDetails(log, "test-org");
    const result = lines.join("\n");

    expect(result).toContain("Message:");
    expect(result).toContain("Custom error message");
  });

  test("shows Context section when project/environment/release present", () => {
    const log = createDetailedTestLog({
      project: "my-project",
      environment: "staging",
      release: "2.0.0",
    });
    const lines = formatLogDetails(log, "test-org");
    const result = stripAnsi(lines.join("\n"));

    expect(result).toContain("Context");
    expect(result).toContain("Project:");
    expect(result).toContain("my-project");
    expect(result).toContain("Environment:");
    expect(result).toContain("staging");
    expect(result).toContain("Release:");
    expect(result).toContain("2.0.0");
  });

  test("shows SDK section when sdk.name present", () => {
    const log = createDetailedTestLog({
      "sdk.name": "sentry.python",
      "sdk.version": "2.0.0",
    });
    const lines = formatLogDetails(log, "test-org");
    const result = stripAnsi(lines.join("\n"));

    expect(result).toContain("SDK");
    expect(result).toContain("sentry.python");
    expect(result).toContain("2.0.0");
  });

  test("shows Trace section with URL when trace ID present", () => {
    const log = createDetailedTestLog({
      trace: "trace123abc456def789",
      span_id: "span-abc-123",
    });
    const lines = formatLogDetails(log, "my-org");
    const result = stripAnsi(lines.join("\n"));

    expect(result).toContain("Trace");
    expect(result).toContain("Trace ID:");
    expect(result).toContain("trace123abc456def789");
    expect(result).toContain("Span ID:");
    expect(result).toContain("span-abc-123");
    expect(result).toContain("Link:");
    expect(result).toContain("my-org/traces/trace123abc456def789");
  });

  test("shows Source Location when code.function present", () => {
    const log = createDetailedTestLog({
      "code.function": "handleRequest",
      "code.file.path": "src/api/handler.ts",
      "code.line.number": "42",
    });
    const lines = formatLogDetails(log, "test-org");
    const result = stripAnsi(lines.join("\n"));

    expect(result).toContain("Source Location");
    expect(result).toContain("Function:");
    expect(result).toContain("handleRequest");
    expect(result).toContain("File:");
    expect(result).toContain("src/api/handler.ts:42");
  });

  test("shows OpenTelemetry section when otel fields present", () => {
    const log = createDetailedTestLog({
      "sentry.otel.kind": "server",
      "sentry.otel.status_code": "OK",
      "sentry.otel.instrumentation_scope.name": "express",
    });
    const lines = formatLogDetails(log, "test-org");
    const result = stripAnsi(lines.join("\n"));

    expect(result).toContain("OpenTelemetry");
    expect(result).toContain("Kind:");
    expect(result).toContain("server");
    expect(result).toContain("Status:");
    expect(result).toContain("OK");
    expect(result).toContain("Scope:");
    expect(result).toContain("express");
  });

  test("handles missing optional fields gracefully", () => {
    const log = createDetailedTestLog({
      message: null,
      trace: null,
      project: null,
      environment: null,
      release: null,
      "sdk.name": null,
      "sdk.version": null,
    });
    const lines = formatLogDetails(log, "test-org");
    const result = stripAnsi(lines.join("\n"));

    // Should still have basic info
    expect(result).toContain("ID:");
    expect(result).toContain("Timestamp:");
    expect(result).toContain("Severity:");

    // Should not have optional sections
    expect(result).not.toContain("Context");
    expect(result).not.toContain("SDK");
    expect(result).not.toContain("Trace");
  });
});
