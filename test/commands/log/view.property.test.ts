/**
 * Property-Based Tests for Log View Command
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
import { parsePositionalArgs } from "../../../src/commands/log/view.js";
import { ContextError } from "../../../src/lib/errors.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

/** Valid log IDs (32-char hex) */
const logIdArb = stringMatching(/^[a-f0-9]{32}$/);

/** Valid org/project slugs */
const slugArb = stringMatching(/^[a-z][a-z0-9-]{1,20}[a-z0-9]$/);

/** Non-empty strings for general args */
const nonEmptyStringArb = string({ minLength: 1, maxLength: 50 });

/** Non-empty strings without slashes (valid plain IDs) */
const plainIdArb = nonEmptyStringArb.filter((s) => !s.includes("/"));

describe("parsePositionalArgs properties", () => {
  test("single arg without slashes: returns it as logId with undefined targetArg", async () => {
    await fcAssert(
      property(plainIdArb, (input) => {
        const result = parsePositionalArgs([input]);
        expect(result.logId).toBe(input);
        expect(result.targetArg).toBeUndefined();
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("single arg org/project/logId: splits into target and logId", async () => {
    await fcAssert(
      property(tuple(slugArb, slugArb, logIdArb), ([org, project, logId]) => {
        const combined = `${org}/${project}/${logId}`;
        const result = parsePositionalArgs([combined]);
        expect(result.targetArg).toBe(`${org}/${project}`);
        expect(result.logId).toBe(logId);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("single arg with one slash: throws ContextError (missing log ID)", async () => {
    await fcAssert(
      property(tuple(slugArb, slugArb), ([org, project]) => {
        expect(() => parsePositionalArgs([`${org}/${project}`])).toThrow(
          ContextError
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("two args: first is always targetArg, second is always logId", async () => {
    await fcAssert(
      property(
        tuple(nonEmptyStringArb, nonEmptyStringArb),
        ([first, second]) => {
          const result = parsePositionalArgs([first, second]);
          expect(result.targetArg).toBe(first);
          expect(result.logId).toBe(second);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("org/project target format: correctly splits target and logId", async () => {
    await fcAssert(
      property(tuple(slugArb, slugArb, logIdArb), ([org, project, logId]) => {
        const target = `${org}/${project}`;
        const result = parsePositionalArgs([target, logId]);

        expect(result.targetArg).toBe(target);
        expect(result.logId).toBe(logId);
      }),
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
          expect(result.logId).toBe(second);
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

  test("result always has logId property defined", async () => {
    await fcAssert(
      property(
        array(nonEmptyStringArb, { minLength: 1, maxLength: 3 }),
        (args) => {
          // Skip single-arg with slashes — those throw ContextError (tested separately)
          pre(args.length > 1 || !args[0]?.includes("/"));

          const result = parsePositionalArgs(args);
          expect(result.logId).toBeDefined();
          expect(typeof result.logId).toBe("string");
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("result targetArg is undefined for single slash-free arg, defined for multiple", async () => {
    // Single arg case (without slashes)
    await fcAssert(
      property(plainIdArb, (input) => {
        const result = parsePositionalArgs([input]);
        expect(result.targetArg).toBeUndefined();
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );

    // Two+ args case
    await fcAssert(
      property(
        array(nonEmptyStringArb, { minLength: 2, maxLength: 4 }),
        (args) => {
          const result = parsePositionalArgs(args);
          expect(result.targetArg).toBeDefined();
          expect(typeof result.targetArg).toBe("string");
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
