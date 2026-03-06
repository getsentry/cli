/**
 * Trace ID Validation Tests
 *
 * Property-based and unit tests for the shared trace ID validation
 * in src/lib/trace-id.ts.
 */

import { describe, expect, test } from "bun:test";
import { array, constantFrom, assert as fcAssert, property } from "fast-check";
import { ValidationError } from "../../src/lib/errors.js";
import { TRACE_ID_RE, validateTraceId } from "../../src/lib/trace-id.js";

const HEX_CHARS = "0123456789abcdefABCDEF".split("");
const VALID_TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";

/** Arbitrary for valid 32-char hex strings */
const validTraceIdArb = array(constantFrom(...HEX_CHARS), {
  minLength: 32,
  maxLength: 32,
}).map((chars) => chars.join(""));

describe("TRACE_ID_RE", () => {
  test("matches a valid 32-char lowercase hex string", () => {
    expect(TRACE_ID_RE.test("aaaa1111bbbb2222cccc3333dddd4444")).toBe(true);
  });

  test("matches a valid 32-char uppercase hex string", () => {
    expect(TRACE_ID_RE.test("AAAA1111BBBB2222CCCC3333DDDD4444")).toBe(true);
  });

  test("matches mixed-case hex", () => {
    expect(TRACE_ID_RE.test("AaAa1111BbBb2222CcCc3333DdDd4444")).toBe(true);
  });

  test("rejects shorter strings", () => {
    expect(TRACE_ID_RE.test("abc123")).toBe(false);
  });

  test("rejects longer strings", () => {
    expect(TRACE_ID_RE.test(`${VALID_TRACE_ID}extra`)).toBe(false);
  });

  test("rejects non-hex characters", () => {
    expect(TRACE_ID_RE.test("gggg1111bbbb2222cccc3333dddd4444")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(TRACE_ID_RE.test("")).toBe(false);
  });
});

describe("validateTraceId", () => {
  test("returns the trace ID for valid input", () => {
    expect(validateTraceId(VALID_TRACE_ID)).toBe(VALID_TRACE_ID);
  });

  test("normalizes to lowercase", () => {
    const mixedCase = "AAAA1111bbbb2222CCCC3333dddd4444";
    expect(validateTraceId(mixedCase)).toBe("aaaa1111bbbb2222cccc3333dddd4444");
  });

  test("throws ValidationError for empty string", () => {
    expect(() => validateTraceId("")).toThrow(ValidationError);
  });

  test("throws ValidationError for short hex", () => {
    expect(() => validateTraceId("abc123")).toThrow(ValidationError);
  });

  test("throws ValidationError for non-hex chars", () => {
    expect(() => validateTraceId("zzzz1111bbbb2222cccc3333dddd4444")).toThrow(
      ValidationError
    );
  });

  test("throws ValidationError for 33-char hex", () => {
    expect(() => validateTraceId(`${VALID_TRACE_ID}a`)).toThrow(
      ValidationError
    );
  });

  test("error message includes the invalid trace ID", () => {
    try {
      validateTraceId("bad-id");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("bad-id");
    }
  });

  test("error message includes expected format hint", () => {
    try {
      validateTraceId("short");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain(
        "32-character hexadecimal"
      );
    }
  });

  test("error message does not hardcode a specific command", () => {
    try {
      validateTraceId("short");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const msg = (error as ValidationError).message;
      // Should not reference a specific command like "sentry trace logs" or "sentry log list"
      expect(msg).not.toContain("sentry trace logs");
      expect(msg).not.toContain("sentry log list");
    }
  });
});

describe("property: validateTraceId", () => {
  test("accepts any 32-char hex string and normalizes to lowercase", () => {
    fcAssert(
      property(validTraceIdArb, (id) => {
        expect(validateTraceId(id)).toBe(id.toLowerCase());
      }),
      { numRuns: 100 }
    );
  });

  test("is idempotent — validating twice returns the same value", () => {
    fcAssert(
      property(validTraceIdArb, (id) => {
        const first = validateTraceId(id);
        const second = validateTraceId(first);
        expect(second).toBe(first);
      }),
      { numRuns: 100 }
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
        expect(() => validateTraceId(id)).toThrow(ValidationError);
      }),
      { numRuns: 100 }
    );
  });

  /** Arbitrary for 32-char strings containing at least one non-hex character */
  const nonHexChars = "ghijklmnopqrstuvwxyz!@#$%^&*()-_ ";
  const mixedCharsArb = array(
    constantFrom(..."0123456789abcdef".split(""), ...nonHexChars.split("")),
    { minLength: 32, maxLength: 32 }
  )
    .filter((chars) => chars.some((c) => nonHexChars.includes(c)))
    .map((chars) => chars.join(""));

  test("rejects 32-char strings with non-hex characters", () => {
    fcAssert(
      property(mixedCharsArb, (id) => {
        expect(() => validateTraceId(id)).toThrow(ValidationError);
      }),
      { numRuns: 100 }
    );
  });
});
