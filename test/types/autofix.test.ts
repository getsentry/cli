/**
 * Autofix Type Helper Tests
 *
 * Tests for pure functions in src/types/autofix.ts
 */

import { describe, expect, test } from "bun:test";
import {
  type AutofixExplorerState,
  type AutofixState,
  type AutofixStep,
  extractPrUrl,
  extractRootCauseArtifact,
  extractRootCauses,
  getLatestProgress,
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

describe("getLatestProgress", () => {
  test("returns latest progress message from last step", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "PROCESSING",
      steps: [
        {
          id: "step-1",
          key: "step_1",
          status: "COMPLETED",
          title: "Step 1",
          progress: [
            { message: "First message", timestamp: "2025-01-01T00:00:00Z" },
          ],
        },
        {
          id: "step-2",
          key: "step_2",
          status: "PROCESSING",
          title: "Step 2",
          progress: [
            { message: "Second message", timestamp: "2025-01-01T00:01:00Z" },
            { message: "Latest message", timestamp: "2025-01-01T00:02:00Z" },
          ],
        },
      ],
    };

    expect(getLatestProgress(state)).toBe("Latest message");
  });

  test("returns message from earlier step if later steps have no progress", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "PROCESSING",
      steps: [
        {
          id: "step-1",
          key: "step_1",
          status: "COMPLETED",
          title: "Step 1",
          progress: [
            { message: "Has progress", timestamp: "2025-01-01T00:00:00Z" },
          ],
        },
        {
          id: "step-2",
          key: "step_2",
          status: "PROCESSING",
          title: "Step 2",
          progress: [],
        },
      ],
    };

    expect(getLatestProgress(state)).toBe("Has progress");
  });

  test("returns undefined when no steps", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "PROCESSING",
    };

    expect(getLatestProgress(state)).toBeUndefined();
  });

  test("returns undefined when steps have no progress", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "PROCESSING",
      steps: [
        {
          id: "step-1",
          key: "step_1",
          status: "PROCESSING",
          title: "Step 1",
        },
      ],
    };

    expect(getLatestProgress(state)).toBeUndefined();
  });
});

describe("extractPrUrl", () => {
  test("returns undefined when no steps", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "COMPLETED",
    };

    expect(extractPrUrl(state)).toBeUndefined();
  });

  test("returns undefined when steps have no PR info", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "COMPLETED",
      steps: [
        {
          id: "step-1",
          key: "root_cause_analysis",
          status: "COMPLETED",
          title: "Analysis",
        },
      ],
    };

    expect(extractPrUrl(state)).toBeUndefined();
  });

  test("extracts PR URL from create_pr step", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "COMPLETED",
      steps: [
        {
          id: "step-1",
          key: "create_pr",
          status: "COMPLETED",
          title: "Create PR",
          pr_url: "https://github.com/org/repo/pull/123",
        } as AutofixStep & { pr_url: string },
      ],
    };

    expect(extractPrUrl(state)).toBe("https://github.com/org/repo/pull/123");
  });

  test("extracts PR URL from changes step", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "COMPLETED",
      steps: [
        {
          id: "step-1",
          key: "changes",
          status: "COMPLETED",
          title: "Changes",
          pr_url: "https://github.com/org/repo/pull/456",
        } as AutofixStep & { pr_url: string },
      ],
    };

    expect(extractPrUrl(state)).toBe("https://github.com/org/repo/pull/456");
  });

  test("extracts PR URL from coding_agents", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "COMPLETED",
      steps: [],
      coding_agents: {
        agent_1: {
          pr_url: "https://github.com/org/repo/pull/789",
        },
      },
    };

    expect(extractPrUrl(state)).toBe("https://github.com/org/repo/pull/789");
  });
});

describe("extractRootCauseArtifact", () => {
  test("extracts root_cause artifact from blocks", () => {
    const state: AutofixExplorerState = {
      run_id: 123,
      status: "COMPLETED",
      blocks: [
        {
          id: "block-1",
          message: { role: "assistant", content: "Analyzing..." },
          timestamp: "2025-01-01T00:00:00Z",
        },
        {
          id: "block-2",
          message: { role: "assistant", content: "Found root cause" },
          timestamp: "2025-01-01T00:01:00Z",
          artifacts: [
            {
              key: "root_cause",
              data: {
                one_line_description: "Database connection timeout",
                five_whys: [
                  "Connection pool exhausted",
                  "Too many concurrent requests",
                  "Missing connection limits",
                ],
                reproduction_steps: [
                  "Start 100 concurrent requests",
                  "Wait for pool exhaustion",
                  "Observe timeout",
                ],
              },
            },
          ],
        },
      ],
    };

    const artifact = extractRootCauseArtifact(state);
    expect(artifact).not.toBeNull();
    expect(artifact?.key).toBe("root_cause");
    expect(artifact?.data.one_line_description).toBe(
      "Database connection timeout"
    );
    expect(artifact?.data.five_whys).toHaveLength(3);
    expect(artifact?.data.reproduction_steps).toHaveLength(3);
  });

  test("returns null when no blocks", () => {
    const state: AutofixExplorerState = {
      run_id: 123,
      status: "COMPLETED",
    };

    expect(extractRootCauseArtifact(state)).toBeNull();
  });

  test("returns null when blocks have no artifacts", () => {
    const state: AutofixExplorerState = {
      run_id: 123,
      status: "COMPLETED",
      blocks: [
        {
          id: "block-1",
          message: { role: "assistant", content: "Processing" },
          timestamp: "2025-01-01T00:00:00Z",
        },
      ],
    };

    expect(extractRootCauseArtifact(state)).toBeNull();
  });

  test("returns null when no root_cause artifact exists", () => {
    const state: AutofixExplorerState = {
      run_id: 123,
      status: "COMPLETED",
      blocks: [
        {
          id: "block-1",
          message: { role: "assistant", content: "Found code" },
          timestamp: "2025-01-01T00:00:00Z",
          artifacts: [
            {
              key: "code_snippet",
              data: { code: "const x = 1;" },
            },
          ],
        },
      ],
    };

    expect(extractRootCauseArtifact(state)).toBeNull();
  });

  test("finds root_cause in later blocks", () => {
    const state: AutofixExplorerState = {
      run_id: 123,
      status: "COMPLETED",
      blocks: [
        {
          id: "block-1",
          message: { role: "assistant", content: "Starting" },
          timestamp: "2025-01-01T00:00:00Z",
          artifacts: [{ key: "other", data: {} }],
        },
        {
          id: "block-2",
          message: { role: "assistant", content: "More analysis" },
          timestamp: "2025-01-01T00:01:00Z",
        },
        {
          id: "block-3",
          message: { role: "assistant", content: "Found it" },
          timestamp: "2025-01-01T00:02:00Z",
          artifacts: [
            {
              key: "root_cause",
              data: {
                one_line_description: "Memory leak in loop",
                five_whys: ["Objects not released"],
                reproduction_steps: ["Run loop 1000 times"],
              },
            },
          ],
        },
      ],
    };

    const artifact = extractRootCauseArtifact(state);
    expect(artifact?.data.one_line_description).toBe("Memory leak in loop");
  });
});
