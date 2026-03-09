/**
 * Property-Based Tests for Trace View Command
 *
 * Uses fast-check to verify invariants of parsePositionalArgs()
 * that should hold for any valid input.
 */

import { describe, expect, test } from "bun:test";
import {
  array,
  assert as fcAssert,
  property,
  string,
  stringMatching,
  tuple,
} from "fast-check";
import { parsePositionalArgs } from "../../../src/commands/trace/view.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

/** Valid trace IDs (32-char hex) */
const traceIdArb = stringMatching(/^[a-f0-9]{32}$/);

/** Valid org/project slugs */
const slugArb = stringMatching(/^[a-z][a-z0-9-]{1,20}[a-z0-9]$/);

/** Non-empty strings for general args */
const nonEmptyStringArb = string({ minLength: 1, maxLength: 50 });

/**
 * Insert dashes at UUID positions (8-4-4-4-12) into a 32-char hex string.
 */
function toUuidFormat(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe("parsePositionalArgs properties", () => {
  test("single valid trace ID: returns it as traceId with undefined targetArg", async () => {
    await fcAssert(
      property(traceIdArb, (input) => {
        const result = parsePositionalArgs([input]);
        expect(result.traceId).toBe(input);
        expect(result.targetArg).toBeUndefined();
        expect(result.warning).toBeUndefined();
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("single arg org/project/traceId: splits into target and traceId", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, traceIdArb),
        ([org, project, traceId]) => {
          const combined = `${org}/${project}/${traceId}`;
          const result = parsePositionalArgs([combined]);
          expect(result.targetArg).toBe(`${org}/${project}`);
          expect(result.traceId).toBe(traceId);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("single arg with one slash: throws ContextError (missing trace ID)", async () => {
    await fcAssert(
      property(tuple(slugArb, slugArb), ([org, project]) => {
        expect(() => parsePositionalArgs([`${org}/${project}`])).toThrow(
          ContextError
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("two args with valid trace ID: first is targetArg, second is traceId", async () => {
    await fcAssert(
      property(tuple(nonEmptyStringArb, traceIdArb), ([first, traceId]) => {
        const result = parsePositionalArgs([first, traceId]);
        expect(result.targetArg).toBe(first);
        expect(result.traceId).toBe(traceId);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("org/project target format: correctly splits target and traceId", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, traceIdArb),
        ([org, project, traceId]) => {
          const target = `${org}/${project}`;
          const result = parsePositionalArgs([target, traceId]);

          expect(result.targetArg).toBe(target);
          expect(result.traceId).toBe(traceId);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("extra args are ignored: only first two matter", async () => {
    await fcAssert(
      property(
        tuple(
          nonEmptyStringArb,
          traceIdArb,
          array(nonEmptyStringArb, { minLength: 1, maxLength: 5 })
        ),
        ([first, traceId, extras]) => {
          const args = [first, traceId, ...extras];
          const result = parsePositionalArgs(args);

          expect(result.targetArg).toBe(first);
          expect(result.traceId).toBe(traceId);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("parsing is deterministic: same input always produces same output", async () => {
    await fcAssert(
      property(tuple(slugArb, traceIdArb), ([target, traceId]) => {
        const args = [target, traceId];
        const result1 = parsePositionalArgs(args);
        const result2 = parsePositionalArgs(args);
        expect(result1).toEqual(result2);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("empty args always throws ContextError", () => {
    expect(() => parsePositionalArgs([])).toThrow(ContextError);
  });

  test("result always has traceId property defined (valid inputs)", async () => {
    await fcAssert(
      property(traceIdArb, (traceId) => {
        const result = parsePositionalArgs([traceId]);
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
        const result = parsePositionalArgs([uuid]);
        expect(result.traceId).toBe(hex);
        expect(result.warning).toContain("Auto-corrected");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("UUID-format trace IDs work in two-arg case", async () => {
    await fcAssert(
      property(tuple(slugArb, traceIdArb), ([target, hex]) => {
        const uuid = toUuidFormat(hex);
        const result = parsePositionalArgs([target, uuid]);
        expect(result.traceId).toBe(hex);
        expect(result.targetArg).toBe(target);
        expect(result.warning).toContain("Auto-corrected");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("invalid trace IDs always throw ValidationError", async () => {
    const invalidIdArb = stringMatching(/^[g-z]{10,20}$/);
    await fcAssert(
      property(invalidIdArb, (badId) => {
        expect(() => parsePositionalArgs([badId])).toThrow(ValidationError);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
