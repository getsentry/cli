import { describe, expect, test } from "bun:test";
import { isAllDigits } from "../../src/lib/utils.js";

describe("isAllDigits", () => {
  test("returns true for digit-only strings", () => {
    expect(isAllDigits("123456")).toBe(true);
    expect(isAllDigits("0")).toBe(true);
    expect(isAllDigits("999999999")).toBe(true);
  });

  test("returns false for strings with non-digits", () => {
    expect(isAllDigits("abc")).toBe(false);
    expect(isAllDigits("123abc")).toBe(false);
    expect(isAllDigits("PROJECT-ABC")).toBe(false);
    expect(isAllDigits("12.34")).toBe(false);
    expect(isAllDigits("-123")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isAllDigits("")).toBe(false);
  });
});
