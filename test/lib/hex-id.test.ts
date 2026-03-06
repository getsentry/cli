/**
 * Hex ID Validation Tests
 *
 * Property-based and unit tests for the shared hex ID validation
 * in src/lib/hex-id.ts.
 */

import { describe, expect, test } from "bun:test";
import { array, constantFrom, assert as fcAssert, property } from "fast-check";
import { ValidationError } from "../../src/lib/errors.js";
import { HEX_ID_RE, validateHexId } from "../../src/lib/hex-id.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

const HEX_CHARS = "0123456789abcdefABCDEF".split("");
const VALID_ID = "aaaa1111bbbb2222cccc3333dddd4444";

/** Arbitrary for valid 32-char hex strings */
const validIdArb = array(constantFrom(...HEX_CHARS), {
  minLength: 32,
  maxLength: 32,
}).map((chars) => chars.join(""));

describe("HEX_ID_RE", () => {
  test("matches a valid 32-char lowercase hex string", () => {
    expect(HEX_ID_RE.test("aaaa1111bbbb2222cccc3333dddd4444")).toBe(true);
  });

  test("matches a valid 32-char uppercase hex string", () => {
    expect(HEX_ID_RE.test("AAAA1111BBBB2222CCCC3333DDDD4444")).toBe(true);
  });

  test("matches mixed-case hex", () => {
    expect(HEX_ID_RE.test("AaAa1111BbBb2222CcCc3333DdDd4444")).toBe(true);
  });

  test("rejects shorter strings", () => {
    expect(HEX_ID_RE.test("abc123")).toBe(false);
  });

  test("rejects longer strings", () => {
    expect(HEX_ID_RE.test(`${VALID_ID}extra`)).toBe(false);
  });

  test("rejects non-hex characters", () => {
    expect(HEX_ID_RE.test("gggg1111bbbb2222cccc3333dddd4444")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(HEX_ID_RE.test("")).toBe(false);
  });

  test("rejects strings with whitespace", () => {
    expect(HEX_ID_RE.test(" aaaa1111bbbb2222cccc3333dddd4444")).toBe(false);
    expect(HEX_ID_RE.test("aaaa1111bbbb2222cccc3333dddd4444 ")).toBe(false);
  });

  test("rejects strings with newlines", () => {
    expect(HEX_ID_RE.test("aaaa1111bbbb2222cccc3333dddd4444\n")).toBe(false);
  });
});

describe("validateHexId", () => {
  test("returns the ID for valid input", () => {
    expect(validateHexId(VALID_ID, "test ID")).toBe(VALID_ID);
  });

  test("trims leading and trailing whitespace", () => {
    expect(validateHexId(`  ${VALID_ID}  `, "test ID")).toBe(VALID_ID);
  });

  test("trims trailing newline", () => {
    expect(validateHexId(`${VALID_ID}\n`, "test ID")).toBe(VALID_ID);
  });

  test("returns the same string (no case normalization)", () => {
    const mixedCase = "AAAA1111bbbb2222CCCC3333dddd4444";
    expect(validateHexId(mixedCase, "test ID")).toBe(mixedCase);
  });

  test("throws ValidationError for empty string", () => {
    expect(() => validateHexId("", "test ID")).toThrow(ValidationError);
  });

  test("throws ValidationError for short hex", () => {
    expect(() => validateHexId("abc123", "test ID")).toThrow(ValidationError);
  });

  test("throws ValidationError for non-hex chars", () => {
    expect(() =>
      validateHexId("zzzz1111bbbb2222cccc3333dddd4444", "test ID")
    ).toThrow(ValidationError);
  });

  test("throws ValidationError for 33-char hex", () => {
    expect(() => validateHexId(`${VALID_ID}a`, "test ID")).toThrow(
      ValidationError
    );
  });

  test("error message includes the label", () => {
    try {
      validateHexId("bad", "log ID");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("log ID");
    }
  });

  test("error message includes the invalid value", () => {
    try {
      validateHexId("bad-id", "test ID");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("bad-id");
    }
  });

  test("error message truncates long invalid values", () => {
    const longId = "a".repeat(100);
    try {
      validateHexId(longId, "test ID");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const msg = (error as ValidationError).message;
      expect(msg).toContain("...");
      // Should not contain the full 100-char string
      expect(msg).not.toContain(longId);
    }
  });

  test("error message includes format hint", () => {
    try {
      validateHexId("short", "test ID");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain(
        "32-character hexadecimal"
      );
    }
  });

  test("throws for newline-separated IDs (not a single valid ID)", () => {
    const multiLine = `${VALID_ID}\n${"bbbb1111cccc2222dddd3333eeee4444"}`;
    expect(() => validateHexId(multiLine, "test ID")).toThrow(ValidationError);
  });
});

describe("property: validateHexId", () => {
  test("accepts any 32-char hex string", () => {
    fcAssert(
      property(validIdArb, (id) => {
        expect(validateHexId(id, "test ID")).toBe(id);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("is idempotent — validating twice returns the same value", () => {
    fcAssert(
      property(validIdArb, (id) => {
        const first = validateHexId(id, "test ID");
        const second = validateHexId(first, "test ID");
        expect(second).toBe(first);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("accepts whitespace-padded valid IDs after trim", () => {
    fcAssert(
      property(validIdArb, (id) => {
        expect(validateHexId(`  ${id}  `, "test ID")).toBe(id);
        expect(validateHexId(`\t${id}\n`, "test ID")).toBe(id);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  /** Arbitrary for hex strings that are NOT exactly 32 chars */
  const wrongLengthHexArb = array(constantFrom(...HEX_CHARS), {
    minLength: 0,
    maxLength: 64,
  })
    .filter((chars) => chars.length !== 32)
    .map((chars) => chars.join(""));

  test("rejects hex strings with wrong length", () => {
    fcAssert(
      property(wrongLengthHexArb, (id) => {
        expect(() => validateHexId(id, "test ID")).toThrow(ValidationError);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
