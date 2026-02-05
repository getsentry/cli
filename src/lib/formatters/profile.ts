/**
 * Profile Formatters
 *
 * Human-readable output formatters for profiling data.
 * Formats flamegraph analysis, hot paths, and transaction lists.
 */

import type {
  ProfileAnalysis,
  ProfileFunctionRow,
  TransactionAliasEntry,
} from "../../types/index.js";
import { formatDuration } from "../profile/analyzer.js";
import { bold, muted, yellow } from "./colors.js";

/** Minimum width for header separator line */
const MIN_HEADER_WIDTH = 60;

/**
 * Format a section header with separator line.
 */
function formatSectionHeader(title: string): string[] {
  const width = Math.max(MIN_HEADER_WIDTH, title.length);
  return [title, muted("─".repeat(width))];
}

/**
 * Format the profile analysis header with transaction name and period.
 */
function formatProfileHeader(analysis: ProfileAnalysis): string[] {
  const header = `${analysis.transactionName}: CPU Profile Analysis (last ${analysis.period})`;
  const separatorWidth = Math.max(
    MIN_HEADER_WIDTH,
    Math.min(80, header.length)
  );
  return [header, muted("═".repeat(separatorWidth))];
}

/**
 * Format performance percentiles section.
 */
function formatPercentiles(analysis: ProfileAnalysis): string[] {
  const { percentiles } = analysis;
  const lines: string[] = [];

  lines.push("");
  lines.push(bold("Performance Percentiles"));
  lines.push(
    `  p75: ${formatDuration(percentiles.p75)}    ` +
      `p95: ${formatDuration(percentiles.p95)}    ` +
      `p99: ${formatDuration(percentiles.p99)}`
  );

  return lines;
}

/**
 * Format a single hot path row for the table.
 */
function formatHotPathRow(
  index: number,
  frame: { name: string; file: string; line: number },
  percentage: number
): string {
  const num = `${index + 1}`.padStart(3);
  const funcName = frame.name.slice(0, 40).padEnd(40);
  const location = `${frame.file}:${frame.line}`.slice(0, 20).padEnd(20);
  const pct = `${percentage.toFixed(1)}%`.padStart(7);

  return `  ${num}   ${funcName}  ${location}  ${pct}`;
}

/**
 * Format the hot paths table.
 */
function formatHotPaths(analysis: ProfileAnalysis): string[] {
  const { hotPaths, userCodeOnly } = analysis;
  const lines: string[] = [];

  lines.push("");
  const title = userCodeOnly
    ? `Hot Paths (Top ${hotPaths.length} by CPU time, user code only)`
    : `Hot Paths (Top ${hotPaths.length} by CPU time)`;
  lines.push(...formatSectionHeader(title));

  // Table header
  lines.push(
    muted(
      "    #   Function                                  File:Line             % Time"
    )
  );

  if (hotPaths.length === 0) {
    lines.push(muted("  No profile data available."));
    return lines;
  }

  // Table rows
  for (let i = 0; i < hotPaths.length; i++) {
    const hotPath = hotPaths[i];
    if (!hotPath) {
      continue;
    }
    const frame = hotPath.frames[0];
    if (!frame) {
      continue;
    }
    lines.push(
      formatHotPathRow(
        i,
        { name: frame.name, file: frame.file, line: frame.line },
        hotPath.percentage
      )
    );
  }

  return lines;
}

/**
 * Format recommendations based on hot paths.
 */
function formatRecommendations(analysis: ProfileAnalysis): string[] {
  const { hotPaths } = analysis;
  const lines: string[] = [];

  if (hotPaths.length === 0) {
    return lines;
  }

  const topHotPath = hotPaths[0];
  if (!topHotPath || topHotPath.percentage < 10) {
    return lines;
  }

  const topFrame = topHotPath.frames[0];
  if (!topFrame) {
    return lines;
  }

  lines.push("");
  lines.push(...formatSectionHeader("Recommendations"));
  lines.push(
    `  ${yellow("⚠")} ${topFrame.name} is consuming ${topHotPath.percentage.toFixed(1)}% of CPU time`
  );
  lines.push("    Consider optimizing this function or caching its results.");

  return lines;
}

/**
 * Format a complete profile analysis for human-readable output.
 *
 * @param analysis - The analyzed profile data
 * @returns Array of formatted lines
 */
export function formatProfileAnalysis(analysis: ProfileAnalysis): string[] {
  const lines: string[] = [];

  lines.push(...formatProfileHeader(analysis));
  lines.push(...formatPercentiles(analysis));
  lines.push(...formatHotPaths(analysis));
  lines.push(...formatRecommendations(analysis));

  return lines;
}

/**
 * Format the transaction list header for profile list command.
 *
 * @param orgProject - Organization/project display string
 * @param period - Time period being displayed
 * @returns Formatted header string
 */
export function formatProfileListHeader(
  orgProject: string,
  period: string
): string {
  return `Transactions with Profiles in ${orgProject} (last ${period}):`;
}

/**
 * Format the column headers for the transaction list table.
 *
 * @param hasAliases - Whether to include # and ALIAS columns
 */
export function formatProfileListTableHeader(hasAliases = false): string {
  if (hasAliases) {
    return muted(
      "  #   ALIAS   TRANSACTION                                    PROFILES       p75"
    );
  }
  return muted(
    "  TRANSACTION                                         PROFILES       p75"
  );
}

/**
 * Format a single transaction row for the list.
 *
 * @param row - Profile function row data
 * @param alias - Optional alias entry for this transaction
 * @returns Formatted row string
 */
export function formatProfileListRow(
  row: ProfileFunctionRow,
  alias?: TransactionAliasEntry
): string {
  const count = `${row["count()"] ?? 0}`.padStart(10);
  const p75Ms = row["p75(function.duration)"]
    ? formatDuration(row["p75(function.duration)"] / 1_000_000) // ns to ms
    : "-";
  const p75 = p75Ms.padStart(10);

  if (alias) {
    const idx = `${alias.idx}`.padStart(3);
    const aliasStr = alias.alias.padEnd(6);
    const transaction = (row.transaction ?? "unknown").slice(0, 42).padEnd(42);
    return `  ${idx}   ${aliasStr}  ${transaction}  ${count}  ${p75}`;
  }

  const transaction = (row.transaction ?? "unknown").slice(0, 48).padEnd(48);
  return `  ${transaction}  ${count}  ${p75}`;
}

/**
 * Format the footer tip for profile list command.
 *
 * @param hasAliases - Whether aliases are available for quick access
 */
export function formatProfileListFooter(hasAliases = false): string {
  if (hasAliases) {
    return "\nTip: Use 'sentry profile view 1' or 'sentry profile view <alias>' to analyze.";
  }
  return "\nTip: Use 'sentry profile view \"<transaction>\"' to analyze.";
}
