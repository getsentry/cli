/**
 * Tests for human formatter utility functions
 *
 * These tests cover pure utility functions that don't depend on external state.
 * Functions tested: formatStatusIcon, formatStatusLabel, formatTable, divider,
 * formatRelativeTime, maskToken, formatDuration, formatExpiration
 */

import { describe, expect, test } from "bun:test";
import {
  assert as fcAssert,
  integer,
  nat,
  property,
  stringMatching,
} from "fast-check";
import {
  divider,
  formatDuration,
  formatExpiration,
  formatRelativeTime,
  formatStatusIcon,
  formatStatusLabel,
  formatTable,
  maskToken,
} from "../../../src/lib/formatters/human.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

// Helper to strip ANSI codes for content testing
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// Status Formatting

describe("formatStatusIcon", () => {
  test("returns checkmark for resolved status", () => {
    const result = stripAnsi(formatStatusIcon("resolved"));
    expect(result).toBe("✓");
  });

  test("returns bullet for unresolved status", () => {
    const result = stripAnsi(formatStatusIcon("unresolved"));
    expect(result).toBe("●");
  });

  test("returns dash for ignored status", () => {
    const result = stripAnsi(formatStatusIcon("ignored"));
    expect(result).toBe("−");
  });

  test("returns bullet for undefined status", () => {
    const result = stripAnsi(formatStatusIcon(undefined));
    expect(result).toBe("●");
  });

  test("returns bullet for unknown status", () => {
    const result = stripAnsi(formatStatusIcon("unknown-status"));
    expect(result).toBe("●");
  });
});

describe("formatStatusLabel", () => {
  test("returns full label for resolved status", () => {
    const result = stripAnsi(formatStatusLabel("resolved"));
    expect(result).toBe("✓ Resolved");
  });

  test("returns full label for unresolved status", () => {
    const result = stripAnsi(formatStatusLabel("unresolved"));
    expect(result).toBe("● Unresolved");
  });

  test("returns full label for ignored status", () => {
    const result = stripAnsi(formatStatusLabel("ignored"));
    expect(result).toBe("− Ignored");
  });

  test("returns Unknown for undefined status", () => {
    const result = stripAnsi(formatStatusLabel(undefined));
    expect(result).toBe("● Unknown");
  });

  test("returns Unknown for unrecognized status", () => {
    const result = stripAnsi(formatStatusLabel("something-else"));
    expect(result).toBe("● Unknown");
  });
});

// Table Formatting

describe("formatTable", () => {
  test("formats simple table with left alignment", () => {
    const columns = [
      { header: "NAME", width: 10 },
      { header: "VALUE", width: 5 },
    ];
    const rows = [
      ["Alice", "100"],
      ["Bob", "200"],
    ];

    const result = formatTable(columns, rows);

    expect(result).toHaveLength(3); // 1 header + 2 rows
    expect(result[0]).toBe("NAME        VALUE");
    expect(result[1]).toBe("Alice       100  ");
    expect(result[2]).toBe("Bob         200  ");
  });

  test("formats table with right alignment", () => {
    const columns = [
      { header: "NAME", width: 10 },
      { header: "COUNT", width: 5, align: "right" as const },
    ];
    const rows = [
      ["Alice", "42"],
      ["Bob", "7"],
    ];

    const result = formatTable(columns, rows);

    expect(result[0]).toBe("NAME        COUNT");
    expect(result[1]).toBe("Alice          42");
    expect(result[2]).toBe("Bob             7");
  });

  test("handles empty rows", () => {
    const columns = [{ header: "NAME", width: 10 }];
    const rows: string[][] = [];

    const result = formatTable(columns, rows);

    expect(result).toHaveLength(1); // Just header
    expect(result[0]).toBe("NAME      ");
  });

  test("handles mixed alignment", () => {
    const columns = [
      { header: "LEFT", width: 8, align: "left" as const },
      { header: "RIGHT", width: 8, align: "right" as const },
      { header: "DEFAULT", width: 8 },
    ];
    const rows = [["a", "b", "c"]];

    const result = formatTable(columns, rows);

    expect(result[0]).toBe("LEFT         RIGHT  DEFAULT ");
    expect(result[1]).toBe("a                b  c       ");
  });
});

// Divider

describe("divider", () => {
  test("creates divider with default length and character", () => {
    const result = stripAnsi(divider());
    expect(result).toBe("─".repeat(80));
    expect(result.length).toBe(80);
  });

  test("creates divider with custom length", () => {
    const result = stripAnsi(divider(40));
    expect(result).toBe("─".repeat(40));
    expect(result.length).toBe(40);
  });

  test("creates divider with custom character", () => {
    const result = stripAnsi(divider(10, "="));
    expect(result).toBe("=".repeat(10));
  });

  test("creates divider with both custom length and character", () => {
    const result = stripAnsi(divider(5, "*"));
    expect(result).toBe("*****");
  });

  test("property: divider length equals requested length", async () => {
    await fcAssert(
      property(integer({ min: 1, max: 200 }), (length) => {
        const result = stripAnsi(divider(length));
        expect(result.length).toBe(length);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

// Relative Time Formatting

describe("formatRelativeTime", () => {
  test("returns padded dash for undefined input", () => {
    const result = stripAnsi(formatRelativeTime(undefined));
    expect(result.trim()).toBe("—");
    expect(result.length).toBe(10); // Padded to 10 chars
  });

  test("formats minutes ago for recent times", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = stripAnsi(formatRelativeTime(fiveMinutesAgo));
    expect(result.trim()).toMatch(/^\d+m ago$/);
  });

  test("formats hours ago for times within 24 hours", () => {
    const threeHoursAgo = new Date(
      Date.now() - 3 * 60 * 60 * 1000
    ).toISOString();
    const result = stripAnsi(formatRelativeTime(threeHoursAgo));
    expect(result.trim()).toMatch(/^\d+h ago$/);
  });

  test("formats days ago for times within 3 days", () => {
    const twoDaysAgo = new Date(
      Date.now() - 2 * 24 * 60 * 60 * 1000
    ).toISOString();
    const result = stripAnsi(formatRelativeTime(twoDaysAgo));
    expect(result.trim()).toMatch(/^\d+d ago$/);
  });

  test("formats short date for times older than 3 days", () => {
    const tenDaysAgo = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000
    ).toISOString();
    const result = stripAnsi(formatRelativeTime(tenDaysAgo));
    // Should be like "Jan 18" or "Dec 5"
    expect(result.trim()).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  test("result is always padded to 10 characters", () => {
    const now = new Date().toISOString();
    const result = formatRelativeTime(now);
    expect(result.length).toBe(10);
  });
});

// Token Masking

describe("maskToken", () => {
  test("masks short tokens completely", () => {
    expect(maskToken("abc")).toBe("****");
    expect(maskToken("123456789012")).toBe("****"); // Exactly 12 chars
  });

  test("shows first 8 and last 4 chars for longer tokens", () => {
    const token = "sntrys_1234567890abcdef";
    const result = maskToken(token);
    expect(result).toBe("sntrys_1...cdef");
  });

  test("property: masked token never reveals middle characters", async () => {
    const longTokenArb = stringMatching(/^[a-zA-Z0-9_]{13,50}$/);

    await fcAssert(
      property(longTokenArb, (token) => {
        const masked = maskToken(token);
        // Should show first 8, then ..., then last 4
        expect(masked).toBe(
          `${token.substring(0, 8)}...${token.substring(token.length - 4)}`
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("property: short tokens are completely masked", async () => {
    const shortTokenArb = stringMatching(/^[a-zA-Z0-9]{1,12}$/);

    await fcAssert(
      property(shortTokenArb, (token) => {
        expect(maskToken(token)).toBe("****");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

// Duration Formatting

describe("formatDuration", () => {
  test("formats singular minute", () => {
    expect(formatDuration(60)).toBe("1 minute");
  });

  test("formats plural minutes", () => {
    expect(formatDuration(300)).toBe("5 minutes");
  });

  test("formats singular hour", () => {
    expect(formatDuration(3600)).toBe("1 hour");
  });

  test("formats plural hours", () => {
    expect(formatDuration(7200)).toBe("2 hours");
  });

  test("formats hours and minutes combined", () => {
    expect(formatDuration(5400)).toBe("1 hour and 30 minutes");
  });

  test("formats multiple hours and singular minute", () => {
    expect(formatDuration(7260)).toBe("2 hours and 1 minute");
  });

  test("formats zero minutes", () => {
    expect(formatDuration(0)).toBe("0 minutes");
  });

  test("formats less than a minute as 0 minutes", () => {
    expect(formatDuration(30)).toBe("0 minutes");
  });

  test("property: duration formatting is consistent", async () => {
    await fcAssert(
      property(nat({ max: 86_400 }), (seconds) => {
        const result = formatDuration(seconds);
        // Result should always contain "minute" or "hour"
        expect(result).toMatch(/minute|hour/);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

// Expiration Formatting

describe("formatExpiration", () => {
  test("returns Expired for past timestamps", () => {
    const pastTime = Date.now() - 1000;
    expect(formatExpiration(pastTime)).toBe("Expired");
  });

  test("includes remaining time for future timestamps", () => {
    // 2 hours from now
    const futureTime = Date.now() + 2 * 60 * 60 * 1000;
    const result = formatExpiration(futureTime);
    expect(result).toContain("remaining");
    expect(result).toContain("hour");
  });

  test("includes date string for future timestamps", () => {
    const futureTime = Date.now() + 60 * 60 * 1000; // 1 hour from now
    const result = formatExpiration(futureTime);
    // Should include a date/time string
    expect(result).toMatch(/\d/);
    expect(result).toContain("(");
    expect(result).toContain(")");
  });

  test("property: expired times always return 'Expired'", async () => {
    await fcAssert(
      property(integer({ min: 1, max: 1_000_000 }), (msAgo) => {
        const pastTime = Date.now() - msAgo;
        expect(formatExpiration(pastTime)).toBe("Expired");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("property: future times always include 'remaining'", async () => {
    await fcAssert(
      property(integer({ min: 60_000, max: 86_400_000 }), (msAhead) => {
        const futureTime = Date.now() + msAhead;
        const result = formatExpiration(futureTime);
        expect(result).toContain("remaining");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
