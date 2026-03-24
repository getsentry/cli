/**
 * Property-based tests for buildIssueListCollapse and ISSUE_DETAIL_COLLAPSE.
 *
 * Verifies invariants that must hold for any configuration of the collapse
 * parameter: always-collapsed fields, stats control, and safety constraints.
 */

import { describe, expect, test } from "bun:test";
import { boolean, assert as fcAssert, property } from "fast-check";

import {
  buildIssueListCollapse,
  ISSUE_DETAIL_COLLAPSE,
} from "../../src/lib/api/issues.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

describe("property: buildIssueListCollapse", () => {
  test("always collapses filtered, lifetime, unhandled regardless of stats flag", () => {
    fcAssert(
      property(boolean(), (collapseStats) => {
        const result = buildIssueListCollapse({
          shouldCollapseStats: collapseStats,
        });
        expect(result).toContain("filtered");
        expect(result).toContain("lifetime");
        expect(result).toContain("unhandled");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("stats presence is exactly controlled by shouldCollapseStats", () => {
    fcAssert(
      property(boolean(), (collapseStats) => {
        const result = buildIssueListCollapse({
          shouldCollapseStats: collapseStats,
        });
        expect(result.includes("stats")).toBe(collapseStats);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("never collapses base (would break all rendering)", () => {
    fcAssert(
      property(boolean(), (collapseStats) => {
        const result = buildIssueListCollapse({
          shouldCollapseStats: collapseStats,
        });
        expect(result).not.toContain("base");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("returns no duplicates", () => {
    fcAssert(
      property(boolean(), (collapseStats) => {
        const result = buildIssueListCollapse({
          shouldCollapseStats: collapseStats,
        });
        expect(new Set(result).size).toBe(result.length);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("length is 3 without stats, 4 with stats", () => {
    fcAssert(
      property(boolean(), (collapseStats) => {
        const result = buildIssueListCollapse({
          shouldCollapseStats: collapseStats,
        });
        expect(result.length).toBe(collapseStats ? 4 : 3);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("ISSUE_DETAIL_COLLAPSE", () => {
  test("contains exactly stats, lifetime, filtered, unhandled", () => {
    expect(ISSUE_DETAIL_COLLAPSE).toEqual([
      "stats",
      "lifetime",
      "filtered",
      "unhandled",
    ]);
  });

  test("never contains base (would break issue rendering)", () => {
    expect(ISSUE_DETAIL_COLLAPSE).not.toContain("base");
  });

  test("always includes stats (detail views never show sparklines)", () => {
    expect(ISSUE_DETAIL_COLLAPSE).toContain("stats");
  });

  test("is a superset of buildIssueListCollapse with stats collapsed", () => {
    const listCollapse = buildIssueListCollapse({ shouldCollapseStats: true });
    for (const field of listCollapse) {
      expect(ISSUE_DETAIL_COLLAPSE).toContain(field);
    }
  });
});
