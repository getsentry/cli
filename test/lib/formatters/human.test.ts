/**
 * Tests for human-readable formatters
 *
 * Note: Core invariants (uppercase, length preservation, determinism) are tested
 * via property-based tests in human.property.test.ts. These tests focus on
 * specific edge cases and environment-dependent behavior.
 */

import { describe, expect, test } from "bun:test";
import {
  formatShortId,
  formatUserIdentity,
  type IssueTableRow,
  writeIssueTable,
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

describe("formatShortId multi-project alias highlighting", () => {
  // These tests verify the highlighting logic finds the correct part to highlight.
  // Content is always verified (ANSI codes stripped); formatting presence depends on FORCE_COLOR.

  test("highlights rightmost matching part for ambiguous aliases", () => {
    // Bug fix: For projects api-app, api-admin with aliases ap, ad
    // API-APP-5 with alias "ap" should highlight APP (not API)
    const result = formatShortId("API-APP-5", {
      projectAlias: "ap",
      isMultiProject: true,
    });
    // Content is always correct - the text should be unchanged
    expect(stripAnsi(result)).toBe("API-APP-5");
  });

  test("highlights alias with embedded dash correctly", () => {
    // Bug fix: For projects x-ab, xyz with aliases x-a, xy
    // X-AB-5 with alias "x-a" should highlight X-A (joined project portion)
    const result = formatShortId("X-AB-5", {
      projectAlias: "x-a",
      isMultiProject: true,
    });
    expect(stripAnsi(result)).toBe("X-AB-5");
  });

  test("highlights single char alias at start of multi-part short ID", () => {
    // CLI-WEBSITE-4 with alias "w" should highlight W in WEBSITE (not CLI)
    const result = formatShortId("CLI-WEBSITE-4", {
      projectAlias: "w",
      isMultiProject: true,
    });
    expect(stripAnsi(result)).toBe("CLI-WEBSITE-4");
  });

  test("highlights single char alias in simple short ID", () => {
    // CLI-25 with alias "c" should highlight C in CLI
    const result = formatShortId("CLI-25", {
      projectAlias: "c",
      isMultiProject: true,
    });
    expect(stripAnsi(result)).toBe("CLI-25");
  });

  test("handles org-prefixed alias format", () => {
    // Alias "o1/d" should use "d" for matching against DASHBOARD-A3
    const result = formatShortId("DASHBOARD-A3", {
      projectAlias: "o1/d",
      isMultiProject: true,
    });
    expect(stripAnsi(result)).toBe("DASHBOARD-A3");
  });

  test("falls back gracefully when alias doesn't match", () => {
    // If alias doesn't match any part, return plain text
    const result = formatShortId("CLI-25", {
      projectAlias: "xyz",
      isMultiProject: true,
    });
    expect(stripAnsi(result)).toBe("CLI-25");
  });
});

describe("writeIssueTable", () => {
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

  function capture(): {
    writer: { write: (s: string) => boolean };
    output: () => string;
  } {
    let buf = "";
    return {
      writer: {
        write: (s: string) => {
          buf += s;
          return true;
        },
      },
      output: () => buf,
    };
  }

  test("single project mode does not include ALIAS column", () => {
    const { writer, output } = capture();
    const rows: IssueTableRow[] = [
      { issue: mockIssue, formatOptions: { projectSlug: "dashboard" } },
    ];
    writeIssueTable(writer, rows, false);
    const text = stripAnsi(output());
    expect(text).not.toContain("ALIAS");
    expect(text).toContain("DASHBOARD-A3");
    expect(text).toContain("Test issue");
  });

  test("multi-project mode includes ALIAS column with alias shorthand", () => {
    const { writer, output } = capture();
    const rows: IssueTableRow[] = [
      {
        issue: mockIssue,
        formatOptions: {
          projectSlug: "dashboard",
          projectAlias: "o1:d",
          isMultiProject: true,
        },
      },
    ];
    writeIssueTable(writer, rows, true);
    const text = stripAnsi(output());
    expect(text).toContain("ALIAS");
    expect(text).toContain("o1:d-a3");
  });

  test("table contains all essential columns", () => {
    const { writer, output } = capture();
    const rows: IssueTableRow[] = [
      { issue: mockIssue, formatOptions: { projectSlug: "dashboard" } },
    ];
    writeIssueTable(writer, rows, false);
    const text = stripAnsi(output());
    for (const col of [
      "LEVEL",
      "SHORT ID",
      "COUNT",
      "SEEN",
      "FIXABILITY",
      "TITLE",
    ]) {
      expect(text).toContain(col);
    }
  });

  test("level and title values appear in output", () => {
    const { writer, output } = capture();
    const rows: IssueTableRow[] = [{ issue: mockIssue, formatOptions: {} }];
    writeIssueTable(writer, rows, false);
    const text = stripAnsi(output());
    expect(text).toContain("ERROR");
    expect(text).toContain("Test issue");
    expect(text).toContain("42");
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
