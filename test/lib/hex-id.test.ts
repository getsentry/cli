/**
 * Hex ID Validation Tests
 *
 * Property-based and unit tests for the shared hex ID validation
 * in src/lib/hex-id.ts.
 *
 * Regex patterns (HEX_ID_RE, UUID_DASH_RE) are covered by the property tests
 * at the bottom of this file which generate random valid/invalid hex strings.
 * The unit tests here focus on `validateHexId` behavior: error messages,
 * whitespace handling, UUID normalization, and edge cases.
 */

import { describe, expect, test } from "bun:test";
import { array, constantFrom, assert as fcAssert, property } from "fast-check";
import { ValidationError } from "../../src/lib/errors.js";
import { validateHexId, validateSpanId } from "../../src/lib/hex-id.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

const HEX_CHARS = "0123456789abcdefABCDEF".split("");
const VALID_ID = "aaaa1111bbbb2222cccc3333dddd4444";

/** Arbitrary for valid 32-char hex strings */
const validIdArb = array(constantFrom(...HEX_CHARS), {
  minLength: 32,
  maxLength: 32,
}).map((chars) => chars.join(""));

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

  test("normalizes to lowercase", () => {
    const mixedCase = "AAAA1111bbbb2222CCCC3333dddd4444";
    expect(validateHexId(mixedCase, "test ID")).toBe(
      "aaaa1111bbbb2222cccc3333dddd4444"
    );
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

  test("error hints span ID when 16-char hex is passed as trace ID", () => {
    try {
      validateHexId("a1b2c3d4e5f67890", "trace ID");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const msg = (error as ValidationError).message;
      expect(msg).toContain("trace ID");
      expect(msg).toContain("looks like a span ID");
      expect(msg).toContain("sentry span view");
    }
  });

  test("error hints non-hex input when slug is passed as trace ID", () => {
    try {
      validateHexId("my-project", "trace ID");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const msg = (error as ValidationError).message;
      expect(msg).toContain("doesn't look like a hex ID");
      expect(msg).toContain("project");
    }
  });

  test("no extra hint for random-length hex (not a span ID)", () => {
    try {
      validateHexId("abc123", "log ID");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const msg = (error as ValidationError).message;
      expect(msg).not.toContain("span ID");
      expect(msg).not.toContain("project");
    }
  });

  test("throws for newline-separated IDs (not a single valid ID)", () => {
    const multiLine = `${VALID_ID}\n${"bbbb1111cccc2222dddd3333eeee4444"}`;
    expect(() => validateHexId(multiLine, "test ID")).toThrow(ValidationError);
  });

  test("strips dashes from UUID format and returns 32-char hex", () => {
    expect(
      validateHexId("aaaa1111-bbbb-2222-cccc-3333dddd4444", "test ID")
    ).toBe(VALID_ID);
  });

  test("strips dashes from real user UUID (CLI-7Z)", () => {
    expect(
      validateHexId("ed29abc8-71c4-475b-9675-4655ef1a02d0", "test ID")
    ).toBe("ed29abc871c4475b96754655ef1a02d0");
  });

  test("strips dashes from uppercase UUID and normalizes to lowercase", () => {
    expect(
      validateHexId("AAAA1111-BBBB-2222-CCCC-3333DDDD4444", "test ID")
    ).toBe(VALID_ID);
  });

  test("strips dashes from UUID with whitespace padding", () => {
    expect(
      validateHexId("  aaaa1111-bbbb-2222-cccc-3333dddd4444  ", "test ID")
    ).toBe(VALID_ID);
  });

  test("UUID validation is idempotent — validated UUID validates again unchanged", () => {
    const first = validateHexId(
      "aaaa1111-bbbb-2222-cccc-3333dddd4444",
      "test ID"
    );
    const second = validateHexId(first, "test ID");
    expect(second).toBe(first);
  });

  test("rejects non-UUID dash patterns (random dashes)", () => {
    expect(() => validateHexId("abc-def", "test ID")).toThrow(ValidationError);
  });

  test("rejects dashes in wrong positions (not 8-4-4-4-12)", () => {
    expect(() =>
      validateHexId("aaaa-1111bbbb-2222cccc-3333dddd-4444", "test ID")
    ).toThrow(ValidationError);
  });
});

describe("validateSpanId", () => {
  test("returns the span ID for valid input", () => {
    expect(validateSpanId("a1b2c3d4e5f67890")).toBe("a1b2c3d4e5f67890");
  });

  test("normalizes to lowercase", () => {
    expect(validateSpanId("A1B2C3D4E5F67890")).toBe("a1b2c3d4e5f67890");
  });

  test("throws for 32-char hex with trace ID hint", () => {
    try {
      validateSpanId("aaaa1111bbbb2222cccc3333dddd4444");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const msg = (error as ValidationError).message;
      expect(msg).toContain("span ID");
      expect(msg).toContain("looks like a trace ID");
    }
  });

  test("throws for short hex without trace ID hint", () => {
    try {
      validateSpanId("abc123");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const msg = (error as ValidationError).message;
      expect(msg).toContain("span ID");
      expect(msg).not.toContain("trace ID");
    }
  });
});

describe("property: validateHexId", () => {
  test("accepts any 32-char hex string and normalizes to lowercase", () => {
    fcAssert(
      property(validIdArb, (id) => {
        expect(validateHexId(id, "test ID")).toBe(id.toLowerCase());
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
        const expected = id.toLowerCase();
        expect(validateHexId(`  ${id}  `, "test ID")).toBe(expected);
        expect(validateHexId(`\t${id}\n`, "test ID")).toBe(expected);
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

  /**
   * Insert dashes at UUID positions (8-4-4-4-12) into a 32-char hex string.
   */
  function toUuidFormat(hex: string): string {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  test("UUID format with dashes produces same result as plain hex", () => {
    fcAssert(
      property(validIdArb, (id) => {
        const expected = id.toLowerCase();
        const uuid = toUuidFormat(id);
        expect(validateHexId(uuid, "test ID")).toBe(expected);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("UUID validation round-trips: validateHexId(uuid) === validateHexId(plain)", () => {
    fcAssert(
      property(validIdArb, (id) => {
        const fromPlain = validateHexId(id, "test ID");
        const fromUuid = validateHexId(toUuidFormat(id), "test ID");
        expect(fromUuid).toBe(fromPlain);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
