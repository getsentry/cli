/**
 * Property-Based Tests for withAuthGuard
 *
 * Uses fast-check to verify invariants that hold for any input:
 * - AuthError always propagates (never swallowed)
 * - Non-AuthError always returns { ok: false, error }
 * - Successful operations return { ok: true, value }
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
  test("AuthError always propagates regardless of input", () => {
    fcAssert(
      asyncProperty(
        constantFrom(
          "not_authenticated" as const,
          "expired" as const,
          "invalid" as const
        ),
        async (reason) => {
          const authError = new AuthError(reason);
          try {
            await withAuthGuard(() => Promise.reject(authError));
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

  test("non-AuthError always returns failure result with the error", () => {
    fcAssert(
      asyncProperty(anything(), async (thrownValue) => {
        // Skip AuthError instances — they should propagate, not be captured
        if (thrownValue instanceof AuthError) return;

        const result = await withAuthGuard(() => Promise.reject(thrownValue));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe(thrownValue);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("successful fn always returns ok result (transparent on success)", () => {
    fcAssert(
      asyncProperty(anything(), async (value) => {
        const result = await withAuthGuard(() => Promise.resolve(value));
        expect(result).toEqual({ ok: true, value });
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
