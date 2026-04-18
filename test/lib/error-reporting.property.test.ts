/**
 * Property-Based Tests for Error Reporting Helpers
 *
 * Verifies that `extractResourceKind` produces stable grouping keys
 * regardless of the user-supplied slug/id embedded in the resource string.
 */

import { describe, expect, test } from "bun:test";
import {
  array,
  constantFrom,
  assert as fcAssert,
  integer,
  property,
  stringMatching,
} from "fast-check";
import { extractResourceKind } from "../../src/lib/error-reporting.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

/** Lowercase alphanumeric slug with optional hyphens. */
const slugArb = array(
  constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
  { minLength: 1, maxLength: 25 }
)
  .map((chars) => chars.join(""))
  .filter((s) => !(s.startsWith("-") || s.endsWith("-")) && s.length > 0);

/** 32-character lowercase hex id (trace/event/log id). */
const hexIdArb = stringMatching(/^[0-9a-f]{32}$/).filter(
  (s) => s.length === 32
);

/** Arbitrary numeric id in the issue-id range (>= 6 digits). */
const numericIdArb = integer({ min: 100_000, max: 9_999_999_999 }).map(String);

describe("extractResourceKind — property tests", () => {
  test("single-quoted slug produces same kind for any slug", () => {
    fcAssert(
      property(slugArb, slugArb, (a, b) => {
        const ka = extractResourceKind(`Project '${a}'`);
        const kb = extractResourceKind(`Project '${b}'`);
        expect(ka).toBe(kb);
        expect(ka).toBe("Project");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("double-quoted slug produces same kind as single-quoted", () => {
    fcAssert(
      property(slugArb, (slug) => {
        expect(extractResourceKind(`Project '${slug}'`)).toBe(
          extractResourceKind(`Project "${slug}"`)
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("numeric-id stripping is slug-invariant", () => {
    fcAssert(
      property(numericIdArb, numericIdArb, (id1, id2) => {
        expect(extractResourceKind(`Issue ${id1} not found.`)).toBe(
          extractResourceKind(`Issue ${id2} not found.`)
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("hex-id stripping is slug-invariant", () => {
    fcAssert(
      property(hexIdArb, hexIdArb, (h1, h2) => {
        expect(extractResourceKind(`Trace ${h1} not found`)).toBe(
          extractResourceKind(`Trace ${h2} not found`)
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("idempotent on output", () => {
    fcAssert(
      property(slugArb, (slug) => {
        const once = extractResourceKind(`Project '${slug}' not found.`);
        expect(extractResourceKind(once)).toBe(once);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("not-found template is slug-invariant for org/project pair", () => {
    fcAssert(
      property(slugArb, slugArb, slugArb, slugArb, (o1, p1, o2, p2) => {
        expect(
          extractResourceKind(
            `Project '${p1}' not found in organization '${o1}'`
          )
        ).toBe(
          extractResourceKind(
            `Project '${p2}' not found in organization '${o2}'`
          )
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
