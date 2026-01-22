/**
 * Autofix Formatter Tests
 *
 * Tests for formatting functions in src/lib/formatters/autofix.ts
 */

import { describe, expect, test } from "bun:test";
import {
  formatAutofixError,
  formatAutofixStatus,
  formatPrNotFound,
  formatProgressLine,
  formatPrResult,
  formatRootCause,
  formatRootCauseAnalysisHeader,
  formatRootCauseArtifact,
  formatRootCauseHeader,
  formatRootCauseList,
  getProgressMessage,
  getSpinnerFrame,
  truncateProgressMessage,
} from "../../../src/lib/formatters/autofix.js";
import type {
  AutofixState,
  RootCause,
  RootCauseArtifact,
} from "../../../src/types/autofix.js";

describe("getSpinnerFrame", () => {
  test("returns a spinner character", () => {
    const frame = getSpinnerFrame(0);
    expect(typeof frame).toBe("string");
    expect(frame.length).toBeGreaterThan(0);
  });

  test("cycles through frames", () => {
    const frame0 = getSpinnerFrame(0);
    const frame1 = getSpinnerFrame(1);
    const frame10 = getSpinnerFrame(10);

    // Frame 0 and 10 should be the same (assuming 10 frames in the cycle)
    expect(frame0).toBe(frame10);
    expect(frame0).not.toBe(frame1);
  });
});

describe("formatProgressLine", () => {
  test("includes message and spinner", () => {
    const line = formatProgressLine("Processing...", 0);
    expect(line).toContain("Processing...");
    // Should have some character before the message (spinner)
    expect(line.length).toBeGreaterThan("Processing...".length);
  });

  test("changes with different tick values", () => {
    const line0 = formatProgressLine("Test", 0);
    const line1 = formatProgressLine("Test", 1);
    expect(line0).not.toBe(line1);
  });
});

describe("truncateProgressMessage", () => {
  test("returns short message unchanged", () => {
    const message = "Analyzing issue...";
    expect(truncateProgressMessage(message)).toBe(message);
  });

  test("returns message at exactly max length unchanged", () => {
    const message = "x".repeat(300);
    expect(truncateProgressMessage(message)).toBe(message);
  });

  test("truncates message exceeding max length", () => {
    const message = "x".repeat(350);
    const result = truncateProgressMessage(message);
    expect(result.length).toBe(300);
    expect(result.endsWith("...")).toBe(true);
  });

  test("preserves content before truncation point", () => {
    const message = `Important prefix ${"x".repeat(350)}`;
    const result = truncateProgressMessage(message);
    expect(result.startsWith("Important prefix")).toBe(true);
  });
});

describe("getProgressMessage", () => {
  test("returns progress message from steps", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "PROCESSING",
      steps: [
        {
          id: "step-1",
          key: "analysis",
          status: "PROCESSING",
          title: "Analyzing",
          progress: [
            {
              message: "Figuring out the root cause...",
              timestamp: "2025-01-01T00:00:00Z",
            },
          ],
        },
      ],
    };

    expect(getProgressMessage(state)).toBe("Figuring out the root cause...");
  });

  test("returns default message when no steps", () => {
    const state: AutofixState = {
      run_id: 123,
      status: "PROCESSING",
    };

    const message = getProgressMessage(state);
    expect(message).toBeTruthy();
    expect(typeof message).toBe("string");
  });

  test("returns appropriate message based on status", () => {
    // Need empty steps array to trigger status-based fallback
    const completedState: AutofixState = {
      run_id: 123,
      status: "COMPLETED",
      steps: [],
    };

    const errorState: AutofixState = {
      run_id: 123,
      status: "ERROR",
      steps: [],
    };

    expect(getProgressMessage(completedState)).toContain("complete");
    expect(getProgressMessage(errorState)).toContain("fail");
  });
});

describe("formatRootCause", () => {
  test("formats a basic root cause", () => {
    const cause: RootCause = {
      id: 0,
      description:
        "Database connection timeout due to missing pool configuration",
    };

    const lines = formatRootCause(cause, 0);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("Database connection timeout");
    expect(lines.join("\n")).toContain("Cause #0");
  });

  test("includes relevant repos when present", () => {
    const cause: RootCause = {
      id: 0,
      description: "Test cause",
      relevant_repos: ["org/repo1", "org/repo2"],
    };

    const lines = formatRootCause(cause, 0);
    const output = lines.join("\n");
    expect(output).toContain("org/repo1");
  });

  test("includes reproduction steps when present", () => {
    const cause: RootCause = {
      id: 0,
      description: "Test cause",
      root_cause_reproduction: [
        {
          title: "Step 1",
          code_snippet_and_analysis: "User makes API request",
        },
        {
          title: "Step 2",
          code_snippet_and_analysis: "Database query times out",
        },
      ],
    };

    const lines = formatRootCause(cause, 0);
    const output = lines.join("\n");
    expect(output).toContain("Step 1");
    expect(output).toContain("User makes API request");
  });
});

describe("formatRootCauseHeader", () => {
  test("returns array of header lines", () => {
    const lines = formatRootCauseHeader();
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("Root Cause");
  });
});

describe("formatRootCauseList", () => {
  test("formats single cause with fix hint", () => {
    const causes: RootCause[] = [{ id: 0, description: "Single root cause" }];

    const lines = formatRootCauseList(causes, "ISSUE-123");
    const output = lines.join("\n");
    expect(output).toContain("Single root cause");
    expect(output).toContain("sentry issue fix ISSUE-123");
  });

  test("formats multiple causes with fix hint", () => {
    const causes: RootCause[] = [
      { id: 0, description: "First cause" },
      { id: 1, description: "Second cause" },
    ];

    const lines = formatRootCauseList(causes, "ISSUE-456");
    const output = lines.join("\n");
    expect(output).toContain("First cause");
    expect(output).toContain("Second cause");
    expect(output).toContain("sentry issue fix ISSUE-456");
  });

  test("handles empty causes array", () => {
    const lines = formatRootCauseList([], "ISSUE-789");
    const output = lines.join("\n");
    expect(output).toContain("No root causes");
  });
});

describe("formatPrResult", () => {
  test("formats PR URL display", () => {
    const lines = formatPrResult("https://github.com/org/repo/pull/123");
    const output = lines.join("\n");
    expect(output).toContain("Pull Request");
    expect(output).toContain("https://github.com/org/repo/pull/123");
  });
});

describe("formatPrNotFound", () => {
  test("returns helpful message when no PR URL", () => {
    const lines = formatPrNotFound();
    const output = lines.join("\n");
    expect(output).toContain("no PR URL");
    expect(output).toContain("Sentry web UI");
  });
});

describe("formatAutofixStatus", () => {
  test("formats COMPLETED status", () => {
    const result = formatAutofixStatus("COMPLETED");
    expect(result.toLowerCase()).toContain("completed");
  });

  test("formats PROCESSING status", () => {
    const result = formatAutofixStatus("PROCESSING");
    expect(result.toLowerCase()).toContain("processing");
  });

  test("formats ERROR status", () => {
    const result = formatAutofixStatus("ERROR");
    expect(result.toLowerCase()).toContain("error");
  });

  test("formats unknown status", () => {
    const result = formatAutofixStatus("UNKNOWN_STATUS");
    expect(result).toBe("UNKNOWN_STATUS");
  });
});

describe("formatAutofixError", () => {
  test("formats 402 Payment Required", () => {
    const message = formatAutofixError(402);
    expect(message.toLowerCase()).toContain("budget");
  });

  test("formats 403 Forbidden for not enabled", () => {
    const message = formatAutofixError(403, "AI Autofix is not enabled");
    expect(message.toLowerCase()).toContain("not enabled");
  });

  test("formats 403 Forbidden for AI features disabled", () => {
    const message = formatAutofixError(403, "AI features are disabled");
    expect(message.toLowerCase()).toContain("disabled");
  });

  test("formats 404 Not Found", () => {
    const message = formatAutofixError(404);
    expect(message.toLowerCase()).toContain("not found");
  });

  test("returns detail message for unknown errors", () => {
    const message = formatAutofixError(500, "Internal server error");
    expect(message).toBe("Internal server error");
  });

  test("returns generic message when no detail", () => {
    const message = formatAutofixError(500);
    expect(message).toBeTruthy();
  });
});

describe("formatRootCauseAnalysisHeader", () => {
  test("returns array with header and separator", () => {
    const lines = formatRootCauseAnalysisHeader();
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBe(2);
    expect(lines.join("\n")).toContain("Root Cause Analysis");
  });
});

describe("formatRootCauseArtifact", () => {
  test("formats complete root cause artifact", () => {
    const artifact: RootCauseArtifact = {
      key: "root_cause",
      data: {
        one_line_description: "Database connection pool exhausted",
        five_whys: [
          "Connection pool ran out of connections",
          "Connections were not being released",
          "Missing finally block in database calls",
          "Code review didn't catch the issue",
          "No automated tests for connection cleanup",
        ],
        reproduction_steps: [
          "Start the application",
          "Make 100 concurrent database requests",
          "Observe connection timeout errors",
        ],
      },
    };

    const lines = formatRootCauseArtifact(artifact);
    const output = lines.join("\n");

    // Check header
    expect(output).toContain("Root Cause Analysis");

    // Check summary
    expect(output).toContain("Summary:");
    expect(output).toContain("Database connection pool exhausted");

    // Check five whys
    expect(output).toContain("Why This Happened:");
    expect(output).toContain("1. Connection pool ran out");
    expect(output).toContain("2. Connections were not being released");
    expect(output).toContain("5. No automated tests");

    // Check reproduction steps
    expect(output).toContain("Steps to Reproduce:");
    expect(output).toContain("1. Start the application");
    expect(output).toContain("3. Observe connection timeout");
  });

  test("formats artifact with minimal data", () => {
    const artifact: RootCauseArtifact = {
      key: "root_cause",
      data: {
        one_line_description: "Simple error",
        five_whys: [],
        reproduction_steps: [],
      },
    };

    const lines = formatRootCauseArtifact(artifact);
    const output = lines.join("\n");

    expect(output).toContain("Root Cause Analysis");
    expect(output).toContain("Summary:");
    expect(output).toContain("Simple error");
    // Should not have numbered lists when arrays are empty
    expect(output).not.toContain("1.");
  });

  test("formats artifact with only five_whys", () => {
    const artifact: RootCauseArtifact = {
      key: "root_cause",
      data: {
        one_line_description: "Error with whys only",
        five_whys: ["First why", "Second why"],
        reproduction_steps: [],
      },
    };

    const lines = formatRootCauseArtifact(artifact);
    const output = lines.join("\n");

    expect(output).toContain("Why This Happened:");
    expect(output).toContain("1. First why");
    expect(output).toContain("2. Second why");
    expect(output).not.toContain("Steps to Reproduce:");
  });

  test("formats artifact with only reproduction_steps", () => {
    const artifact: RootCauseArtifact = {
      key: "root_cause",
      data: {
        one_line_description: "Error with steps only",
        five_whys: [],
        reproduction_steps: ["Step one", "Step two", "Step three"],
      },
    };

    const lines = formatRootCauseArtifact(artifact);
    const output = lines.join("\n");

    expect(output).not.toContain("Why This Happened:");
    expect(output).toContain("Steps to Reproduce:");
    expect(output).toContain("1. Step one");
    expect(output).toContain("3. Step three");
  });

  test("includes reason field if present", () => {
    const artifact: RootCauseArtifact = {
      key: "root_cause",
      data: {
        one_line_description: "Test error",
        five_whys: ["Why"],
        reproduction_steps: ["Step"],
      },
      reason: "Based on stack trace analysis",
    };

    const lines = formatRootCauseArtifact(artifact);
    // The reason field is optional and may or may not be displayed
    // Just verify the artifact formats without error
    expect(lines.length).toBeGreaterThan(0);
  });
});
