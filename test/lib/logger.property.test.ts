/**
 * Property-Based Tests for Logger Module
 *
 * Uses fast-check to verify invariants that should hold for any valid input.
 */

import { describe, expect, test } from "bun:test";
import {
  array,
  constant,
  constantFrom,
  assert as fcAssert,
  integer,
  oneof,
  property,
  string,
} from "fast-check";
import {
  extractLogLevelFromArgs,
  LOG_LEVEL_NAMES,
  type LogLevelName,
  parseLogLevel,
} from "../../src/lib/logger.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

// Arbitraries

/** Generate valid log level names */
const validLevelName = constantFrom(...LOG_LEVEL_NAMES);

/** Generate random non-level strings that shouldn't match any level */
const invalidLevelName = string().filter(
  (s) =>
    !LOG_LEVEL_NAMES.includes(s.toLowerCase().trim() as LogLevelName) &&
    s.length > 0
);

/** Generate a random CLI arg that is NOT --verbose or --log-level */
const nonLogArg = string().filter(
  (s) => s !== "--verbose" && s !== "--log-level" && s.length > 0
);

describe("property: parseLogLevel", () => {
  test("always returns a number between 0 and 5 for valid names", () => {
    fcAssert(
      property(validLevelName, (name) => {
        const level = parseLogLevel(name);
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(5);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("is case-insensitive for valid names", () => {
    fcAssert(
      property(validLevelName, (name) => {
        expect(parseLogLevel(name.toUpperCase())).toBe(parseLogLevel(name));
        expect(parseLogLevel(name.toLowerCase())).toBe(parseLogLevel(name));
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("returns default (3) for unrecognized strings", () => {
    fcAssert(
      property(invalidLevelName, (name) => {
        expect(parseLogLevel(name)).toBe(3);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("is idempotent via name lookup", () => {
    fcAssert(
      property(validLevelName, (name) => {
        const level1 = parseLogLevel(name);
        const level2 = parseLogLevel(name);
        expect(level1).toBe(level2);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("distinct valid names map to distinct levels", () => {
    // Each level name should map to a unique numeric value
    const levels = LOG_LEVEL_NAMES.map(parseLogLevel);
    const unique = new Set(levels);
    expect(unique.size).toBe(LOG_LEVEL_NAMES.length);
  });

  test("levels are strictly ordered: error < warn < info < debug < trace", () => {
    const ordered = ["error", "warn", "info", "debug", "trace"] as const;
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(parseLogLevel(ordered[i]!)).toBeLessThan(
        parseLogLevel(ordered[i + 1]!)
      );
    }
  });
});

describe("property: extractLogLevelFromArgs", () => {
  test("returns null and doesn't modify args with no log flags", () => {
    fcAssert(
      property(array(nonLogArg, { maxLength: 10 }), (args) => {
        const original = [...args];
        const result = extractLogLevelFromArgs(args);
        expect(result).toBeNull();
        expect(args).toEqual(original);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("--verbose always produces level 4 (debug) and stays in argv", () => {
    fcAssert(
      property(
        array(nonLogArg, { maxLength: 5 }),
        integer({ min: 0, max: 5 }),
        (otherArgs, insertIdx) => {
          const args = [...otherArgs];
          const pos = Math.min(insertIdx, args.length);
          args.splice(pos, 0, "--verbose");
          const original = [...args];

          const result = extractLogLevelFromArgs(args);
          expect(result).toBe(4);
          // --verbose is NOT consumed — commands like `api` have their own --verbose
          expect(args).toEqual(original);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("--log-level with valid name always produces correct level", () => {
    fcAssert(
      property(
        array(nonLogArg, { maxLength: 5 }),
        validLevelName,
        integer({ min: 0, max: 5 }),
        (otherArgs, levelName, insertIdx) => {
          const args = [...otherArgs];
          const pos = Math.min(insertIdx, args.length);
          args.splice(pos, 0, "--log-level", levelName);

          const result = extractLogLevelFromArgs(args);
          expect(result).toBe(parseLogLevel(levelName));
          expect(args).not.toContain("--log-level");
          expect(args).not.toContain(levelName);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("--log-level overrides --verbose", () => {
    fcAssert(
      property(validLevelName, (levelName) => {
        const args = ["--verbose", "--log-level", levelName, "cmd"];
        const result = extractLogLevelFromArgs(args);
        expect(result).toBe(parseLogLevel(levelName));
        // --log-level consumed, --verbose stays
        expect(args).toEqual(["--verbose", "cmd"]);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("--verbose preserves all args, --log-level removes exactly 2 elements", () => {
    fcAssert(
      property(
        array(nonLogArg, { minLength: 1, maxLength: 5 }),
        oneof(constant("verbose"), constant("log-level")),
        validLevelName,
        (otherArgs, flagType, levelName) => {
          const originalNonLogArgs = [...otherArgs];

          if (flagType === "verbose") {
            // --verbose is NOT consumed from argv
            const args = ["--verbose", ...otherArgs];
            extractLogLevelFromArgs(args);
            expect(args).toEqual(["--verbose", ...originalNonLogArgs]);
          } else {
            // --log-level + value ARE consumed from argv
            const args = ["--log-level", levelName, ...otherArgs];
            extractLogLevelFromArgs(args);
            expect(args).toEqual(originalNonLogArgs);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
