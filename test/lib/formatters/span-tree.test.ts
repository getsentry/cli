/**
 * Tests for span tree formatting
 */

import { describe, expect, test } from "bun:test";
import { formatSpanTree } from "../../../src/lib/formatters/human.js";
import type { Span, TraceEvent } from "../../../src/types/index.js";

// Helper to strip ANSI codes for content testing
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Create a minimal span for testing
 */
function makeSpan(
  id: string,
  parentId?: string | null,
  options: {
    durationSec?: number;
    startTs?: number;
    op?: string;
    description?: string | null;
  } = {}
): Span {
  const {
    durationSec = 0.1,
    startTs = 1000.0,
    op = "test.op",
    description = `Span ${id}`,
  } = options;
  return {
    span_id: id,
    parent_span_id: parentId ?? null,
    start_timestamp: startTs,
    timestamp: startTs + durationSec,
    op,
    description,
  };
}

/**
 * Create a minimal trace event for testing
 */
function makeTraceEvent(
  id: string,
  spans: Span[] = [],
  options: {
    startTs?: number;
    transaction?: string;
    op?: string;
    durationMs?: number;
  } = {}
): TraceEvent {
  const {
    startTs = 1000.0,
    transaction = `Transaction ${id}`,
    op = "http.server",
    durationMs = 100,
  } = options;
  return {
    event_id: id,
    transaction,
    "transaction.op": op,
    "transaction.duration": durationMs,
    start_timestamp: startTs,
    spans,
  };
}

describe("formatSpanTree", () => {
  describe("empty and edge cases", () => {
    test("returns message for empty trace events array", () => {
      const result = formatSpanTree([]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("No span data available");
    });

    test("handles trace event with no spans", () => {
      const result = formatSpanTree([makeTraceEvent("1")]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("Transaction 1");
      expect(output).toContain("100ms");
      expect(output).toContain("(http.server)");
    });

    test("handles trace event with missing transaction name", () => {
      const event: TraceEvent = {
        event_id: "1",
        "transaction.duration": 50,
      };
      const result = formatSpanTree([event]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("(unnamed transaction)");
    });

    test("handles trace event with missing op", () => {
      const event: TraceEvent = {
        event_id: "1",
        transaction: "Test",
      };
      const result = formatSpanTree([event]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("(unknown)");
    });

    test("handles trace event with missing duration", () => {
      const event: TraceEvent = {
        event_id: "1",
        transaction: "Test",
      };
      const result = formatSpanTree([event]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("[?]");
    });
  });

  describe("duration formatting", () => {
    test("formats milliseconds under 1 second as Xms", () => {
      const spans = [makeSpan("1", null, { durationSec: 0.5 })]; // 500ms
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("500ms");
    });

    test("formats seconds with 2 decimal places as X.XXs", () => {
      const spans = [makeSpan("1", null, { durationSec: 1.234 })]; // 1234ms
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("1.23s");
    });

    test("clamps negative duration to 0ms", () => {
      const spans: Span[] = [
        {
          span_id: "bad",
          start_timestamp: 1000.5,
          timestamp: 1000.0, // End before start!
          op: "test",
          description: "Bad span",
        },
      ];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("[0ms]");
    });

    test("handles zero duration", () => {
      const spans = [makeSpan("1", null, { durationSec: 0 })];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("[0ms]");
    });
  });

  describe("tree structure", () => {
    test("builds flat list from spans without parent_span_id", () => {
      const spans = [
        makeSpan("a", null, { startTs: 1000.0 }),
        makeSpan("b", null, { startTs: 1001.0 }),
        makeSpan("c", null, { startTs: 1002.0 }),
      ];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("Span a");
      expect(output).toContain("Span b");
      expect(output).toContain("Span c");
    });

    test("nests child spans under parent", () => {
      const spans = [
        makeSpan("root", null, { startTs: 1000.0 }),
        makeSpan("child", "root", { startTs: 1000.1 }),
      ];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const lines = result.map(stripAnsi);

      // Find the lines containing our spans
      const rootLine = lines.find((l) => l.includes("Span root"));
      const childLine = lines.find((l) => l.includes("Span child"));

      expect(rootLine).toBeDefined();
      expect(childLine).toBeDefined();

      // Child should have more leading whitespace (indentation)
      const rootIndent = rootLine?.match(/^\s*/)?.[0].length ?? 0;
      const childIndent = childLine?.match(/^\s*/)?.[0].length ?? 0;
      expect(childIndent).toBeGreaterThan(rootIndent);
    });

    test("handles deeply nested spans (3 levels)", () => {
      const spans = [
        makeSpan("level1", null, { startTs: 1000.0 }),
        makeSpan("level2", "level1", { startTs: 1000.1 }),
        makeSpan("level3", "level2", { startTs: 1000.2 }),
      ];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const lines = result.map(stripAnsi);

      const level1Line = lines.find((l) => l.includes("Span level1"));
      const level2Line = lines.find((l) => l.includes("Span level2"));
      const level3Line = lines.find((l) => l.includes("Span level3"));

      expect(level1Line).toBeDefined();
      expect(level2Line).toBeDefined();
      expect(level3Line).toBeDefined();

      // Each level should have more indentation
      const indent1 = level1Line?.match(/^\s*/)?.[0].length ?? 0;
      const indent2 = level2Line?.match(/^\s*/)?.[0].length ?? 0;
      const indent3 = level3Line?.match(/^\s*/)?.[0].length ?? 0;

      expect(indent2).toBeGreaterThan(indent1);
      expect(indent3).toBeGreaterThan(indent2);
    });

    test("treats orphaned spans as roots", () => {
      const spans = [makeSpan("orphan", "non-existent-parent")];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));
      // Orphan should appear as a root (not dropped)
      expect(output).toContain("Span orphan");
    });

    test("handles mixed roots and nested spans", () => {
      const spans = [
        makeSpan("root1", null, { startTs: 1000.0 }),
        makeSpan("child1", "root1", { startTs: 1000.1 }),
        makeSpan("root2", null, { startTs: 1001.0 }),
      ];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("Span root1");
      expect(output).toContain("Span child1");
      expect(output).toContain("Span root2");
    });
  });

  describe("sorting", () => {
    test("sorts trace events by start_timestamp", () => {
      const events = [
        makeTraceEvent("second", [], { startTs: 2000.0 }),
        makeTraceEvent("first", [], { startTs: 1000.0 }),
      ];
      const result = formatSpanTree(events);
      const output = stripAnsi(result.join("\n"));

      const firstIdx = output.indexOf("Transaction first");
      const secondIdx = output.indexOf("Transaction second");
      expect(firstIdx).toBeLessThan(secondIdx);
    });

    test("sorts spans by start_timestamp", () => {
      const spans = [
        makeSpan("c", null, { startTs: 1003.0 }),
        makeSpan("a", null, { startTs: 1001.0 }),
        makeSpan("b", null, { startTs: 1002.0 }),
      ];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));

      const aIdx = output.indexOf("Span a");
      const bIdx = output.indexOf("Span b");
      const cIdx = output.indexOf("Span c");

      expect(aIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(cIdx);
    });

    test("handles trace events with undefined start_timestamp", () => {
      const events: TraceEvent[] = [
        { event_id: "2", transaction: "Second" },
        { event_id: "1", transaction: "First", start_timestamp: 500.0 },
      ];
      const result = formatSpanTree(events);
      const output = stripAnsi(result.join("\n"));

      // Event without timestamp (defaults to 0) should come first
      const secondIdx = output.indexOf("Second");
      const firstIdx = output.indexOf("First");
      expect(secondIdx).toBeLessThan(firstIdx);
    });
  });

  describe("formatting output", () => {
    test("truncates long descriptions at 50 chars", () => {
      const longDesc =
        "This is a very long description that exceeds the maximum length allowed";
      const spans = [makeSpan("1", null, { description: longDesc })];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));

      // Should be truncated with ...
      expect(output).toContain("...");
      expect(output).not.toContain(longDesc);
      // First part should be there
      expect(output).toContain("This is a very long description that excee");
    });

    test("shows (no description) when description is null", () => {
      const spans = [makeSpan("1", null, { description: null })];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("(no description)");
    });

    test("shows unknown when op is missing", () => {
      const spans: Span[] = [
        {
          span_id: "1",
          start_timestamp: 1000.0,
          timestamp: 1000.1,
          description: "Test",
        },
      ];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("(unknown)");
    });

    test("uses correct tree branch characters", () => {
      const spans = [
        makeSpan("first", null, { startTs: 1000.0 }),
        makeSpan("last", null, { startTs: 1001.0 }),
      ];
      const result = formatSpanTree([makeTraceEvent("1", spans)]);
      const output = result.join("\n");

      // First sibling uses ├─, last sibling uses └─
      expect(output).toContain("├─");
      expect(output).toContain("└─");
    });

    test("includes Span Tree header", () => {
      const result = formatSpanTree([makeTraceEvent("1")]);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("Span Tree");
    });
  });

  describe("duration coloring", () => {
    // Helper to check for ANSI escape codes
    function hasAnsiCodes(str: string): boolean {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
      return /\x1b\[[0-9;]*m/.test(str);
    }

    test("applies color styling for slow spans", () => {
      // Fast span (under 1s) - duration formatted but may not have color
      const fastSpans = [makeSpan("fast", null, { durationSec: 0.5 })];
      const fastResult = formatSpanTree([makeTraceEvent("1", fastSpans)]);
      const fastOutput = fastResult.join("\n");
      expect(stripAnsi(fastOutput)).toContain("500ms");

      // Slow span (over 1s) - should have yellow color applied
      const slowSpans = [makeSpan("slow", null, { durationSec: 2.0 })];
      const slowResult = formatSpanTree([makeTraceEvent("1", slowSpans)]);
      const slowOutput = slowResult.join("\n");
      expect(stripAnsi(slowOutput)).toContain("2.00s");

      // Very slow span (over 5s) - should have red color applied
      const verySlowSpans = [makeSpan("very-slow", null, { durationSec: 6.0 })];
      const verySlowResult = formatSpanTree([
        makeTraceEvent("1", verySlowSpans),
      ]);
      const verySlowOutput = verySlowResult.join("\n");
      expect(stripAnsi(verySlowOutput)).toContain("6.00s");

      // If colors are enabled, slow spans should have ANSI codes
      const colorsEnabled = process.env.FORCE_COLOR === "1";
      if (colorsEnabled) {
        expect(hasAnsiCodes(slowOutput)).toBe(true);
        expect(hasAnsiCodes(verySlowOutput)).toBe(true);
      }
    });
  });

  describe("multiple transactions", () => {
    test("formats multiple trace events with blank lines between", () => {
      const events = [
        makeTraceEvent("1", [], { startTs: 1000.0 }),
        makeTraceEvent("2", [], { startTs: 2000.0 }),
      ];
      const result = formatSpanTree(events);

      // Should have blank lines between transactions
      const blankLineCount = result.filter((line) => line === "").length;
      expect(blankLineCount).toBeGreaterThanOrEqual(2);
    });

    test("each transaction shows its own spans", () => {
      const events = [
        makeTraceEvent("1", [makeSpan("span-1")], { startTs: 1000.0 }),
        makeTraceEvent("2", [makeSpan("span-2")], { startTs: 2000.0 }),
      ];
      const result = formatSpanTree(events);
      const output = stripAnsi(result.join("\n"));

      expect(output).toContain("Transaction 1");
      expect(output).toContain("Span span-1");
      expect(output).toContain("Transaction 2");
      expect(output).toContain("Span span-2");
    });
  });
});
