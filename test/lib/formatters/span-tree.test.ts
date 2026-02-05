/**
 * Tests for span tree formatting
 */

import { describe, expect, test } from "bun:test";
import { formatSimpleSpanTree } from "../../../src/lib/formatters/human.js";
import type { TraceSpan } from "../../../src/types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip ANSI escape codes from a string for content assertions.
 * Allows tests to verify text content without color interference.
 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Create a minimal TraceSpan for testing the simple span tree format.
 * TraceSpan differs from Span in that it has nested children (hierarchical structure).
 *
 * @param op - Operation name (e.g., "http.server", "db.query")
 * @param description - Human-readable description of the span
 * @param children - Nested child spans (already in tree form)
 */
function makeTraceSpan(
  op: string,
  description: string,
  children: TraceSpan[] = []
): TraceSpan {
  return {
    span_id: `span-${op}`,
    op,
    description,
    start_timestamp: 1000.0,
    timestamp: 1001.0,
    children,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests for formatSimpleSpanTree
// ─────────────────────────────────────────────────────────────────────────────

describe("formatSimpleSpanTree", () => {
  describe("empty and edge cases", () => {
    test("returns message for empty spans array", () => {
      const result = formatSimpleSpanTree("trace-123", []);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("No span data available");
    });

    test("includes trace ID in header", () => {
      const spans = [makeTraceSpan("http.server", "GET /api")];
      const result = formatSimpleSpanTree("abc123def456", spans);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("Trace —");
      expect(output).toContain("abc123def456");
    });
  });

  describe("simple tree format", () => {
    test("shows op — description format", () => {
      const spans = [makeTraceSpan("http.server", "GET /api/users")];
      const result = formatSimpleSpanTree("trace-123", spans);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("http.server");
      expect(output).toContain("—");
      expect(output).toContain("GET /api/users");
    });

    test("does not show durations", () => {
      const spans = [makeTraceSpan("db.query", "SELECT * FROM users")];
      const result = formatSimpleSpanTree("trace-123", spans);
      const output = stripAnsi(result.join("\n"));
      // Should not contain any duration patterns like "100ms" or "1.00s"
      expect(output).not.toMatch(/\d+ms/);
      expect(output).not.toMatch(/\d+\.\d+s/);
    });

    test("handles missing op gracefully", () => {
      const spans: TraceSpan[] = [
        {
          span_id: "1",
          description: "Some operation",
          start_timestamp: 1000.0,
          timestamp: 1001.0,
        },
      ];
      const result = formatSimpleSpanTree("trace-123", spans);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("unknown");
      expect(output).toContain("Some operation");
    });

    test("handles missing description gracefully", () => {
      const spans: TraceSpan[] = [
        {
          span_id: "1",
          op: "http.client",
          start_timestamp: 1000.0,
          timestamp: 1001.0,
        },
      ];
      const result = formatSimpleSpanTree("trace-123", spans);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("http.client");
      expect(output).toContain("(no description)");
    });

    test("uses transaction as fallback for description", () => {
      const spans: TraceSpan[] = [
        {
          span_id: "1",
          op: "cli",
          transaction: "My CLI Command",
          start_timestamp: 1000.0,
          timestamp: 1001.0,
        },
      ];
      const result = formatSimpleSpanTree("trace-123", spans);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("My CLI Command");
    });
  });

  describe("nested children", () => {
    test("renders nested children with indentation", () => {
      const spans = [
        makeTraceSpan("cli", "Spotlight CLI", [
          makeTraceSpan("cli.setup", "Setup Spotlight", [
            makeTraceSpan("cli.setup.assets", "Setup Server Assets"),
          ]),
        ]),
      ];
      const result = formatSimpleSpanTree("trace-123", spans);
      const lines = result.map(stripAnsi);

      // Check that all spans are present
      const output = lines.join("\n");
      expect(output).toContain("cli — Spotlight CLI");
      expect(output).toContain("cli.setup — Setup Spotlight");
      expect(output).toContain("cli.setup.assets — Setup Server Assets");

      // Check indentation increases for nested children
      const cliLine = lines.find((l) => l.includes("Spotlight CLI"));
      const setupLine = lines.find((l) => l.includes("Setup Spotlight"));
      const assetsLine = lines.find((l) => l.includes("Setup Server Assets"));

      expect(cliLine).toBeDefined();
      expect(setupLine).toBeDefined();
      expect(assetsLine).toBeDefined();

      // Nested lines should have more leading whitespace
      const cliIndent = cliLine?.match(/^\s*/)?.[0].length ?? 0;
      const setupIndent = setupLine?.match(/^\s*/)?.[0].length ?? 0;
      const assetsIndent = assetsLine?.match(/^\s*/)?.[0].length ?? 0;

      expect(setupIndent).toBeGreaterThan(cliIndent);
      expect(assetsIndent).toBeGreaterThan(setupIndent);
    });

    test("handles multiple root spans", () => {
      const spans = [
        makeTraceSpan("http.server", "POST /api"),
        makeTraceSpan("db.query", "SELECT *"),
      ];
      const result = formatSimpleSpanTree("trace-123", spans);
      const output = stripAnsi(result.join("\n"));

      expect(output).toContain("http.server — POST /api");
      expect(output).toContain("db.query — SELECT *");
    });

    test("handles deeply nested spans (3+ levels)", () => {
      const spans = [
        makeTraceSpan("level1", "First", [
          makeTraceSpan("level2", "Second", [
            makeTraceSpan("level3", "Third", [
              makeTraceSpan("level4", "Fourth"),
            ]),
          ]),
        ]),
      ];
      const result = formatSimpleSpanTree("trace-123", spans);
      const output = stripAnsi(result.join("\n"));

      expect(output).toContain("level1 — First");
      expect(output).toContain("level2 — Second");
      expect(output).toContain("level3 — Third");
      expect(output).toContain("level4 — Fourth");
    });
  });

  describe("depth limiting", () => {
    test("respects maxDepth parameter", () => {
      const spans = [
        makeTraceSpan("level1", "First", [
          makeTraceSpan("level2", "Second", [makeTraceSpan("level3", "Third")]),
        ]),
      ];
      const result = formatSimpleSpanTree("trace-123", spans, 2);
      const output = stripAnsi(result.join("\n"));

      // Should show level 1 and 2, but not level 3
      expect(output).toContain("level1 — First");
      expect(output).toContain("level2 — Second");
      expect(output).not.toContain("level3 — Third");
    });

    test("maxDepth 0 shows unlimited depth", () => {
      const spans = [
        makeTraceSpan("level1", "First", [
          makeTraceSpan("level2", "Second", [makeTraceSpan("level3", "Third")]),
        ]),
      ];
      const result = formatSimpleSpanTree("trace-123", spans, 0);
      const output = stripAnsi(result.join("\n"));

      expect(output).toContain("level1 — First");
      expect(output).toContain("level2 — Second");
      expect(output).toContain("level3 — Third");
    });
  });

  describe("tree branch characters", () => {
    test("uses tree branch characters", () => {
      const spans = [
        makeTraceSpan("root", "Root Span", [
          makeTraceSpan("child1", "First Child"),
          makeTraceSpan("child2", "Second Child"),
        ]),
      ];
      const result = formatSimpleSpanTree("trace-123", spans);
      const output = result.join("\n");

      // Should use tree branch characters
      expect(output).toContain("└─");
      expect(output).toContain("├─");
    });
  });

  describe("section header", () => {
    test("includes Span Tree section divider", () => {
      const spans = [makeTraceSpan("http.server", "GET /api")];
      const result = formatSimpleSpanTree("trace-123", spans);
      const output = stripAnsi(result.join("\n"));
      expect(output).toContain("─── Span Tree ───");
    });
  });
});
