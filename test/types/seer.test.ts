/**
 * Seer Type Helper Tests
 *
 * Tests for pure functions in src/types/seer.ts
 */

import { describe, expect, test } from "bun:test";
import {
  type AutofixState,
  extractExaminedFiles,
  extractNoSolutionReason,
  extractRootCauses,
  isTerminalStatus,
  type RootCause,
  TERMINAL_STATUSES,
} from "../../src/types/seer.js";

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

  test("extracts causes from root_cause_analysis in blocks", () => {
    const state = {
      run_id: 456,
      status: "COMPLETED",
      blocks: [
        {
          key: "other_block",
          status: "COMPLETED",
        },
        {
          key: "root_cause_analysis",
          status: "COMPLETED",
          causes: [
            {
              id: 0,
              description: "Null pointer in request handler",
              relevant_repos: ["org/backend"],
            },
          ],
        },
      ],
    } as unknown as AutofixState;

    const causes = extractRootCauses(state);
    expect(causes).toHaveLength(1);
    expect(causes[0]?.description).toBe("Null pointer in request handler");
  });

  test("prefers blocks over steps when both contain root causes", () => {
    const state = {
      run_id: 789,
      status: "COMPLETED",
      blocks: [
        {
          key: "root_cause_analysis",
          status: "COMPLETED",
          causes: [{ id: 0, description: "From blocks" }],
        },
      ],
      steps: [
        {
          id: "step-1",
          key: "root_cause_analysis",
          status: "COMPLETED",
          title: "Root Cause Analysis",
          causes: [{ id: 0, description: "From steps" }],
        },
      ],
    } as unknown as AutofixState;

    const causes = extractRootCauses(state);
    expect(causes).toHaveLength(1);
    expect(causes[0]?.description).toBe("From blocks");
  });
});

describe("extractNoSolutionReason", () => {
  test("extracts reason from solution artifact in steps", () => {
    const state = {
      run_id: 1,
      status: "COMPLETED",
      steps: [
        {
          id: "s1",
          key: "plan",
          status: "COMPLETED",
          title: "Plan",
          artifacts: [
            {
              key: "solution",
              data: null,
              reason:
                "Root cause is infrastructure-level, no code fix identified",
            },
          ],
        },
      ],
    } as unknown as AutofixState;

    expect(extractNoSolutionReason(state)).toBe(
      "Root cause is infrastructure-level, no code fix identified"
    );
  });

  test("extracts reason from solution artifact in blocks", () => {
    const state = {
      run_id: 1,
      status: "COMPLETED",
      blocks: [
        {
          artifacts: [
            {
              key: "solution",
              data: null,
              reason: "No actionable code change found",
            },
          ],
        },
      ],
    } as unknown as AutofixState;

    expect(extractNoSolutionReason(state)).toBe(
      "No actionable code change found"
    );
  });

  test("returns undefined when no solution artifact exists", () => {
    const state: AutofixState = {
      run_id: 1,
      status: "COMPLETED",
      steps: [
        {
          id: "s1",
          key: "plan",
          status: "COMPLETED",
          title: "Plan",
        },
      ],
    };

    expect(extractNoSolutionReason(state)).toBeUndefined();
  });

  test("returns undefined when solution artifact has no reason", () => {
    const state = {
      run_id: 1,
      status: "COMPLETED",
      steps: [
        {
          id: "s1",
          key: "plan",
          status: "COMPLETED",
          title: "Plan",
          artifacts: [{ key: "solution", data: null }],
        },
      ],
    } as unknown as AutofixState;

    expect(extractNoSolutionReason(state)).toBeUndefined();
  });

  test("returns undefined when no steps or blocks", () => {
    const state: AutofixState = { run_id: 1, status: "COMPLETED" };
    expect(extractNoSolutionReason(state)).toBeUndefined();
  });
});

describe("extractExaminedFiles", () => {
  test("extracts file paths from reproduction steps", () => {
    const causes: RootCause[] = [
      {
        id: 0,
        description: "HTTP/1.1 overhead",
        root_cause_reproduction: [
          {
            title: "Step 1",
            code_snippet_and_analysis: "...",
            relevant_code_file: {
              file_path: "src/mdx.ts",
              repo_name: "org/repo",
            },
          },
          {
            title: "Step 2",
            code_snippet_and_analysis: "...",
            relevant_code_file: {
              file_path: "app/layout.tsx",
              repo_name: "org/repo",
            },
          },
        ],
      },
    ];

    const files = extractExaminedFiles(causes);
    expect(files).toEqual(["src/mdx.ts", "app/layout.tsx"]);
  });

  test("deduplicates file paths", () => {
    const causes: RootCause[] = [
      {
        id: 0,
        description: "Bug",
        root_cause_reproduction: [
          {
            title: "Step 1",
            code_snippet_and_analysis: "...",
            relevant_code_file: {
              file_path: "src/index.ts",
              repo_name: "org/repo",
            },
          },
          {
            title: "Step 2",
            code_snippet_and_analysis: "...",
            relevant_code_file: {
              file_path: "src/index.ts",
              repo_name: "org/repo",
            },
          },
        ],
      },
    ];

    expect(extractExaminedFiles(causes)).toEqual(["src/index.ts"]);
  });

  test("returns empty array when no reproduction steps", () => {
    const causes: RootCause[] = [{ id: 0, description: "Bug" }];

    expect(extractExaminedFiles(causes)).toEqual([]);
  });

  test("returns empty array for empty causes", () => {
    expect(extractExaminedFiles([])).toEqual([]);
  });

  test("skips steps without relevant_code_file", () => {
    const causes: RootCause[] = [
      {
        id: 0,
        description: "Bug",
        root_cause_reproduction: [
          {
            title: "Step 1",
            code_snippet_and_analysis: "...",
          },
          {
            title: "Step 2",
            code_snippet_and_analysis: "...",
            relevant_code_file: {
              file_path: "src/app.ts",
              repo_name: "org/repo",
            },
          },
        ],
      },
    ];

    expect(extractExaminedFiles(causes)).toEqual(["src/app.ts"]);
  });

  test("filters out N/A sentinel values from file paths", () => {
    const causes: RootCause[] = [
      {
        id: 0,
        description: "Infrastructure issue",
        root_cause_reproduction: [
          {
            title: "Code step",
            code_snippet_and_analysis: "...",
            relevant_code_file: {
              file_path: "app/layout.tsx",
              repo_name: "getsentry/sentry-docs",
            },
          },
          {
            title: "External system step",
            code_snippet_and_analysis: "...",
            relevant_code_file: {
              file_path: "N/A",
              repo_name: "N/A",
            },
          },
          {
            title: "Another external step",
            code_snippet_and_analysis: "...",
            relevant_code_file: {
              file_path: "N/A",
              repo_name: "N/A",
            },
          },
        ],
      },
    ];

    expect(extractExaminedFiles(causes)).toEqual(["app/layout.tsx"]);
  });
});
