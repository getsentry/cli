/**
 * Property-Based Tests for resolve-target utilities
 *
 * Tests the directory name validation logic used for project inference.
 * Uses fast-check to verify properties that should always hold true.
 */

import { describe, expect, test } from "bun:test";
import { array, constantFrom, assert as fcAssert, property } from "fast-check";
import { isValidDirNameForInference } from "../../src/lib/resolve-target.js";

// Arbitraries

/** Characters valid in directory names (no leading dot) */
const dirNameChars = "abcdefghijklmnopqrstuvwxyz0123456789-_";

/** Generate valid directory names (2+ chars, alphanumeric with hyphens/underscores) */
const validDirNameArb = array(constantFrom(...dirNameChars.split("")), {
  minLength: 2,
  maxLength: 30,
}).map((chars) => chars.join(""));

/** Generate single characters */
const singleCharArb = constantFrom(...dirNameChars.split(""));

// Property tests

describe("property: isValidDirNameForInference", () => {
  test("rejects empty string", () => {
    expect(isValidDirNameForInference("")).toBe(false);
  });

  test("rejects single characters", () => {
    fcAssert(
      property(singleCharArb, (char) => {
        expect(isValidDirNameForInference(char)).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test("rejects names starting with dot (hidden directories)", () => {
    fcAssert(
      property(validDirNameArb, (suffix) => {
        // .anything should be rejected - hidden directories are not valid
        const name = `.${suffix}`;
        expect(isValidDirNameForInference(name)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test("accepts valid directory names (2+ chars, not starting with dot)", () => {
    fcAssert(
      property(validDirNameArb, (name) => {
        // Valid names with 2+ chars that don't start with dot should be accepted
        expect(isValidDirNameForInference(name)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// Example-based tests for edge cases and documentation

describe("isValidDirNameForInference edge cases", () => {
  test("real-world valid names", () => {
    expect(isValidDirNameForInference("cli")).toBe(true);
    expect(isValidDirNameForInference("my-project")).toBe(true);
    expect(isValidDirNameForInference("sentry-cli")).toBe(true);
    expect(isValidDirNameForInference("frontend")).toBe(true);
    expect(isValidDirNameForInference("my_app")).toBe(true);
  });

  test("hidden directories are rejected", () => {
    expect(isValidDirNameForInference(".env")).toBe(false);
    expect(isValidDirNameForInference(".git")).toBe(false);
    expect(isValidDirNameForInference(".config")).toBe(false);
    expect(isValidDirNameForInference(".")).toBe(false);
    expect(isValidDirNameForInference("..")).toBe(false);
  });

  test("two-character names are the minimum", () => {
    expect(isValidDirNameForInference("ab")).toBe(true);
    expect(isValidDirNameForInference("a1")).toBe(true);
    expect(isValidDirNameForInference("--")).toBe(true);
  });
});
