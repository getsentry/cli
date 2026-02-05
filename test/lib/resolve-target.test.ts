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

/** Characters valid in directory names */
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

  test("rejects dot-only names of any length", () => {
    // Test various lengths of dot-only strings
    const dotStrings = [".", "..", "...", "....", "....."];
    for (const dots of dotStrings) {
      expect(isValidDirNameForInference(dots)).toBe(false);
    }
  });

  test("accepts valid directory names (2+ chars)", () => {
    fcAssert(
      property(validDirNameArb, (name) => {
        // Valid names with 2+ chars should be accepted
        expect(isValidDirNameForInference(name)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test("accepts names starting with dot but having other chars", () => {
    fcAssert(
      property(validDirNameArb, (suffix) => {
        // .suffix should be valid if suffix has at least 1 char
        // and total length is >= 2
        const name = `.${suffix}`;
        expect(isValidDirNameForInference(name)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test("length property: names with length >= 2 are valid (unless all dots)", () => {
    fcAssert(
      property(validDirNameArb, (name) => {
        // If name has 2+ chars and isn't all dots, it's valid
        const isAllDots = /^\.+$/.test(name);
        if (!isAllDots && name.length >= 2) {
          expect(isValidDirNameForInference(name)).toBe(true);
        }
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

  test("hidden directories are valid", () => {
    expect(isValidDirNameForInference(".env")).toBe(true);
    expect(isValidDirNameForInference(".git")).toBe(true);
    expect(isValidDirNameForInference(".config")).toBe(true);
  });

  test("two-character names are the minimum", () => {
    expect(isValidDirNameForInference("ab")).toBe(true);
    expect(isValidDirNameForInference("a1")).toBe(true);
    expect(isValidDirNameForInference("--")).toBe(true);
  });
});
