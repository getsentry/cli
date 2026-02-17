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
import { formatDurationMs } from "../profile/analyzer.js";
import { bold, muted, yellow } from "./colors.js";

/** Minimum width for header separator line */
const MIN_HEADER_WIDTH = 60;

/** Max width for the transaction column in the list table */
const TRANSACTION_COL_WIDTH = 50;

/** Max width for the location column in the hot paths table */
const LOCATION_COL_WIDTH = 30;

/**
 * Truncate a string from the middle, preserving start and end for context.
 *
 * @param str - String to truncate
 * @param maxLen - Maximum allowed length
 * @returns Truncated string with ellipsis in the middle, or original if short enough
 */
export function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  const ellipsis = "…";
  const sideLen = Math.floor((maxLen - ellipsis.length) / 2);
  return `${str.slice(0, sideLen)}${ellipsis}${str.slice(str.length - sideLen)}`;
}

/**
 * Find the longest common prefix among an array of strings,
 * trimmed to the last segment boundary (/ or .).
 *
 * @example
 * findCommonPrefix(["/api/0/organizations/foo/", "/api/0/projects/bar/"])
 * // => "/api/0/"
 */
export function findCommonPrefix(strings: string[]): string {
  if (strings.length <= 1) {
    return "";
  }

  const first = strings[0] ?? "";
  let prefix = first;

  for (const str of strings) {
    while (prefix.length > 0 && !str.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) {
      return "";
    }
  }

  // Trim to last segment boundary so we don't cut mid-word
  const lastSep = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("."));
  return lastSep >= 0 ? prefix.slice(0, lastSep + 1) : "";
}

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
    `  p75: ${formatDurationMs(percentiles.p75)}    ` +
      `p95: ${formatDurationMs(percentiles.p95)}    ` +
      `p99: ${formatDurationMs(percentiles.p99)}`
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
  const funcName = truncateMiddle(frame.name, 40).padEnd(40);
  const location = truncateMiddle(
    `${frame.file}:${frame.line}`,
    LOCATION_COL_WIDTH
  ).padEnd(LOCATION_COL_WIDTH);
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
  const locationHeader = "Location".padEnd(LOCATION_COL_WIDTH);
  lines.push(
    muted(`    #   ${"Function".padEnd(40)}  ${locationHeader}  % Time`)
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
  const txnHeader = "TRANSACTION".padEnd(TRANSACTION_COL_WIDTH);
  const tail = `${"SAMPLES".padStart(9)}  ${"p75".padStart(10)}  ${"p95".padStart(10)}`;
  if (hasAliases) {
    return muted(`  #   ALIAS   ${txnHeader}  ${tail}`);
  }
  return muted(`  ${txnHeader}  ${tail}`);
}

/**
 * Format a single transaction row for the list.
 * Transaction names are displayed with the common prefix stripped and
 * middle-truncated to keep both start and end visible.
 *
 * @param row - Profile function row data
 * @param options - Formatting options
 * @param options.alias - Optional alias entry for this transaction
 * @param options.commonPrefix - Common prefix stripped from all transaction names
 * @param options.hasAliases - Whether the table uses alias layout (keeps columns aligned even for rows without an alias)
 * @returns Formatted row string
 */
export function formatProfileListRow(
  row: ProfileFunctionRow,
  options: {
    alias?: TransactionAliasEntry;
    commonPrefix?: string;
    hasAliases?: boolean;
  } = {}
): string {
  const { alias, commonPrefix = "", hasAliases = false } = options;
  const samples = `${row["count_unique(timestamp)"] ?? 0}`.padStart(9);

  const rawP75 = row["p75(function.duration)"];
  const p75 = (
    rawP75 !== null && rawP75 !== undefined
      ? formatDurationMs(rawP75 / 1_000_000) // ns to ms
      : "-"
  ).padStart(10);

  const rawP95 = row["p95(function.duration)"];
  const p95 = (
    rawP95 !== null && rawP95 !== undefined
      ? formatDurationMs(rawP95 / 1_000_000) // ns to ms
      : "-"
  ).padStart(10);

  // Strip common prefix and apply smart truncation.
  // Only strip when the transaction actually starts with the prefix;
  // the "unknown" fallback does not share it.
  const rawTransaction = row.transaction ?? "unknown";
  const displayTransaction =
    commonPrefix && rawTransaction.startsWith(commonPrefix)
      ? rawTransaction.slice(commonPrefix.length)
      : rawTransaction;
  const transaction = truncateMiddle(
    displayTransaction,
    TRANSACTION_COL_WIDTH
  ).padEnd(TRANSACTION_COL_WIDTH);

  if (alias) {
    const idx = `${alias.idx}`.padStart(3);
    const aliasStr = alias.alias.padEnd(6);
    return `  ${idx}   ${aliasStr}  ${transaction}  ${samples}  ${p75}  ${p95}`;
  }

  // When the table has aliases but this row doesn't, pad to keep columns aligned
  if (hasAliases) {
    return `  ${"".padStart(3)}   ${"".padEnd(6)}  ${transaction}  ${samples}  ${p75}  ${p95}`;
  }

  return `  ${transaction}  ${samples}  ${p75}  ${p95}`;
}

/**
 * Compute the table divider width based on whether aliases are shown.
 */
export function profileListDividerWidth(hasAliases: boolean): number {
  // #(5) + sep(3) + alias(6) + sep(2) + txn(50) + sep(2) + samples(9) + sep(2) + p75(10) + sep(2) + p95(10) = 101
  return hasAliases ? 101 : 91;
}

/**
 * Format the footer tip for profile list command.
 *
 * @param hasAliases - Whether aliases are available for quick access
 * @param commonPrefix - If set, the common prefix that was stripped
 */
export function formatProfileListFooter(
  hasAliases = false,
  commonPrefix?: string
): string {
  const lines: string[] = [];

  if (commonPrefix) {
    lines.push(`\n${muted(`Common prefix stripped: ${commonPrefix}`)}`);
  }

  if (hasAliases) {
    lines.push(
      "\nTip: Use 'sentry profile view 1' or 'sentry profile view <alias>' to analyze."
    );
  } else {
    lines.push(
      "\nTip: Use 'sentry profile view \"<transaction>\"' to analyze."
    );
  }

  return lines.join("");
}
