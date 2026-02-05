/**
 * Tests for human-readable formatters
 *
 * Note: Core invariants (uppercase, length preservation, determinism) are tested
 * via property-based tests in human.property.test.ts. These tests focus on
 * specific edge cases and environment-dependent behavior.
 */

import { describe, expect, test } from "bun:test";
import {
  formatIssueRow,
  formatShortId,
  formatUserIdentity,
} from "../../../src/lib/formatters/human.js";
import type { SentryIssue } from "../../../src/types/index.js";

// Helper to strip ANSI codes for content testing
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("formatShortId edge cases", () => {
  test("handles empty options object", () => {
    expect(stripAnsi(formatShortId("CRAFT-G", {}))).toBe("CRAFT-G");
  });

  test("handles undefined options", () => {
    expect(stripAnsi(formatShortId("CRAFT-G", undefined))).toBe("CRAFT-G");
  });

  test("handles mismatched project slug gracefully", () => {
    const result = formatShortId("CRAFT-G", { projectSlug: "other" });
    expect(stripAnsi(result)).toBe("CRAFT-G");
  });

  test("handles legacy string parameter", () => {
    const result = formatShortId("CRAFT-G", "craft");
    expect(stripAnsi(result)).toBe("CRAFT-G");
  });
});

describe("formatShortId ANSI formatting", () => {
  // Note: These tests verify formatting is applied when colors are enabled.
  // In CI/test environments without TTY, chalk may disable colors.
  // Run with FORCE_COLOR=1 to test color output.

  // Helper to check for ANSI escape codes
  function hasAnsiCodes(str: string): boolean {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
    return /\x1b\[[0-9;]*m/.test(str);
  }

  // Check if colors are enabled (chalk respects FORCE_COLOR env)
  const colorsEnabled = process.env.FORCE_COLOR === "1";

  test("single project mode applies formatting to suffix", () => {
    const result = formatShortId("CRAFT-G", { projectSlug: "craft" });
    // Content is always correct
    expect(stripAnsi(result)).toBe("CRAFT-G");
    // ANSI codes only present when colors enabled
    if (colorsEnabled) {
      expect(hasAnsiCodes(result)).toBe(true);
      expect(result.length).toBeGreaterThan(stripAnsi(result).length);
    }
  });

  test("multi-project mode applies formatting to suffix", () => {
    const result = formatShortId("SPOTLIGHT-ELECTRON-4Y", {
      projectSlug: "spotlight-electron",
      projectAlias: "e",
    });
    expect(stripAnsi(result)).toBe("SPOTLIGHT-ELECTRON-4Y");
    if (colorsEnabled) {
      expect(hasAnsiCodes(result)).toBe(true);
      expect(result.length).toBeGreaterThan(stripAnsi(result).length);
    }
  });

  test("no formatting when no options provided", () => {
    const result = formatShortId("CRAFT-G");
    expect(hasAnsiCodes(result)).toBe(false);
    expect(result).toBe("CRAFT-G");
  });
});

describe("formatIssueRow", () => {
  const mockIssue: SentryIssue = {
    id: "123",
    shortId: "DASHBOARD-A3",
    title: "Test issue",
    level: "error",
    status: "unresolved",
    count: "42",
    userCount: 10,
    firstSeen: "2024-01-01T00:00:00Z",
    lastSeen: "2024-01-02T00:00:00Z",
    permalink: "https://sentry.io/issues/123",
  };

  test("single project mode does not include alias column", () => {
    const row = formatIssueRow(mockIssue, 80, {
      projectSlug: "dashboard",
    });
    // Should not have alias shorthand format
    expect(stripAnsi(row)).not.toContain("o1:d-a3");
  });

  test("multi-project mode includes alias column", () => {
    const row = formatIssueRow(mockIssue, 120, {
      projectSlug: "dashboard",
      projectAlias: "o1:d",
      isMultiProject: true,
    });
    // Should contain the alias shorthand
    expect(stripAnsi(row)).toContain("o1:d-a3");
  });

  test("alias shorthand is lowercase", () => {
    const row = formatIssueRow(mockIssue, 120, {
      projectSlug: "dashboard",
      projectAlias: "o1:d",
      isMultiProject: true,
    });
    // The alias shorthand should be lowercase
    expect(stripAnsi(row)).toContain("o1:d-a3");
    expect(stripAnsi(row)).not.toContain("O1:D-A3");
  });

  test("unique alias format works in multi-project mode", () => {
    const row = formatIssueRow(mockIssue, 120, {
      projectSlug: "dashboard",
      projectAlias: "d",
      isMultiProject: true,
    });
    // Should contain simple alias shorthand
    expect(stripAnsi(row)).toContain("d-a3");
  });
});

describe("formatUserIdentity API shapes", () => {
  // Note: Core behavior is tested via property-based tests.
  // These tests verify specific API contract shapes.

  test("handles UserInfo shape (from database)", () => {
    const result = formatUserIdentity({
      userId: "12345",
      email: "test@example.com",
      username: "testuser",
      name: "Test User",
    });
    expect(result).toBe("Test User <test@example.com>");
  });

  test("handles UserInfo without name", () => {
    const result = formatUserIdentity({
      userId: "12345",
      email: "test@example.com",
      username: "testuser",
    });
    expect(result).toBe("testuser <test@example.com>");
  });

  test("handles token response user with id field", () => {
    const result = formatUserIdentity({
      id: "67890",
      name: "OAuth User",
      email: "oauth@example.com",
    });
    expect(result).toBe("OAuth User <oauth@example.com>");
  });
});
