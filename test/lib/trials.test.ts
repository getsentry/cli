/**
 * Product Trial Utilities Tests
 *
 * Tests for the shared trial name mapping, status derivation,
 * and helper functions.
 */

import { describe, expect, test } from "bun:test";
import {
  findAvailableTrial,
  getDaysRemaining,
  getTrialDisplayName,
  getTrialFriendlyName,
  getTrialStatus,
  getValidTrialNames,
  isTrialName,
} from "../../src/lib/trials.js";
import type { ProductTrial } from "../../src/types/index.js";

/** Helper to create a trial object with sensible defaults */
function makeTrial(overrides: Partial<ProductTrial> = {}): ProductTrial {
  return {
    category: "seerUsers",
    startDate: null,
    endDate: null,
    reasonCode: 0,
    isStarted: false,
    lengthDays: 14,
    ...overrides,
  };
}

describe("findAvailableTrial", () => {
  test("finds unstarted seerUsers trial for 'seer'", () => {
    const trials = [makeTrial({ category: "seerUsers" })];
    const result = findAvailableTrial(trials, "seer");

    expect(result).not.toBeNull();
    expect(result?.category).toBe("seerUsers");
  });

  test("prefers seerUsers over seerAutofix for 'seer'", () => {
    const trials = [
      makeTrial({ category: "seerAutofix" }),
      makeTrial({ category: "seerUsers" }),
    ];
    const result = findAvailableTrial(trials, "seer");

    expect(result?.category).toBe("seerUsers");
  });

  test("falls back to seerAutofix when seerUsers is started", () => {
    const trials = [
      makeTrial({ category: "seerUsers", isStarted: true }),
      makeTrial({ category: "seerAutofix" }),
    ];
    const result = findAvailableTrial(trials, "seer");

    expect(result?.category).toBe("seerAutofix");
  });

  test("returns null when all seer trials are started", () => {
    const trials = [
      makeTrial({ category: "seerUsers", isStarted: true }),
      makeTrial({ category: "seerAutofix", isStarted: true }),
    ];
    const result = findAvailableTrial(trials, "seer");

    expect(result).toBeNull();
  });

  test("returns null for empty trials array", () => {
    expect(findAvailableTrial([], "seer")).toBeNull();
  });

  test("returns null for unknown name", () => {
    const trials = [makeTrial()];
    expect(findAvailableTrial(trials, "unknown")).toBeNull();
  });

  test("finds replays trial", () => {
    const trials = [makeTrial({ category: "replays" })];
    const result = findAvailableTrial(trials, "replays");

    expect(result?.category).toBe("replays");
  });

  test("finds performance trial by 'transactions' category", () => {
    const trials = [makeTrial({ category: "transactions" })];
    const result = findAvailableTrial(trials, "performance");

    expect(result?.category).toBe("transactions");
  });

  test("ignores non-matching categories", () => {
    const trials = [
      makeTrial({ category: "replays" }),
      makeTrial({ category: "logBytes" }),
    ];
    const result = findAvailableTrial(trials, "seer");

    expect(result).toBeNull();
  });
});

describe("getTrialDisplayName", () => {
  test("maps seerUsers to Seer", () => {
    expect(getTrialDisplayName("seerUsers")).toBe("Seer");
  });

  test("maps seerAutofix to Seer", () => {
    expect(getTrialDisplayName("seerAutofix")).toBe("Seer");
  });

  test("maps replays to Session Replay", () => {
    expect(getTrialDisplayName("replays")).toBe("Session Replay");
  });

  test("maps transactions to Performance", () => {
    expect(getTrialDisplayName("transactions")).toBe("Performance");
  });

  test("maps profileDuration to Profiling", () => {
    expect(getTrialDisplayName("profileDuration")).toBe("Profiling");
  });

  test("maps logBytes to Logs", () => {
    expect(getTrialDisplayName("logBytes")).toBe("Logs");
  });

  test("maps spans to Spans", () => {
    expect(getTrialDisplayName("spans")).toBe("Spans");
  });

  test("returns raw category for unknown", () => {
    expect(getTrialDisplayName("unknownCategory")).toBe("unknownCategory");
  });
});

describe("getTrialFriendlyName", () => {
  test("maps seerUsers to seer", () => {
    expect(getTrialFriendlyName("seerUsers")).toBe("seer");
  });

  test("maps seerAutofix to seer", () => {
    expect(getTrialFriendlyName("seerAutofix")).toBe("seer");
  });

  test("maps transactions to performance", () => {
    expect(getTrialFriendlyName("transactions")).toBe("performance");
  });

  test("maps logBytes to logs", () => {
    expect(getTrialFriendlyName("logBytes")).toBe("logs");
  });

  test("returns raw category for unknown", () => {
    expect(getTrialFriendlyName("something")).toBe("something");
  });
});

describe("getTrialStatus", () => {
  test("returns 'available' when not started", () => {
    const trial = makeTrial({ isStarted: false });
    expect(getTrialStatus(trial)).toBe("available");
  });

  test("returns 'active' when started with future end date", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 5);
    const trial = makeTrial({
      isStarted: true,
      startDate: "2025-01-01",
      endDate: tomorrow.toISOString().split("T")[0]!,
    });
    expect(getTrialStatus(trial)).toBe("active");
  });

  test("returns 'active' when started with today as end date", () => {
    const today = new Date().toISOString().split("T")[0]!;
    const trial = makeTrial({
      isStarted: true,
      startDate: "2025-01-01",
      endDate: today,
    });
    expect(getTrialStatus(trial)).toBe("active");
  });

  test("returns 'expired' when started with past end date", () => {
    const trial = makeTrial({
      isStarted: true,
      startDate: "2024-01-01",
      endDate: "2024-01-15",
    });
    expect(getTrialStatus(trial)).toBe("expired");
  });

  test("returns 'active' when started with no end date", () => {
    const trial = makeTrial({
      isStarted: true,
      endDate: null,
    });
    expect(getTrialStatus(trial)).toBe("active");
  });
});

describe("getDaysRemaining", () => {
  test("returns null when not started", () => {
    const trial = makeTrial({ isStarted: false });
    expect(getDaysRemaining(trial)).toBeNull();
  });

  test("returns null when no end date", () => {
    const trial = makeTrial({ isStarted: true, endDate: null });
    expect(getDaysRemaining(trial)).toBeNull();
  });

  test("returns 0 when end date is in the past", () => {
    const trial = makeTrial({
      isStarted: true,
      endDate: "2024-01-15",
    });
    expect(getDaysRemaining(trial)).toBe(0);
  });

  test("returns positive days for future end date", () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const trial = makeTrial({
      isStarted: true,
      endDate: future.toISOString().split("T")[0]!,
    });
    const days = getDaysRemaining(trial);
    expect(days).not.toBeNull();
    // Allow range since time-of-day affects ceiling math
    expect(days!).toBeGreaterThanOrEqual(9);
    expect(days!).toBeLessThanOrEqual(11);
  });
});

describe("getValidTrialNames", () => {
  test("returns all known trial names", () => {
    const names = getValidTrialNames();
    expect(names).toContain("seer");
    expect(names).toContain("replays");
    expect(names).toContain("performance");
    expect(names).toContain("spans");
    expect(names).toContain("profiling");
    expect(names).toContain("logs");
  });

  test("returns exactly 6 names", () => {
    expect(getValidTrialNames()).toHaveLength(6);
  });
});

describe("isTrialName", () => {
  test("returns true for valid names", () => {
    expect(isTrialName("seer")).toBe(true);
    expect(isTrialName("replays")).toBe(true);
    expect(isTrialName("performance")).toBe(true);
    expect(isTrialName("spans")).toBe(true);
    expect(isTrialName("profiling")).toBe(true);
    expect(isTrialName("logs")).toBe(true);
  });

  test("returns false for invalid names", () => {
    expect(isTrialName("unknown")).toBe(false);
    expect(isTrialName("")).toBe(false);
    expect(isTrialName("seerUsers")).toBe(false);
    expect(isTrialName("SEER")).toBe(false);
  });
});
