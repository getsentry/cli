/**
 * Issue Summary Formatter Tests
 *
 * Tests for formatting functions in src/lib/formatters/summary.ts
 */

import { describe, expect, test } from "bun:test";
import {
  formatIssueSummary,
  formatSummaryHeader,
} from "../../../src/lib/formatters/summary.js";
import type { IssueSummary } from "../../../src/types/index.js";

describe("formatIssueSummary", () => {
  test("formats summary with all fields", () => {
    const summary: IssueSummary = {
      groupId: "123456789",
      headline: "Database Connection Timeout",
      whatsWrong: "Connection pool exhausted due to missing cleanup",
      trace: "Timeout occurred in db.query() after 30s",
      possibleCause: "Connection leak in transaction handling",
      scores: {
        possibleCauseConfidence: 0.85,
        possibleCauseNovelty: 0.6,
        isFixable: true,
        fixabilityScore: 0.7,
        fixabilityScoreVersion: "1.0",
      },
      eventId: "abc123",
    };

    const lines = formatIssueSummary(summary);
    const output = lines.join("\n");

    expect(output).toContain("Database Connection Timeout");
    expect(output).toContain("What's Wrong:");
    expect(output).toContain("Connection pool exhausted");
    expect(output).toContain("Trace:");
    expect(output).toContain("Timeout occurred");
    expect(output).toContain("Possible Cause:");
    expect(output).toContain("Connection leak");
    expect(output).toContain("Confidence: 85%");
  });

  test("formats summary with only headline", () => {
    const summary: IssueSummary = {
      groupId: "123456789",
      headline: "Simple Error",
    };

    const lines = formatIssueSummary(summary);
    const output = lines.join("\n");

    expect(output).toContain("Simple Error");
    expect(output).not.toContain("What's Wrong:");
    expect(output).not.toContain("Trace:");
    expect(output).not.toContain("Possible Cause:");
  });

  test("formats summary without scores", () => {
    const summary: IssueSummary = {
      groupId: "123456789",
      headline: "Test Error",
      whatsWrong: "Something went wrong",
    };

    const lines = formatIssueSummary(summary);
    const output = lines.join("\n");

    expect(output).toContain("Test Error");
    expect(output).toContain("Something went wrong");
    expect(output).not.toContain("Confidence:");
  });

  test("formats summary with null confidence score", () => {
    const summary: IssueSummary = {
      groupId: "123456789",
      headline: "Test Error",
      scores: {
        possibleCauseConfidence: null,
        possibleCauseNovelty: null,
        isFixable: null,
        fixabilityScore: null,
        fixabilityScoreVersion: null,
      },
    };

    const lines = formatIssueSummary(summary);
    const output = lines.join("\n");

    expect(output).toContain("Test Error");
    // Should not show confidence when it's null
    expect(output).not.toContain("Confidence:");
  });

  test("rounds confidence percentage", () => {
    const summary: IssueSummary = {
      groupId: "123456789",
      headline: "Test Error",
      scores: {
        possibleCauseConfidence: 0.567,
        possibleCauseNovelty: null,
        isFixable: null,
        fixabilityScore: null,
        fixabilityScoreVersion: null,
      },
    };

    const lines = formatIssueSummary(summary);
    const output = lines.join("\n");

    expect(output).toContain("Confidence: 57%");
  });
});

describe("formatSummaryHeader", () => {
  test("returns header lines", () => {
    const lines = formatSummaryHeader();

    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("Issue Summary");
  });
});
