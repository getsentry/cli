/**
 * Tests for Seer telemetry helpers.
 *
 * Verifies that classifySeerError correctly maps error types to SeerOutcome values.
 */

import { describe, expect, test } from "bun:test";
import { ApiError, SeerError, TimeoutError } from "../../src/lib/errors.js";
import {
  classifySeerError,
  type SeerOutcome,
} from "../../src/lib/telemetry.js";

describe("classifySeerError", () => {
  test("maps SeerError no_budget", () => {
    expect(classifySeerError(new SeerError("no_budget", "my-org"))).toBe(
      "no_budget" satisfies SeerOutcome
    );
  });

  test("maps SeerError not_enabled", () => {
    expect(classifySeerError(new SeerError("not_enabled"))).toBe(
      "not_enabled" satisfies SeerOutcome
    );
  });

  test("maps SeerError ai_disabled", () => {
    expect(classifySeerError(new SeerError("ai_disabled", "org"))).toBe(
      "ai_disabled" satisfies SeerOutcome
    );
  });

  test("maps TimeoutError", () => {
    expect(classifySeerError(new TimeoutError("timed out"))).toBe(
      "timeout" satisfies SeerOutcome
    );
  });

  test("maps ApiError", () => {
    expect(classifySeerError(new ApiError("not found", 404))).toBe(
      "api_error" satisfies SeerOutcome
    );
  });

  test("maps generic Error", () => {
    expect(classifySeerError(new Error("broke"))).toBe(
      "error" satisfies SeerOutcome
    );
  });

  test("maps non-Error values", () => {
    expect(classifySeerError("string")).toBe("error" satisfies SeerOutcome);
    expect(classifySeerError(null)).toBe("error" satisfies SeerOutcome);
    expect(classifySeerError(undefined)).toBe("error" satisfies SeerOutcome);
  });
});
