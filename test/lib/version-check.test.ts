/**
 * Version Check Logic Tests
 */

import { describe, expect, test } from "bun:test";
import { shouldSuppressNotification } from "../../src/lib/version-check.js";

describe("shouldSuppressNotification", () => {
  test("suppresses for upgrade command", () => {
    expect(shouldSuppressNotification(["upgrade"])).toBe(true);
    expect(shouldSuppressNotification(["upgrade", "--check"])).toBe(true);
  });

  test("suppresses for --version flag", () => {
    expect(shouldSuppressNotification(["--version"])).toBe(true);
    expect(shouldSuppressNotification(["-V"])).toBe(true);
  });

  test("suppresses for --json flag", () => {
    expect(shouldSuppressNotification(["issue", "list", "--json"])).toBe(true);
    expect(shouldSuppressNotification(["--json", "issue", "list"])).toBe(true);
  });

  test("does not suppress for regular commands", () => {
    expect(shouldSuppressNotification(["issue", "list"])).toBe(false);
    expect(shouldSuppressNotification(["auth", "status"])).toBe(false);
    expect(shouldSuppressNotification(["help"])).toBe(false);
  });

  test("does not suppress for empty args", () => {
    expect(shouldSuppressNotification([])).toBe(false);
  });
});
