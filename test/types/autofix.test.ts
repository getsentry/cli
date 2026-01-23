/**
 * Autofix Type Helper Tests
 *
 * Tests for pure functions in src/types/autofix.ts
 */

import { describe, expect, test } from "bun:test";
import {
  type AutofixState,
  extractRootCauses,
  isTerminalStatus,
  TERMINAL_STATUSES,
} from "../../src/types/autofix.js";

describe("isTerminalStatus", () => {
  test("returns true for COMPLETED status", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
  });

  test("returns true for ERROR status", () => {
    expect(isTerminalStatus("ERROR")).toBe(true);
  });

  test("returns true for CANCELLED status", () => {
    expect(isTerminalStatus("CANCELLED")).toBe(true);
  });

  test("returns false for PROCESSING status", () => {
    expect(isTerminalStatus("PROCESSING")).toBe(false);
  });

  test("returns false for WAITING_FOR_USER_RESPONSE status", () => {
    expect(isTerminalStatus("WAITING_FOR_USER_RESPONSE")).toBe(false);
  });

  test("returns false for unknown status", () => {
    expect(isTerminalStatus("UNKNOWN")).toBe(false);
  });

  test("TERMINAL_STATUSES contains expected values", () => {
    expect(TERMINAL_STATUSES).toContain("COMPLETED");
    expect(TERMINAL_STATUSES).toContain("ERROR");
    expect(TERMINAL_STATUSES).toContain("CANCELLED");
    expect(TERMINAL_STATUSES).not.toContain("PROCESSING");
  });
});

describe("extractRootCauses", () => {
  test("extracts causes from root_cause_analysis step", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "COMPLETED",
      steps: [
        {
          id: "step-1",
          key: "root_cause_analysis_processing",
          status: "COMPLETED",
          title: "Analyzing",
        },
        {
          id: "step-2",
          key: "root_cause_analysis",
          status: "COMPLETED",
          title: "Root Cause Analysis",
          causes: [
            {
              id: 0,
              description: "Database connection timeout",
              relevant_repos: ["org/repo"],
            },
            {
              id: 1,
              description: "Missing index on query",
            },
          ],
        },
      ],
    };

    const causes = extractRootCauses(state);
    expect(causes).toHaveLength(2);
    expect(causes[0]?.description).toBe("Database connection timeout");
    expect(causes[1]?.description).toBe("Missing index on query");
  });

  test("returns empty array when no steps", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "PROCESSING",
    };

    expect(extractRootCauses(state)).toEqual([]);
  });

  test("returns empty array when steps is empty", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "PROCESSING",
      steps: [],
    };

    expect(extractRootCauses(state)).toEqual([]);
  });

  test("returns empty array when no root_cause_analysis step", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "PROCESSING",
      steps: [
        {
          id: "step-1",
          key: "other_step",
          status: "COMPLETED",
          title: "Other Step",
        },
      ],
    };

    expect(extractRootCauses(state)).toEqual([]);
  });

  test("returns empty array when root_cause_analysis has no causes", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "COMPLETED",
      steps: [
        {
          id: "step-1",
          key: "root_cause_analysis",
          status: "COMPLETED",
          title: "Root Cause Analysis",
        },
      ],
    };

    expect(extractRootCauses(state)).toEqual([]);
  });
});
