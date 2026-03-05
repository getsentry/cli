/**
 * Property-Based Tests for withAuthGuard
 *
 * Uses fast-check to verify invariants that hold for any input:
 * - AuthError always propagates (never swallowed)
 * - Non-AuthError always returns the fallback
 * - Successful operations are transparent (withAuthGuard is a no-op)
 */

import { describe, expect, test } from "bun:test";
import {
  anything,
  asyncProperty,
  constantFrom,
  assert as fcAssert,
} from "fast-check";
import { AuthError, withAuthGuard } from "../../src/lib/errors.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

describe("property: withAuthGuard", () => {
  test("AuthError always propagates regardless of fallback value", () => {
    fcAssert(
      asyncProperty(
        constantFrom(
          "not_authenticated" as const,
          "expired" as const,
          "invalid" as const
        ),
        anything(),
        async (reason, fallback) => {
          const authError = new AuthError(reason);
          try {
            await withAuthGuard(() => Promise.reject(authError), fallback);
            // Should never reach here
            expect.unreachable("withAuthGuard should have thrown");
          } catch (error) {
            expect(error).toBeInstanceOf(AuthError);
            expect(error).toBe(authError);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("non-AuthError always returns fallback", () => {
    fcAssert(
      asyncProperty(anything(), async (fallback) => {
        const result = await withAuthGuard(
          () => Promise.reject(new Error("transient failure")),
          fallback
        );
        expect(result).toBe(fallback);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("successful fn always returns fn result (transparent on success)", () => {
    fcAssert(
      asyncProperty(anything(), anything(), async (value, fallback) => {
        const result = await withAuthGuard(
          () => Promise.resolve(value),
          fallback
        );
        expect(result).toBe(value);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
