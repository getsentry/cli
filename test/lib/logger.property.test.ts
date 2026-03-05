/**
 * Property-Based Tests for Logger Module
 *
 * Uses fast-check to verify invariants that should hold for any valid input.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  constantFrom,
  assert as fcAssert,
  integer,
  property,
  string,
} from "fast-check";
import {
  LOG_LEVEL_NAMES,
  type LogLevelName,
  logger,
  parseLogLevel,
  setLogLevel,
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

describe("property: setLogLevel propagation", () => {
  let originalLevel: number;

  beforeEach(() => {
    originalLevel = logger.level;
  });

  afterEach(() => {
    setLogLevel(originalLevel);
  });

  test("any level set on parent propagates to withTag children", () => {
    fcAssert(
      property(integer({ min: 0, max: 5 }), (level) => {
        const child = logger.withTag("prop-test");
        setLogLevel(level);
        expect(logger.level).toBe(level);
        expect(child.level).toBe(level);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
