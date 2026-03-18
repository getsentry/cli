/**
 * Property-Based Tests for Trace Target Parsing
 *
 * Uses fast-check to verify invariants of parseTraceTarget()
 * that should hold for any valid input. These tests cover the
 * shared abstraction used by trace view, span list, span view,
 * and trace logs.
 */

import { describe, expect, test } from "bun:test";
import {
  assert as fcAssert,
  property,
  stringMatching,
  tuple,
} from "fast-check";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
import { parseTraceTarget } from "../../../src/lib/trace-target.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

/** Valid trace IDs (32-char hex) */
const traceIdArb = stringMatching(/^[a-f0-9]{32}$/);

/** Valid org/project slugs (no xn-- punycode prefix) */
const slugArb = stringMatching(/^[a-z][a-z0-9-]{1,20}[a-z0-9]$/).filter(
  (s) => !s.startsWith("xn--")
);

const HINT = "sentry trace view [<org>/<project>/]<trace-id>";

/**
 * Insert dashes at UUID positions (8-4-4-4-12) into a 32-char hex string.
 */
function toUuidFormat(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe("parseTraceTarget properties", () => {
  test("single valid trace ID: returns auto-detect with correct traceId", async () => {
    await fcAssert(
      property(traceIdArb, (input) => {
        const result = parseTraceTarget([input], HINT);
        expect(result.type).toBe("auto-detect");
        expect(result.traceId).toBe(input);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("single arg org/project/traceId: returns explicit with correct fields", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, traceIdArb),
        ([org, project, traceId]) => {
          const combined = `${org}/${project}/${traceId}`;
          const result = parseTraceTarget([combined], HINT);
          expect(result.type).toBe("explicit");
          expect(result.traceId).toBe(traceId);
          if (result.type === "explicit") {
            expect(result.org).toBe(org);
            expect(result.project).toBe(project);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("single arg org/traceId: returns org-scoped", async () => {
    await fcAssert(
      property(tuple(slugArb, traceIdArb), ([org, traceId]) => {
        const combined = `${org}/${traceId}`;
        const result = parseTraceTarget([combined], HINT);
        expect(result.type).toBe("org-scoped");
        expect(result.traceId).toBe(traceId);
        if (result.type === "org-scoped") {
          expect(result.org).toBe(org);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("two args: target + trace-id uses second arg as trace ID", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, traceIdArb),
        ([org, project, traceId]) => {
          const target = `${org}/${project}`;
          const result = parseTraceTarget([target, traceId], HINT);
          expect(result.type).toBe("explicit");
          expect(result.traceId).toBe(traceId);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("parsing is deterministic", async () => {
    await fcAssert(
      property(tuple(slugArb, traceIdArb), ([target, traceId]) => {
        const args = [target, traceId];
        const result1 = parseTraceTarget(args, HINT);
        const result2 = parseTraceTarget(args, HINT);
        expect(result1).toEqual(result2);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("empty args always throws ContextError", () => {
    expect(() => parseTraceTarget([], HINT)).toThrow(ContextError);
  });

  test("result always has traceId property defined", async () => {
    await fcAssert(
      property(traceIdArb, (traceId) => {
        const result = parseTraceTarget([traceId], HINT);
        expect(result.traceId).toBeDefined();
        expect(typeof result.traceId).toBe("string");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("UUID-format trace IDs are accepted and produce 32-char hex", async () => {
    await fcAssert(
      property(traceIdArb, (hex) => {
        const uuid = toUuidFormat(hex);
        const result = parseTraceTarget([uuid], HINT);
        expect(result.traceId).toBe(hex);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("invalid trace IDs always throw ValidationError", async () => {
    const invalidIdArb = stringMatching(/^[g-z]{10,20}$/);
    await fcAssert(
      property(invalidIdArb, (badId) => {
        expect(() => parseTraceTarget([badId], HINT)).toThrow(ValidationError);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
