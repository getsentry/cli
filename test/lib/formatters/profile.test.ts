/**
 * Profile Formatter Tests
 *
 * Tests for profiling output formatters in src/lib/formatters/profile.ts.
 */

import { describe, expect, test } from "bun:test";
import {
  findCommonPrefix,
  formatProfileAnalysis,
  formatProfileListFooter,
  formatProfileListHeader,
  formatProfileListRow,
  formatProfileListTableHeader,
  truncateMiddle,
} from "../../../src/lib/formatters/profile.js";
import type {
  HotPath,
  ProfileAnalysis,
  ProfileFunctionRow,
  TransactionAliasEntry,
} from "../../../src/types/index.js";

/** Strip ANSI color codes for easier testing */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function createHotPath(overrides: Partial<HotPath> = {}): HotPath {
  return {
    frames: [
      {
        name: "processRequest",
        file: "src/app.ts",
        line: 42,
        is_application: true,
        fingerprint: 1,
      },
    ],
    frameInfo: {
      count: 100,
      weight: 5000,
      sumDuration: 10_000_000,
      sumSelfTime: 5_000_000,
      p75Duration: 8_000_000,
      p95Duration: 12_000_000,
      p99Duration: 15_000_000,
    },
    percentage: 45.2,
    ...overrides,
  };
}

function createAnalysis(
  overrides: Partial<ProfileAnalysis> = {}
): ProfileAnalysis {
  return {
    transactionName: "/api/users",
    platform: "node",
    period: "24h",
    percentiles: { p75: 8, p95: 12, p99: 20 },
    hotPaths: [createHotPath()],
    totalSamples: 500,
    userCodeOnly: true,
    ...overrides,
  };
}

// formatProfileAnalysis

describe("formatProfileAnalysis", () => {
  test("includes transaction name and period in header", () => {
    const analysis = createAnalysis();
    const lines = formatProfileAnalysis(analysis);
    const output = stripAnsi(lines.join("\n"));

    expect(output).toContain("/api/users");
    expect(output).toContain("last 24h");
  });

  test("includes performance percentiles section", () => {
    const analysis = createAnalysis({
      percentiles: { p75: 5, p95: 15, p99: 25 },
    });
    const lines = formatProfileAnalysis(analysis);
    const output = stripAnsi(lines.join("\n"));

    expect(output).toContain("Performance Percentiles");
    expect(output).toContain("p75:");
    expect(output).toContain("p95:");
    expect(output).toContain("p99:");
  });

  test("includes hot paths section with user code only label", () => {
    const analysis = createAnalysis({ userCodeOnly: true });
    const lines = formatProfileAnalysis(analysis);
    const output = stripAnsi(lines.join("\n"));

    expect(output).toContain("Hot Paths");
    expect(output).toContain("user code only");
  });

  test("includes hot paths section without user code label when all frames", () => {
    const analysis = createAnalysis({ userCodeOnly: false });
    const lines = formatProfileAnalysis(analysis);
    const output = stripAnsi(lines.join("\n"));

    expect(output).toContain("Hot Paths");
    expect(output).not.toContain("user code only");
  });

  test("includes function name, file, and percentage in hot path rows", () => {
    const analysis = createAnalysis();
    const lines = formatProfileAnalysis(analysis);
    const output = stripAnsi(lines.join("\n"));

    expect(output).toContain("processRequest");
    expect(output).toContain("src/app.ts:42");
    expect(output).toContain("45.2%");
  });

  test("shows recommendation when top hot path exceeds 10%", () => {
    const analysis = createAnalysis({
      hotPaths: [createHotPath({ percentage: 35.5 })],
    });
    const lines = formatProfileAnalysis(analysis);
    const output = stripAnsi(lines.join("\n"));

    expect(output).toContain("Recommendations");
    expect(output).toContain("processRequest");
    expect(output).toContain("35.5%");
    expect(output).toContain("Consider optimizing");
  });

  test("does not show recommendation when top hot path is below 10%", () => {
    const analysis = createAnalysis({
      hotPaths: [createHotPath({ percentage: 5.0 })],
    });
    const lines = formatProfileAnalysis(analysis);
    const output = stripAnsi(lines.join("\n"));

    expect(output).not.toContain("Recommendations");
  });

  test("handles empty hot paths", () => {
    const analysis = createAnalysis({ hotPaths: [] });
    const lines = formatProfileAnalysis(analysis);
    const output = stripAnsi(lines.join("\n"));

    expect(output).toContain("No profile data available");
    expect(output).not.toContain("Recommendations");
  });

  test("returns array of strings", () => {
    const analysis = createAnalysis();
    const lines = formatProfileAnalysis(analysis);

    expect(Array.isArray(lines)).toBe(true);
    for (const line of lines) {
      expect(typeof line).toBe("string");
    }
  });
});

// formatProfileListHeader

describe("formatProfileListHeader", () => {
  test("includes org/project and period", () => {
    const result = formatProfileListHeader("my-org/backend", "7d");
    expect(result).toContain("my-org/backend");
    expect(result).toContain("last 7d");
  });

  test("includes 'Transactions with Profiles' label", () => {
    const result = formatProfileListHeader("org/proj", "24h");
    expect(result).toContain("Transactions with Profiles");
  });
});

// formatProfileListTableHeader

describe("formatProfileListTableHeader", () => {
  test("includes ALIAS column when hasAliases is true", () => {
    const result = stripAnsi(formatProfileListTableHeader(true));
    expect(result).toContain("ALIAS");
    expect(result).toContain("#");
    expect(result).toContain("TRANSACTION");
    expect(result).toContain("SAMPLES");
    expect(result).toContain("p75");
    expect(result).toContain("p95");
  });

  test("does not include ALIAS or # columns when hasAliases is false", () => {
    const result = stripAnsi(formatProfileListTableHeader(false));
    expect(result).not.toContain("ALIAS");
    expect(result).toContain("TRANSACTION");
    expect(result).toContain("SAMPLES");
    expect(result).toContain("p75");
    expect(result).toContain("p95");
  });

  test("defaults to no aliases", () => {
    const result = stripAnsi(formatProfileListTableHeader());
    expect(result).not.toContain("ALIAS");
  });
});

// formatProfileListRow

describe("formatProfileListRow", () => {
  test("formats row with transaction, samples, and p75/p95", () => {
    const row: ProfileFunctionRow = {
      transaction: "/api/users",
      "count_unique(timestamp)": 42,
      "p75(function.duration)": 8_000_000, // 8ms in nanoseconds
      "p95(function.duration)": 15_000_000, // 15ms in nanoseconds
    };

    const result = stripAnsi(formatProfileListRow(row));

    expect(result).toContain("/api/users");
    expect(result).toContain("42");
    expect(result).toContain("8.00ms");
    expect(result).toContain("15.0ms");
  });

  test("formats row with alias when provided", () => {
    const row: ProfileFunctionRow = {
      transaction: "/api/users",
      "count_unique(timestamp)": 150,
      "p75(function.duration)": 8_000_000,
    };

    const alias: TransactionAliasEntry = {
      idx: 1,
      alias: "users",
      transaction: "/api/users",
      orgSlug: "my-org",
      projectSlug: "backend",
    };

    const result = stripAnsi(formatProfileListRow(row, { alias }));

    expect(result).toContain("1");
    expect(result).toContain("users");
    expect(result).toContain("/api/users");
  });

  test("handles missing p75 and p95", () => {
    const row: ProfileFunctionRow = {
      transaction: "/api/users",
    };

    const result = stripAnsi(formatProfileListRow(row));
    // Both p75 and p95 should show "-" when missing
    const dashes = result.match(/-/g);
    expect(dashes?.length).toBeGreaterThanOrEqual(2);
  });

  test("handles missing transaction name", () => {
    const row: ProfileFunctionRow = {
      "count_unique(timestamp)": 10,
      "p75(function.duration)": 5_000_000,
    };

    const result = stripAnsi(formatProfileListRow(row));
    expect(result).toContain("unknown");
  });

  test("handles missing transaction with common prefix without garbling", () => {
    const row: ProfileFunctionRow = {
      "count_unique(timestamp)": 5,
      "p75(function.duration)": 2_000_000,
    };

    const result = stripAnsi(
      formatProfileListRow(row, { commonPrefix: "/api/0/" })
    );
    // "unknown" should not be sliced by the common prefix
    expect(result).toContain("unknown");
  });

  test("aligns columns when hasAliases is true but row has no alias", () => {
    const row: ProfileFunctionRow = {
      transaction: "/api/users",
      "count_unique(timestamp)": 10,
      "p75(function.duration)": 5_000_000,
    };

    const withAlias = stripAnsi(
      formatProfileListRow(row, {
        alias: {
          idx: 1,
          alias: "users",
          transaction: "/api/users",
          orgSlug: "o",
          projectSlug: "p",
        },
      })
    );
    const withoutAlias = stripAnsi(
      formatProfileListRow(row, { hasAliases: true })
    );

    // Both rows should have the same total length so columns align
    expect(withoutAlias.length).toBe(withAlias.length);
  });

  test("truncates long transaction names", () => {
    const longTransaction =
      "/api/v2/organizations/{org}/projects/{project}/events/{event_id}/attachments/";
    const row: ProfileFunctionRow = {
      transaction: longTransaction,
      "count_unique(timestamp)": 1,
      "p75(function.duration)": 1_000_000,
    };

    const result = formatProfileListRow(row);
    // Without alias: truncated to 48 chars
    expect(result.length).toBeLessThan(longTransaction.length + 30);
  });
});

// formatProfileListFooter

describe("formatProfileListFooter", () => {
  test("shows alias tip when aliases are available", () => {
    const result = formatProfileListFooter(true);
    expect(result).toContain("sentry profile view 1");
    expect(result).toContain("<alias>");
  });

  test("shows transaction name tip when no aliases", () => {
    const result = formatProfileListFooter(false);
    expect(result).toContain("<transaction>");
    expect(result).not.toContain("<alias>");
  });

  test("defaults to no aliases", () => {
    const result = formatProfileListFooter();
    expect(result).toContain("<transaction>");
  });
});

// truncateMiddle

describe("truncateMiddle", () => {
  test("returns short strings unchanged", () => {
    expect(truncateMiddle("hello", 10)).toBe("hello");
    expect(truncateMiddle("hello", 5)).toBe("hello");
  });

  test("truncates from the middle with ellipsis", () => {
    const result = truncateMiddle("abcdefghijklmnop", 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result).toContain("…");
    // Should preserve start and end
    expect(result.startsWith("abcd")).toBe(true);
    expect(result.endsWith("mnop")).toBe(true);
  });

  test("handles very short maxLen", () => {
    const result = truncateMiddle("abcdefghij", 3);
    expect(result.length).toBe(3);
    expect(result).toContain("…");
  });
});

// findCommonPrefix

describe("findCommonPrefix", () => {
  test("finds common path prefix", () => {
    const result = findCommonPrefix([
      "/api/0/organizations/foo/",
      "/api/0/projects/bar/",
      "/api/0/teams/baz/",
    ]);
    expect(result).toBe("/api/0/");
  });

  test("returns empty for single item", () => {
    expect(findCommonPrefix(["/api/foo"])).toBe("");
  });

  test("returns empty for empty array", () => {
    expect(findCommonPrefix([])).toBe("");
  });

  test("returns empty when no common prefix", () => {
    expect(findCommonPrefix(["/api/foo", "/remote/bar"])).toBe("/");
  });

  test("trims to segment boundary", () => {
    expect(findCommonPrefix(["/api/foo/a", "/api/foobar/b"])).toBe("/api/");
  });

  test("handles dotted names", () => {
    expect(
      findCommonPrefix(["tasks.sentry.process", "tasks.sentry.cleanup"])
    ).toBe("tasks.sentry.");
  });
});
