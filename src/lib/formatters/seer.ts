/**
 * Seer Output Formatters
 *
 * Formatting utilities for Seer Autofix command output.
 */

import chalk from "chalk";
import type {
  AutofixState,
  RootCause,
  SolutionArtifact,
} from "../../types/seer.js";
import { SeerError } from "../errors.js";
import { cyan, green, muted, yellow } from "./colors.js";

const bold = (text: string): string => chalk.bold(text);

// ─────────────────────────────────────────────────────────────────────────────
// Spinner Frames
// ─────────────────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Get a spinner frame for the given tick count.
 *
 * @param tick - Current animation tick (cycles through frames)
 * @returns Single spinner character for display
 */
export function getSpinnerFrame(tick: number): string {
  const index = tick % SPINNER_FRAMES.length;
  // biome-ignore lint/style/noNonNullAssertion: index is always valid due to modulo
  return SPINNER_FRAMES[index]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress Formatting
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum length for progress messages to fit in a single terminal line */
const MAX_PROGRESS_LENGTH = 300;

/**
 * Truncate a progress message to fit in a single terminal line.
 *
 * @param message - Progress message to truncate
 * @returns Truncated message with ellipsis if needed
 */
export function truncateProgressMessage(message: string): string {
  if (message.length <= MAX_PROGRESS_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_PROGRESS_LENGTH - 3)}...`;
}

/**
 * Format a progress message with spinner.
 *
 * @param message - Progress message to display
 * @param tick - Spinner tick count
 * @returns Formatted progress line
 */
export function formatProgressLine(message: string, tick: number): string {
  const spinner = cyan(getSpinnerFrame(tick));
  return `${spinner} ${message}`;
}

/**
 * Extract the latest progress message from autofix state.
 *
 * @param state - Current autofix state
 * @returns Latest progress message or default
 */
export function getProgressMessage(state: AutofixState): string {
  if (!state.steps) {
    return "Processing...";
  }

  // Find the most recent progress message
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const step = state.steps[i];
    if (step?.progress && step.progress.length > 0) {
      const lastProgress = step.progress.at(-1);
      if (lastProgress?.message) {
        return lastProgress.message;
      }
    }
  }

  // Fallback based on status
  switch (state.status) {
    case "PROCESSING":
      return "Analyzing issue...";
    case "COMPLETED":
      return "Analysis complete";
    case "ERROR":
      return "Analysis failed";
    default:
      return "Processing...";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Root Cause Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a single reproduction step.
 */
function formatReproductionStep(
  step: { title: string; code_snippet_and_analysis: string },
  index: number
): string[] {
  const lines: string[] = [];
  lines.push(`  ${index + 1}. ${step.title}`);

  // Indent the analysis
  const analysisLines = step.code_snippet_and_analysis
    .split("\n")
    .map((line) => `     ${line}`);
  lines.push(...analysisLines);

  return lines;
}

/**
 * Format a single root cause for display.
 *
 * @param cause - Root cause to format
 * @param index - Index for display (used as cause ID)
 * @returns Array of formatted lines
 */
export function formatRootCause(cause: RootCause, index: number): string[] {
  const lines: string[] = [];

  // Cause header
  lines.push(`${yellow(`Cause #${index}`)}: ${cause.description}`);

  // Relevant repositories
  if (cause.relevant_repos && cause.relevant_repos.length > 0) {
    lines.push(`  ${muted("Repository:")} ${cause.relevant_repos.join(", ")}`);
  }

  // Reproduction steps
  if (
    cause.root_cause_reproduction &&
    cause.root_cause_reproduction.length > 0
  ) {
    lines.push("");
    lines.push(`  ${muted("Reproduction:")}`);
    for (let i = 0; i < cause.root_cause_reproduction.length; i++) {
      const step = cause.root_cause_reproduction[i];
      if (step) {
        lines.push(...formatReproductionStep(step, i));
      }
    }
  }

  return lines;
}

/**
 * Format the root cause analysis header.
 *
 * @returns Array of formatted header lines
 */
export function formatRootCauseHeader(): string[] {
  return ["", green("Root Cause Analysis Complete"), muted("═".repeat(30)), ""];
}

/**
 * Format all root causes for display.
 *
 * @param causes - Array of root causes
 * @returns Array of formatted lines
 */
export function formatRootCauseList(causes: RootCause[]): string[] {
  const lines: string[] = [];

  lines.push(...formatRootCauseHeader());

  if (causes.length === 0) {
    lines.push(muted("No root causes identified."));
    return lines;
  }

  for (let i = 0; i < causes.length; i++) {
    const cause = causes[i];
    if (cause) {
      if (i > 0) {
        lines.push("");
      }
      lines.push(...formatRootCause(cause, i));
    }
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a SeerError from an API error status code and detail.
 *
 * @param status - HTTP status code
 * @param detail - Error detail from API
 * @param orgSlug - Organization slug for constructing settings URLs
 * @returns SeerError if the status code indicates a Seer-specific error, null otherwise
 */
export function createSeerError(
  status: number,
  detail?: string,
  orgSlug?: string
): SeerError | null {
  if (status === 402) {
    return new SeerError("no_budget", orgSlug);
  }
  if (status === 403) {
    if (detail?.includes("not enabled")) {
      return new SeerError("not_enabled", orgSlug);
    }
    if (detail?.includes("AI features")) {
      return new SeerError("ai_disabled", orgSlug);
    }
    return new SeerError("not_enabled", orgSlug); // default 403
  }
  return null;
}

/**
 * Convert an API error to a Seer-specific error or a generic error.
 *
 * @param status - HTTP status code
 * @param detail - Error detail from API
 * @param orgSlug - Organization slug for constructing settings URLs
 * @returns SeerError for Seer-specific errors, or a generic Error for other API errors
 */
export function handleSeerApiError(
  status: number,
  detail?: string,
  orgSlug?: string
): Error {
  const seerError = createSeerError(status, detail, orgSlug);
  if (seerError) {
    return seerError;
  }
  return new Error(formatAutofixError(status, detail));
}

/**
 * Format an error message for common autofix errors.
 *
 * @param status - HTTP status code
 * @param detail - Error detail from API
 * @returns User-friendly error message
 */
export function formatAutofixError(status: number, detail?: string): string {
  switch (status) {
    case 402:
      return "No budget for Seer Autofix. Check your billing plan.";
    case 403:
      if (detail?.includes("not enabled")) {
        return "Seer Autofix is not enabled for this organization.";
      }
      if (detail?.includes("AI features")) {
        return "AI features are disabled for this organization.";
      }
      return detail ?? "Seer Autofix is not available.";
    case 404:
      return "Issue not found.";
    default:
      return detail ?? "An error occurred with the autofix request.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Solution Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a solution artifact for human-readable display.
 *
 * Output format:
 * Solution
 * ════════════════════════════════════════════════════════════
 *
 * Summary:
 *   {one_line_summary}
 *
 * Steps to implement:
 *   1. {title}
 *      {description}
 *
 *   2. {title}
 *      {description}
 *   ...
 *
 * @param solution - Solution artifact from autofix
 * @returns Array of formatted lines
 */
export function formatSolution(solution: SolutionArtifact): string[] {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(bold("Solution"));
  lines.push("═".repeat(60));
  lines.push("");

  // Summary
  lines.push(yellow("Summary:"));
  lines.push(`  ${solution.data.one_line_summary}`);
  lines.push("");

  // Steps to implement
  if (solution.data.steps.length > 0) {
    lines.push(cyan("Steps to implement:"));
    lines.push("");
    for (let i = 0; i < solution.data.steps.length; i++) {
      const step = solution.data.steps[i];
      if (step) {
        lines.push(`  ${i + 1}. ${bold(step.title)}`);
        lines.push(`     ${muted(step.description)}`);
        lines.push("");
      }
    }
  }

  return lines;
}
