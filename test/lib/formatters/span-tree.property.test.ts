/**
 * Property-Based Tests for Span Tree Formatting
 *
 * Uses fast-check to verify invariants of span tree formatting functions
 * that are difficult to exhaustively test with example-based tests.
 */

import { describe, expect, test } from "bun:test";
import {
  array,
  assert as fcAssert,
  integer,
  nat,
  property,
  record,
  stringMatching,
} from "fast-check";
import { formatSimpleSpanTree } from "../../../src/lib/formatters/human.js";
import type { TraceSpan } from "../../../src/types/index.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

/**
 * Strip ANSI escape codes from a string for content assertions.
 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// Arbitraries

/** Operation name (e.g., "http.server", "db.query") */
const opArb = stringMatching(/^[a-z][a-z0-9._-]{1,20}$/);

/** Span description */
const descriptionArb = stringMatching(/^[A-Za-z0-9 /_-]{1,50}$/);

/** Trace ID (hex string) */
const traceIdArb = stringMatching(/^[a-f0-9]{16,32}$/);

/** Simple span with no children */
const leafSpanArb = record({
  span_id: stringMatching(/^[a-f0-9]{8,16}$/),
  op: opArb,
  description: descriptionArb,
  start_timestamp: integer({ min: 1000, max: 2000 }).map((n) => n + 0.123),
  timestamp: integer({ min: 2001, max: 3000 }).map((n) => n + 0.456),
}) as unknown as typeof record<TraceSpan>;

/**
 * Generate a span tree with controlled depth.
 * Returns an array of root spans, each potentially having children.
 */
function generateSpanTree(maxDepth: number): typeof array<TraceSpan> {
  if (maxDepth <= 0) {
    return leafSpanArb.map((span) => ({ ...span, children: [] }));
  }

  return record({
    span_id: stringMatching(/^[a-f0-9]{8,16}$/),
    op: opArb,
    description: descriptionArb,
    start_timestamp: integer({ min: 1000, max: 2000 }).map((n) => n + 0.123),
    timestamp: integer({ min: 2001, max: 3000 }).map((n) => n + 0.456),
    children: array(generateSpanTree(maxDepth - 1), { maxLength: 3 }),
  }) as unknown as typeof array<TraceSpan>;
}

/** Array of spans with nested children (depth 1-3) */
const spanTreeArb = array(
  generateSpanTree(2) as unknown as typeof leafSpanArb,
  {
    minLength: 1,
    maxLength: 5,
  }
);

/** Array of leaf spans (no children) */
const flatSpansArb = array(
  leafSpanArb.map((span) => ({
    ...span,
    children: [],
  })) as unknown as typeof leafSpanArb,
  { minLength: 1, maxLength: 10 }
);

describe("formatSimpleSpanTree properties", () => {
  test("output always contains trace ID when spans exist", async () => {
    await fcAssert(
      property(traceIdArb, flatSpansArb, (traceId, spans) => {
        const result = formatSimpleSpanTree(traceId, spans as TraceSpan[]);
        const output = stripAnsi(result.join("\n"));
        expect(output).toContain(traceId);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output always contains 'Trace —' header when spans exist", async () => {
    await fcAssert(
      property(traceIdArb, flatSpansArb, (traceId, spans) => {
        const result = formatSimpleSpanTree(traceId, spans as TraceSpan[]);
        const output = stripAnsi(result.join("\n"));
        expect(output).toContain("Trace —");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output contains all span ops", async () => {
    await fcAssert(
      property(traceIdArb, flatSpansArb, (traceId, spans) => {
        const result = formatSimpleSpanTree(traceId, spans as TraceSpan[]);
        const output = stripAnsi(result.join("\n"));
        for (const span of spans as TraceSpan[]) {
          if (span.op) {
            expect(output).toContain(span.op);
          }
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output contains all span descriptions", async () => {
    await fcAssert(
      property(traceIdArb, flatSpansArb, (traceId, spans) => {
        const result = formatSimpleSpanTree(traceId, spans as TraceSpan[]);
        const output = stripAnsi(result.join("\n"));
        for (const span of spans as TraceSpan[]) {
          if (span.description) {
            expect(output).toContain(span.description);
          }
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output never contains duration patterns (ms or s)", async () => {
    await fcAssert(
      property(traceIdArb, flatSpansArb, (traceId, spans) => {
        const result = formatSimpleSpanTree(traceId, spans as TraceSpan[]);
        const output = stripAnsi(result.join("\n"));
        // Simple format should not show durations
        expect(output).not.toMatch(/\d+ms/);
        expect(output).not.toMatch(/\d+\.\d+s/);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("deterministic: same input produces same output", async () => {
    await fcAssert(
      property(traceIdArb, flatSpansArb, (traceId, spans) => {
        const result1 = formatSimpleSpanTree(traceId, spans as TraceSpan[]);
        const result2 = formatSimpleSpanTree(traceId, spans as TraceSpan[]);
        expect(result1).toEqual(result2);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output line count increases with span count", async () => {
    await fcAssert(
      property(traceIdArb, flatSpansArb, (traceId, spans) => {
        const result = formatSimpleSpanTree(traceId, spans as TraceSpan[]);
        // At minimum: header line + one line per span
        expect(result.length).toBeGreaterThanOrEqual(
          (spans as TraceSpan[]).length
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("uses tree branch characters for multiple spans", async () => {
    await fcAssert(
      property(
        traceIdArb,
        array(
          leafSpanArb.map((span) => ({
            ...span,
            children: [],
          })) as unknown as typeof leafSpanArb,
          { minLength: 2, maxLength: 5 }
        ),
        (traceId, spans) => {
          const result = formatSimpleSpanTree(traceId, spans as TraceSpan[]);
          const output = result.join("\n");
          // With multiple spans, should have both branch types
          expect(output).toContain("├─");
          expect(output).toContain("└─");
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("formatSimpleSpanTree depth limiting properties", () => {
  test("maxDepth 1 produces correct line count for root spans only", async () => {
    await fcAssert(
      property(traceIdArb, spanTreeArb, (traceId, spans) => {
        const result = formatSimpleSpanTree(traceId, spans as TraceSpan[], 1);

        // With maxDepth 1, we should only see root spans
        // Expected: header lines + 1 line per root span
        // Note: formatSimpleSpanTree adds header (section + trace ID) = ~3-4 lines
        // Then 1 line per root span at depth 1
        const rootSpanCount = (spans as TraceSpan[]).length;
        // At minimum, should not exceed header + root spans (no children)
        // Header is typically 3 lines, plus 1 per root span
        const maxExpectedLines = 4 + rootSpanCount;
        expect(result.length).toBeLessThanOrEqual(maxExpectedLines);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("depth limiting never shows more lines than unlimited", async () => {
    await fcAssert(
      property(
        traceIdArb,
        spanTreeArb,
        nat({ max: 10 }),
        (traceId, spans, depth) => {
          const limited = formatSimpleSpanTree(
            traceId,
            spans as TraceSpan[],
            depth
          );
          const unlimited = formatSimpleSpanTree(
            traceId,
            spans as TraceSpan[],
            Number.POSITIVE_INFINITY
          );

          // Limited depth should never show more than unlimited
          expect(limited.length).toBeLessThanOrEqual(unlimited.length);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("Infinity depth shows all spans", async () => {
    await fcAssert(
      property(traceIdArb, spanTreeArb, (traceId, spans) => {
        const result = formatSimpleSpanTree(
          traceId,
          spans as TraceSpan[],
          Number.POSITIVE_INFINITY
        );

        // Count total spans recursively
        function countSpans(spanList: TraceSpan[]): number {
          let count = spanList.length;
          for (const span of spanList) {
            count += countSpans(span.children ?? []);
          }
          return count;
        }

        const totalSpans = countSpans(spans as TraceSpan[]);
        // Output should have at least one line per span (plus header)
        expect(result.length).toBeGreaterThanOrEqual(totalSpans);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("formatSimpleSpanTree empty input", () => {
  test("empty spans array returns message about no data", async () => {
    await fcAssert(
      property(traceIdArb, (traceId) => {
        const result = formatSimpleSpanTree(traceId, []);
        const output = stripAnsi(result.join("\n"));
        expect(output).toContain("No span data");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("empty spans produces single 'no data' message", async () => {
    await fcAssert(
      property(traceIdArb, (traceId) => {
        const result = formatSimpleSpanTree(traceId, []);
        // Should have just the "no data" message
        expect(result.length).toBe(1);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
