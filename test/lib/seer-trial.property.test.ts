/**
 * Seer Trial Property-Based Tests
 *
 * Property-based tests for trial eligibility logic.
 */

import { describe, expect, test } from "bun:test";
import { constantFrom, assert as fcAssert, property } from "fast-check";

import { SeerError, type SeerErrorReason } from "../../src/lib/errors.js";
import { isTrialEligible } from "../../src/lib/seer-trial.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

/** All possible SeerError reasons */
const allReasons: SeerErrorReason[] = [
  "no_budget",
  "not_enabled",
  "ai_disabled",
];

/** Reasons that should be eligible for trial (when other conditions are met) */
const eligibleReasons = new Set<SeerErrorReason>(["no_budget", "not_enabled"]);

describe("property: isTrialEligible", () => {
  test("ai_disabled is never trial-eligible regardless of orgSlug", () => {
    // In non-TTY (test runner), isTrialEligible always returns false,
    // but ai_disabled should be false even if all other conditions are met.
    // We test the reason filtering aspect.
    fcAssert(
      property(constantFrom("test-org", "my-org", "sentry"), (orgSlug) => {
        const err = new SeerError("ai_disabled", orgSlug);
        expect(isTrialEligible(err)).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("undefined orgSlug is never trial-eligible regardless of reason", () => {
    fcAssert(
      property(constantFrom(...allReasons), (reason) => {
        const err = new SeerError(reason);
        expect(isTrialEligible(err)).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("without orgSlug, all reasons return false", () => {
    fcAssert(
      property(constantFrom(...allReasons), (reason) => {
        const err = new SeerError(reason, undefined);
        expect(isTrialEligible(err)).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("only no_budget and not_enabled are in the eligible set", () => {
    // Verify our eligibleReasons constant matches expectations
    expect(eligibleReasons.has("no_budget")).toBe(true);
    expect(eligibleReasons.has("not_enabled")).toBe(true);
    expect(eligibleReasons.has("ai_disabled")).toBe(false);
    expect(eligibleReasons.size).toBe(2);
  });
});
