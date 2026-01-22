/**
 * Issue Summary Output Formatters
 *
 * Formatting utilities for AI-generated issue summaries.
 */

import chalk from "chalk";
import type { IssueSummary } from "../../types/index.js";
import { cyan, green, muted, yellow } from "./colors.js";

const bold = (text: string): string => chalk.bold(text);

/**
 * Format an issue summary for human-readable output.
 *
 * @param summary - The issue summary from the API
 * @returns Array of formatted lines
 */
export function formatIssueSummary(summary: IssueSummary): string[] {
  const lines: string[] = [];

  // Headline
  lines.push("");
  lines.push(bold(summary.headline));
  lines.push("");

  // What's Wrong
  if (summary.whatsWrong) {
    lines.push(yellow("What's Wrong:"));
    lines.push(`  ${summary.whatsWrong}`);
    lines.push("");
  }

  // Trace
  if (summary.trace) {
    lines.push(cyan("Trace:"));
    lines.push(`  ${summary.trace}`);
    lines.push("");
  }

  // Possible Cause
  if (summary.possibleCause) {
    lines.push(green("Possible Cause:"));
    lines.push(`  ${summary.possibleCause}`);
    lines.push("");
  }

  // Confidence score
  if (summary.scores?.possibleCauseConfidence !== null) {
    const confidence = summary.scores?.possibleCauseConfidence;
    if (confidence !== undefined) {
      const percent = Math.round(confidence * 100);
      lines.push(muted(`Confidence: ${percent}%`));
    }
  }

  return lines;
}

/**
 * Format an issue summary header for display.
 *
 * @returns Array of header lines
 */
export function formatSummaryHeader(): string[] {
  return [bold("Issue Summary"), "═".repeat(60)];
}
