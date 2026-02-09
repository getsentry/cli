/**
 * Unit Tests for Trace Formatters
 *
 * Tests for formatTraceDuration, formatTracesHeader, formatTraceRow,
 * computeTraceSummary, and formatTraceSummary.
 */

import { describe, expect, test } from "bun:test";
import {
  computeTraceSummary,
  formatTraceDuration,
  formatTraceRow,
  formatTraceSummary,
  formatTracesHeader,
} from "../../../src/lib/formatters/trace.js";
import type {
  TraceSpan,
  TransactionListItem,
} from "../../../src/types/index.js";

/**
 * Strip ANSI escape codes for content assertions.
 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Create a minimal TraceSpan for testing.
 */
function makeSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    span_id: "abc123",
    start_timestamp: 1_700_000_000.0,
    timestamp: 1_700_000_001.5,
    ...overrides,
  };
}

/**
 * Create a minimal TransactionListItem for testing.
 */
function makeTransaction(
  overrides: Partial<TransactionListItem> = {}
): TransactionListItem {
  return {
    trace: "a".repeat(32),
    id: "b".repeat(32),
    transaction: "GET /api/users",
    timestamp: "2025-01-15T10:30:00Z",
    "transaction.duration": 1234,
    project: "my-project",
    ...overrides,
  };
}

describe("formatTraceDuration", () => {
  test("formats sub-second durations in milliseconds", () => {
    expect(formatTraceDuration(0)).toBe("0ms");
    expect(formatTraceDuration(1)).toBe("1ms");
    expect(formatTraceDuration(245)).toBe("245ms");
    expect(formatTraceDuration(999)).toBe("999ms");
  });

  test("formats seconds with two decimal places", () => {
    expect(formatTraceDuration(1000)).toBe("1.00s");
    expect(formatTraceDuration(1240)).toBe("1.24s");
    expect(formatTraceDuration(59_995)).toBe("59.99s");
  });

  test("formats minutes and seconds for >= 60s", () => {
    expect(formatTraceDuration(60_000)).toBe("1m 0s");
    expect(formatTraceDuration(135_000)).toBe("2m 15s");
    expect(formatTraceDuration(3_600_000)).toBe("60m 0s");
  });

  test("handles seconds rollover (never produces '60s')", () => {
    // 119500ms = 1m 59.5s, rounds to 2m 0s (not 1m 60s)
    expect(formatTraceDuration(119_500)).toBe("2m 0s");
    // 179500ms = 2m 59.5s, rounds to 3m 0s (not 2m 60s)
    expect(formatTraceDuration(179_500)).toBe("3m 0s");
    // 59500ms is < 60000 so uses seconds format
    expect(formatTraceDuration(59_500)).toBe("59.50s");
  });

  test("returns dash for invalid values", () => {
    expect(formatTraceDuration(Number.NaN)).toBe("—");
    expect(formatTraceDuration(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatTraceDuration(Number.NEGATIVE_INFINITY)).toBe("—");
    expect(formatTraceDuration(-100)).toBe("—");
  });
});

describe("formatTracesHeader", () => {
  test("contains column titles", () => {
    const header = stripAnsi(formatTracesHeader());
    expect(header).toContain("TRACE ID");
    expect(header).toContain("TRANSACTION");
    expect(header).toContain("DURATION");
    expect(header).toContain("WHEN");
  });

  test("ends with newline", () => {
    const header = formatTracesHeader();
    expect(header.endsWith("\n")).toBe(true);
  });
});

describe("formatTraceRow", () => {
  test("includes trace ID", () => {
    const traceId = "a".repeat(32);
    const row = formatTraceRow(makeTransaction({ trace: traceId }));
    expect(row).toContain(traceId);
  });

  test("includes transaction name", () => {
    const row = formatTraceRow(
      makeTransaction({ transaction: "POST /api/data" })
    );
    expect(row).toContain("POST /api/data");
  });

  test("includes formatted duration", () => {
    const row = formatTraceRow(
      makeTransaction({ "transaction.duration": 245 })
    );
    expect(row).toContain("245ms");
  });

  test("truncates long transaction names", () => {
    const longName = "A".repeat(50);
    const row = formatTraceRow(makeTransaction({ transaction: longName }));
    // Should be truncated to 30 chars
    expect(row).not.toContain(longName);
    expect(row).toContain("A".repeat(30));
  });

  test("shows 'unknown' for empty transaction", () => {
    const row = formatTraceRow(makeTransaction({ transaction: "" }));
    expect(row).toContain("unknown");
  });

  test("ends with newline", () => {
    const row = formatTraceRow(makeTransaction());
    expect(row.endsWith("\n")).toBe(true);
  });
});

describe("computeTraceSummary", () => {
  test("computes duration from span timestamps", () => {
    const spans: TraceSpan[] = [
      makeSpan({ start_timestamp: 1000.0, timestamp: 1002.5 }),
    ];
    const summary = computeTraceSummary("trace-id", spans);
    // (1002.5 - 1000.0) * 1000 = 2500ms
    expect(summary.duration).toBe(2500);
  });

  test("finds min start and max end across multiple spans", () => {
    const spans: TraceSpan[] = [
      makeSpan({ start_timestamp: 1000.0, timestamp: 1001.0 }),
      makeSpan({ start_timestamp: 999.5, timestamp: 1003.0 }),
    ];
    const summary = computeTraceSummary("trace-id", spans);
    // (1003.0 - 999.5) * 1000 = 3500ms
    expect(summary.duration).toBe(3500);
  });

  test("counts all spans including nested children", () => {
    const spans: TraceSpan[] = [
      makeSpan({
        children: [makeSpan({ children: [makeSpan()] }), makeSpan()],
      }),
    ];
    const summary = computeTraceSummary("trace-id", spans);
    expect(summary.spanCount).toBe(4);
  });

  test("collects unique project slugs", () => {
    const spans: TraceSpan[] = [
      makeSpan({
        project_slug: "frontend",
        children: [makeSpan({ project_slug: "backend" })],
      }),
      makeSpan({ project_slug: "frontend" }),
    ];
    const summary = computeTraceSummary("trace-id", spans);
    expect(summary.projects.sort()).toEqual(["backend", "frontend"]);
  });

  test("extracts root transaction name and op", () => {
    const spans: TraceSpan[] = [
      makeSpan({
        transaction: "GET /api/users",
        "transaction.op": "http.server",
      }),
    ];
    const summary = computeTraceSummary("trace-id", spans);
    expect(summary.rootTransaction).toBe("GET /api/users");
    expect(summary.rootOp).toBe("http.server");
  });

  test("uses description as fallback for root transaction", () => {
    const spans: TraceSpan[] = [makeSpan({ description: "My Transaction" })];
    const summary = computeTraceSummary("trace-id", spans);
    expect(summary.rootTransaction).toBe("My Transaction");
  });

  test("handles zero timestamps gracefully (NaN duration)", () => {
    const spans: TraceSpan[] = [makeSpan({ start_timestamp: 0, timestamp: 0 })];
    const summary = computeTraceSummary("trace-id", spans);
    expect(Number.isNaN(summary.duration)).toBe(true);
  });

  test("ignores zero timestamps in min/max calculations", () => {
    const spans: TraceSpan[] = [
      makeSpan({ start_timestamp: 0, timestamp: 0 }),
      makeSpan({ start_timestamp: 1000.0, timestamp: 1002.0 }),
    ];
    const summary = computeTraceSummary("trace-id", spans);
    // Only the valid span should contribute: (1002.0 - 1000.0) * 1000 = 2000ms
    expect(summary.duration).toBe(2000);
  });

  test("returns NaN duration for empty spans array", () => {
    const summary = computeTraceSummary("trace-id", []);
    expect(Number.isNaN(summary.duration)).toBe(true);
    expect(summary.spanCount).toBe(0);
  });

  test("falls back to timestamp when end_timestamp is 0", () => {
    // end_timestamp: 0 should be treated as missing, falling back to timestamp
    const spans: TraceSpan[] = [
      makeSpan({
        start_timestamp: 1000.0,
        end_timestamp: 0,
        timestamp: 1002.5,
      }),
    ];
    const summary = computeTraceSummary("trace-id", spans);
    // Should use timestamp (1002.5), not end_timestamp (0)
    // Duration: (1002.5 - 1000.0) * 1000 = 2500ms
    expect(summary.duration).toBe(2500);
  });
});

describe("formatTraceSummary", () => {
  test("includes trace ID in header", () => {
    const summary = computeTraceSummary("abc123def456", [
      makeSpan({ start_timestamp: 1000.0, timestamp: 1001.0 }),
    ]);
    const output = stripAnsi(formatTraceSummary(summary).join("\n"));
    expect(output).toContain("abc123def456");
  });

  test("shows root transaction with op prefix", () => {
    const summary = computeTraceSummary("trace-id", [
      makeSpan({
        transaction: "GET /api/users",
        "transaction.op": "http.server",
      }),
    ]);
    const output = stripAnsi(formatTraceSummary(summary).join("\n"));
    expect(output).toContain("[http.server] GET /api/users");
  });

  test("shows duration", () => {
    const summary = computeTraceSummary("trace-id", [
      makeSpan({ start_timestamp: 1000.0, timestamp: 1001.24 }),
    ]);
    const output = stripAnsi(formatTraceSummary(summary).join("\n"));
    expect(output).toContain("Duration:");
    expect(output).toContain("1.24s");
  });

  test("shows dash for NaN duration", () => {
    const summary = computeTraceSummary("trace-id", [
      makeSpan({ start_timestamp: 0, timestamp: 0 }),
    ]);
    const output = stripAnsi(formatTraceSummary(summary).join("\n"));
    expect(output).toContain("Duration:");
    expect(output).toContain("—");
  });

  test("shows span count", () => {
    const summary = computeTraceSummary("trace-id", [
      makeSpan({ children: [makeSpan(), makeSpan()] }),
    ]);
    const output = stripAnsi(formatTraceSummary(summary).join("\n"));
    expect(output).toContain("Span Count:  3");
  });

  test("shows projects when present", () => {
    const summary = computeTraceSummary("trace-id", [
      makeSpan({ project_slug: "my-app" }),
    ]);
    const output = stripAnsi(formatTraceSummary(summary).join("\n"));
    expect(output).toContain("Projects:");
    expect(output).toContain("my-app");
  });

  test("shows start time for valid timestamps", () => {
    const summary = computeTraceSummary("trace-id", [
      makeSpan({
        start_timestamp: 1_700_000_000.0,
        timestamp: 1_700_000_001.0,
      }),
    ]);
    const output = stripAnsi(formatTraceSummary(summary).join("\n"));
    expect(output).toContain("Started:");
  });

  test("omits start time when no valid timestamps", () => {
    const summary = computeTraceSummary("trace-id", [
      makeSpan({ start_timestamp: 0, timestamp: 0 }),
    ]);
    const output = stripAnsi(formatTraceSummary(summary).join("\n"));
    expect(output).not.toContain("Started:");
  });
});
