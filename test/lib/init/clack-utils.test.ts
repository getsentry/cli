/**
 * Tests for clack-utils: WizardCancelledError, abortIfCancelled, featureLabel, featureHint.
 *
 * These are pure utility functions that don't require module mocking.
 */

import { describe, expect, test } from "bun:test";
import {
  abortIfCancelled,
  featureHint,
  featureLabel,
  sortFeatures,
  WizardCancelledError,
} from "../../../src/lib/init/clack-utils.js";

describe("WizardCancelledError", () => {
  test("has correct message", () => {
    const err = new WizardCancelledError();
    expect(err.message).toBe("Setup cancelled.");
  });

  test("has correct name", () => {
    const err = new WizardCancelledError();
    expect(err.name).toBe("WizardCancelledError");
  });

  test("is an instance of Error", () => {
    const err = new WizardCancelledError();
    expect(err).toBeInstanceOf(Error);
  });
});

describe("abortIfCancelled", () => {
  test("passes through non-cancel values", () => {
    expect(abortIfCancelled("hello")).toBe("hello");
    expect(abortIfCancelled(42)).toBe(42);
    expect(abortIfCancelled(null)).toBeNull();
  });

  test("passes through object values", () => {
    const obj = { key: "value" };
    expect(abortIfCancelled(obj)).toBe(obj);
  });
});

describe("featureLabel", () => {
  test("returns label for known feature", () => {
    expect(featureLabel("errorMonitoring")).toBe("Error Monitoring");
    expect(featureLabel("performanceMonitoring")).toBe(
      "Performance Monitoring (Tracing)"
    );
    expect(featureLabel("logs")).toBe("Logging");
    expect(featureLabel("crons")).toBe("Crons");
    expect(featureLabel("aiMonitoring")).toBe("AI Monitoring");
    expect(featureLabel("userFeedback")).toBe("User Feedback");
  });

  test("returns id as passthrough for unknown feature", () => {
    expect(featureLabel("unknownFeature")).toBe("unknownFeature");
  });
});

describe("featureHint", () => {
  test("returns hint for known feature", () => {
    expect(featureHint("errorMonitoring")).toBe("Error and crash reporting");
    expect(featureHint("sessionReplay")).toBe("Visual replay of user sessions");
    expect(featureHint("crons")).toBe("Monitor scheduled and recurring jobs");
    expect(featureHint("aiMonitoring")).toBe(
      "Track AI model calls, latency, and failures"
    );
    expect(featureHint("userFeedback")).toBe(
      "Collect in-app user feedback and reports"
    );
  });

  test("returns undefined for unknown feature", () => {
    expect(featureHint("unknownFeature")).toBeUndefined();
  });
});

describe("sortFeatures", () => {
  test("orders known features by canonical display order", () => {
    expect(
      sortFeatures([
        "userFeedback",
        "logs",
        "errorMonitoring",
        "sourceMaps",
        "crons",
        "aiMonitoring",
      ])
    ).toEqual([
      "errorMonitoring",
      "logs",
      "sourceMaps",
      "crons",
      "aiMonitoring",
      "userFeedback",
    ]);
  });

  test("keeps unknown features after known ones", () => {
    expect(sortFeatures(["unknown", "metrics", "another"])).toEqual([
      "metrics",
      "unknown",
      "another",
    ]);
  });
});
