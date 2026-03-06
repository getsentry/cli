/**
 * Property-Based Tests for TraceLogSchema
 *
 * Verifies that `TraceLogSchema` (and related log schemas) correctly
 * coerce string-typed numeric fields and accept optional fields,
 * guarding against API response format variations (CLI-BH).
 */

import { describe, expect, test } from "bun:test";
import {
  assert as fcAssert,
  nat,
  oneof,
  option,
  property,
  string,
} from "fast-check";
import {
  DetailedSentryLogSchema,
  SentryLogSchema,
  TraceLogSchema,
  TraceLogsResponseSchema,
} from "../../src/types/sentry.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

/**
 * Arbitrary that produces a value as either a number or its string
 * representation — simulating APIs that may return numeric fields
 * as strings (especially for large nanosecond timestamps).
 */
function numberOrString(arb = nat()) {
  return oneof(arb, arb.map(String));
}

/**
 * Pick a random representation for a numeric field:
 * number, string, or undefined (omitted).
 */
function randomNumericField(value: number): number | string | undefined {
  const r = Math.random();
  if (r < 0.3) return;
  if (r < 0.65) return value;
  return String(value);
}

/** Arbitrary for a valid trace-log entry with mixed number/string numeric fields */
const traceLogEntryArb = nat().chain((projectId) =>
  nat().chain((sevNum) =>
    nat().chain((tsPrecise) =>
      option(string(), { nil: undefined }).map((msg) => ({
        id: "test-log-id",
        "project.id": Math.random() > 0.5 ? projectId : String(projectId),
        trace: "aaaa1111bbbb2222cccc3333dddd4444",
        severity_number: randomNumericField(sevNum),
        severity: "info",
        timestamp: "2025-01-30T14:32:15+00:00",
        timestamp_precise: randomNumericField(tsPrecise),
        message: msg ?? null,
      }))
    )
  )
);

describe("property: TraceLogSchema coercion", () => {
  test("always parses successfully with number or string numeric fields", () => {
    fcAssert(
      property(traceLogEntryArb, (entry) => {
        const result = TraceLogSchema.safeParse(entry);
        expect(result.success).toBe(true);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("coerced output has number types for numeric fields (when present)", () => {
    fcAssert(
      property(traceLogEntryArb, (entry) => {
        const result = TraceLogSchema.safeParse(entry);
        if (!result.success) return;

        expect(typeof result.data["project.id"]).toBe("number");

        if (result.data.severity_number !== undefined) {
          expect(typeof result.data.severity_number).toBe("number");
        }
        if (result.data.timestamp_precise !== undefined) {
          expect(typeof result.data.timestamp_precise).toBe("number");
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("preserves passthrough fields", () => {
    const entry = {
      id: "test",
      "project.id": 1,
      trace: "aaaa1111bbbb2222cccc3333dddd4444",
      severity: "info",
      timestamp: "2025-01-30T14:32:15+00:00",
      extra_field: "should be preserved",
    };
    const result = TraceLogSchema.safeParse(entry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).extra_field).toBe(
        "should be preserved"
      );
    }
  });
});

describe("property: TraceLogsResponseSchema", () => {
  test("accepts response with mixed string/number fields in data array", () => {
    fcAssert(
      property(traceLogEntryArb, (entry) => {
        const response = { data: [entry] };
        const result = TraceLogsResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("accepts response with empty data array", () => {
    const result = TraceLogsResponseSchema.safeParse({ data: [] });
    expect(result.success).toBe(true);
  });

  test("accepts response with optional meta", () => {
    const result = TraceLogsResponseSchema.safeParse({
      data: [],
      meta: { fields: { id: "string" }, units: {} },
    });
    expect(result.success).toBe(true);
  });
});

describe("property: SentryLogSchema coercion", () => {
  test("coerces string timestamp_precise to number", () => {
    fcAssert(
      property(numberOrString(), (tsPrecise) => {
        const entry = {
          "sentry.item_id": "test-id",
          timestamp: "2025-01-30T14:32:15+00:00",
          timestamp_precise: tsPrecise,
        };
        const result = SentryLogSchema.safeParse(entry);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(typeof result.data.timestamp_precise).toBe("number");
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: DetailedSentryLogSchema coercion", () => {
  test("coerces string timestamp_precise to number", () => {
    fcAssert(
      property(numberOrString(), (tsPrecise) => {
        const entry = {
          "sentry.item_id": "test-id",
          timestamp: "2025-01-30T14:32:15+00:00",
          timestamp_precise: tsPrecise,
        };
        const result = DetailedSentryLogSchema.safeParse(entry);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(typeof result.data.timestamp_precise).toBe("number");
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
