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
  pre,
  property,
  string,
  stringMatching,
  tuple,
} from "fast-check";
import { parsePositionalArgs } from "../../../src/commands/trace/view.js";
import { ContextError } from "../../../src/lib/errors.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

/** Valid trace IDs (32-char hex) */
const traceIdArb = stringMatching(/^[a-f0-9]{32}$/);

/** Valid org/project slugs */
const slugArb = stringMatching(/^[a-z][a-z0-9-]{1,20}[a-z0-9]$/);

/** Non-empty strings for general args */
const nonEmptyStringArb = string({ minLength: 1, maxLength: 50 });

/** Non-empty strings without slashes (valid plain IDs) */
const plainIdArb = nonEmptyStringArb.filter((s) => !s.includes("/"));

describe("parsePositionalArgs properties", () => {
  test("single arg without slashes: returns it as traceId with undefined targetArg", async () => {
    await fcAssert(
      property(plainIdArb, (input) => {
        const result = parsePositionalArgs([input]);
        expect(result.traceId).toBe(input);
        expect(result.targetArg).toBeUndefined();
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

  test("two args: first is always targetArg, second is always traceId", async () => {
    await fcAssert(
      property(
        tuple(nonEmptyStringArb, nonEmptyStringArb),
        ([first, second]) => {
          const result = parsePositionalArgs([first, second]);
          expect(result.targetArg).toBe(first);
          expect(result.traceId).toBe(second);
        }
      ),
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
          nonEmptyStringArb,
          array(nonEmptyStringArb, { minLength: 1, maxLength: 5 })
        ),
        ([first, second, extras]) => {
          const args = [first, second, ...extras];
          const result = parsePositionalArgs(args);

          expect(result.targetArg).toBe(first);
          expect(result.traceId).toBe(second);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("parsing is deterministic: same input always produces same output", async () => {
    await fcAssert(
      property(
        array(nonEmptyStringArb, { minLength: 1, maxLength: 3 }),
        (args) => {
          // Skip single-arg with slashes — those throw ContextError (tested separately)
          pre(args.length > 1 || !args[0]?.includes("/"));

          const result1 = parsePositionalArgs(args);
          const result2 = parsePositionalArgs(args);
          expect(result1).toEqual(result2);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("empty args always throws ContextError", () => {
    expect(() => parsePositionalArgs([])).toThrow(ContextError);
  });

  test("result always has traceId property defined", async () => {
    await fcAssert(
      property(
        array(nonEmptyStringArb, { minLength: 1, maxLength: 3 }),
        (args) => {
          // Skip single-arg with slashes — those throw ContextError (tested separately)
          pre(args.length > 1 || !args[0]?.includes("/"));

          const result = parsePositionalArgs(args);
          expect(result.traceId).toBeDefined();
          expect(typeof result.traceId).toBe("string");
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
