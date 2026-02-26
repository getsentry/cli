/**
 * Human-readable output formatters
 *
 * Centralized formatting utilities for consistent CLI output.
 * Detail views (issue, event, org, project) are built as markdown and rendered
 * via renderMarkdown(). List rows still use lightweight inline formatting for
 * performance, while list tables are rendered via writeTable() → renderMarkdown().
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import prettyMs from "pretty-ms";
import type {
  BreadcrumbsEntry,
  ExceptionEntry,
  ExceptionValue,
  IssueStatus,
  RequestEntry,
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
  StackFrame,
  TraceSpan,
} from "../../types/index.js";
import { withSerializeSpan } from "../telemetry.js";
import {
  boldUnderline,
  type FixabilityTier,
  fixabilityColor,
  green,
  levelColor,
  muted,
  statusColor,
  yellow,
} from "./colors.js";
import {
  escapeMarkdownCell,
  renderMarkdown,
  safeCodeSpan,
} from "./markdown.js";

// Status Formatting

const STATUS_ICONS: Record<IssueStatus, string> = {
  resolved: green("✓"),
  unresolved: yellow("●"),
  ignored: muted("−"),
};

const STATUS_LABELS: Record<IssueStatus, string> = {
  resolved: `${green("✓")} Resolved`,
  unresolved: `${yellow("●")} Unresolved`,
  ignored: `${muted("−")} Ignored`,
};

/** Maximum features to display before truncating with "... and N more" */
const MAX_DISPLAY_FEATURES = 10;

/**
 * Capitalize the first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert Seer fixability score to a tier label.
 *
 * Thresholds are simplified from Sentry core (sentry/seer/autofix/constants.py)
 * into 3 tiers for CLI display.
 *
 * @param score - Numeric fixability score (0-1)
 * @returns `"high"` | `"med"` | `"low"`
 */
export function getSeerFixabilityLabel(score: number): FixabilityTier {
  if (score > 0.66) {
    return "high";
  }
  if (score > 0.33) {
    return "med";
  }
  return "low";
}

/**
 * Format fixability score as "label(pct%)" for compact list display.
 *
 * @param score - Numeric fixability score, or null/undefined if unavailable
 * @returns Formatted string like `"med(50%)"`, or `""` when score is unavailable
 */
export function formatFixability(score: number | null | undefined): string {
  if (score === null || score === undefined) {
    return "";
  }
  const label = getSeerFixabilityLabel(score);
  const pct = Math.round(score * 100);
  return `${label}(${pct}%)`;
}

/**
 * Format fixability score for detail view: "Label (pct%)".
 *
 * Uses capitalized label with space before parens for readability
 * in the single-issue detail display.
 *
 * @param score - Numeric fixability score, or null/undefined if unavailable
 * @returns Formatted string like `"Med (50%)"`, or `""` when score is unavailable
 */
export function formatFixabilityDetail(
  score: number | null | undefined
): string {
  if (score === null || score === undefined) {
    return "";
  }
  const label = getSeerFixabilityLabel(score);
  const pct = Math.round(score * 100);
  return `${capitalize(label)} (${pct}%)`;
}

/** Map of entry type strings to their TypeScript types */
type EntryTypeMap = {
  exception: ExceptionEntry;
  breadcrumbs: BreadcrumbsEntry;
  request: RequestEntry;
};

/**
 * Extract a typed entry from event entries by type
 * @returns The entry if found, null otherwise
 */
function extractEntry<T extends keyof EntryTypeMap>(
  event: SentryEvent,
  type: T
): EntryTypeMap[T] | null {
  if (!event.entries) {
    return null;
  }
  for (const entry of event.entries) {
    if (
      entry &&
      typeof entry === "object" &&
      "type" in entry &&
      entry.type === type
    ) {
      return entry as EntryTypeMap[T];
    }
  }
  return null;
}

/** Regex to extract base URL from a permalink */
const BASE_URL_REGEX = /^(https?:\/\/[^/]+)/;

/**
 * Format a features list as a markdown bullet list.
 *
 * @param features - Array of feature names (may be undefined)
 * @returns Markdown string, or empty string if no features
 */
function formatFeaturesMarkdown(features: string[] | undefined): string {
  if (!features || features.length === 0) {
    return "";
  }

  const displayFeatures = features.slice(0, MAX_DISPLAY_FEATURES);
  const items = displayFeatures.map((f) => `- ${f}`).join("\n");
  const more =
    features.length > MAX_DISPLAY_FEATURES
      ? `\n*... and ${features.length - MAX_DISPLAY_FEATURES} more*`
      : "";

  return `\n**Features** (${features.length}):\n\n${items}${more}`;
}

/**
 * Get status icon for an issue status
 */
export function formatStatusIcon(status: string | undefined): string {
  if (!status) {
    return statusColor("●", status);
  }
  return STATUS_ICONS[status as IssueStatus] ?? statusColor("●", status);
}

/**
 * Get full status label for an issue status
 */
export function formatStatusLabel(status: string | undefined): string {
  if (!status) {
    return `${statusColor("●", status)} Unknown`;
  }
  return (
    STATUS_LABELS[status as IssueStatus] ??
    `${statusColor("●", status)} Unknown`
  );
}

// Date Formatting

/**
 * Format a date as relative time (e.g., "2h ago", "3d ago") or short date for older dates.
 *
 * - < 1 hour: "Xm ago"
 * - < 24 hours: "Xh ago"
 * - < 3 days: "Xd ago"
 * - >= 3 days: Short date (e.g., "Jan 18")
 */
export function formatRelativeTime(dateString: string | undefined): string {
  if (!dateString) {
    return muted("—").padEnd(10);
  }

  const date = new Date(dateString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  let text: string;
  if (diffMins < 60) {
    text = `${diffMins}m ago`;
  } else if (diffHours < 24) {
    text = `${diffHours}h ago`;
  } else if (diffDays < 3) {
    text = `${diffDays}d ago`;
  } else {
    // Short date: "Jan 18"
    text = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return text.padEnd(10);
}

// Issue Formatting

/** Column widths for issue list table */
const COL_LEVEL = 7;
const COL_ALIAS = 15;
const COL_SHORT_ID = 22;
const COL_COUNT = 5;
const COL_SEEN = 10;
/** Width for the FIXABILITY column (longest value "high(100%)" = 10) */
const COL_FIX = 10;

/** Quantifier suffixes indexed by groups of 3 digits (K=10^3, M=10^6, …, E=10^18) */
const QUANTIFIERS = ["", "K", "M", "B", "T", "P", "E"];

/**
 * Abbreviate large numbers to fit within {@link COL_COUNT} characters.
 * Uses K/M/B/T/P/E suffixes up to 10^18 (exa).
 *
 * The decimal is only shown when the rounded value is < 100 (e.g. "12.3K",
 * "1.5M" but not "100M"). The result is always exactly COL_COUNT chars wide.
 *
 * Note: `Number(raw)` loses precision above `Number.MAX_SAFE_INTEGER`
 * (~9P / 9×10^15), which is far beyond any realistic Sentry event count.
 *
 * Examples: 999 → "  999", 12345 → "12.3K", 150000 → " 150K", 1500000 → "1.5M"
 */
function abbreviateCount(raw: string): string {
  const n = Number(raw);
  if (Number.isNaN(n)) {
    // Non-numeric input: use a placeholder rather than passing through an
    // arbitrarily wide string that would break column alignment
    Sentry.logger.warn(`Unexpected non-numeric issue count: ${raw}`);
    return "?".padStart(COL_COUNT);
  }
  if (raw.length <= COL_COUNT) {
    return raw.padStart(COL_COUNT);
  }
  const tier = Math.min(Math.floor(Math.log10(n) / 3), QUANTIFIERS.length - 1);
  const suffix = QUANTIFIERS[tier] ?? "";
  const scaled = n / 10 ** (tier * 3);
  // Only show decimal when it adds information — compare the rounded value to avoid
  // "100.0K" when scaled is e.g. 99.95 (toFixed(1) rounds up to "100.0")
  const rounded1dp = Number(scaled.toFixed(1));
  if (rounded1dp < 100) {
    return `${rounded1dp.toFixed(1)}${suffix}`.padStart(COL_COUNT);
  }
  const rounded = Math.round(scaled);
  // Promote to next tier if rounding produces >= 1000 (e.g. 999.95K → "1.0M")
  if (rounded >= 1000 && tier < QUANTIFIERS.length - 1) {
    const nextSuffix = QUANTIFIERS[tier + 1] ?? "";
    return `${(rounded / 1000).toFixed(1)}${nextSuffix}`.padStart(COL_COUNT);
  }
  // At max tier with no promotion available: cap at 999 to guarantee COL_COUNT width
  // (numbers > 10^21 are unreachable in practice for Sentry event counts)
  return `${Math.min(rounded, 999)}${suffix}`.padStart(COL_COUNT);
}

/** Column where title starts in single-project mode (no ALIAS column) */
const TITLE_START_COL =
  COL_LEVEL + 1 + COL_SHORT_ID + 1 + COL_COUNT + 2 + COL_SEEN + 2 + COL_FIX + 2;

/** Column where title starts in multi-project mode (with ALIAS column) */
const TITLE_START_COL_MULTI =
  COL_LEVEL +
  1 +
  COL_ALIAS +
  1 +
  COL_SHORT_ID +
  1 +
  COL_COUNT +
  2 +
  COL_SEEN +
  2 +
  COL_FIX +
  2;

/**
 * Format the header row for issue list table.
 * Uses same column widths as data rows to ensure alignment.
 *
 * @param isMultiProject - Whether to include ALIAS column for multi-project mode
 */
export function formatIssueListHeader(isMultiProject = false): string {
  if (isMultiProject) {
    return (
      "LEVEL".padEnd(COL_LEVEL) +
      " " +
      "ALIAS".padEnd(COL_ALIAS) +
      " " +
      "SHORT ID".padEnd(COL_SHORT_ID) +
      " " +
      "COUNT".padStart(COL_COUNT) +
      "  " +
      "SEEN".padEnd(COL_SEEN) +
      "  " +
      "FIXABILITY".padEnd(COL_FIX) +
      "  " +
      "TITLE"
    );
  }
  return (
    "LEVEL".padEnd(COL_LEVEL) +
    " " +
    "SHORT ID".padEnd(COL_SHORT_ID) +
    " " +
    "COUNT".padStart(COL_COUNT) +
    "  " +
    "SEEN".padEnd(COL_SEEN) +
    "  " +
    "FIXABILITY".padEnd(COL_FIX) +
    "  " +
    "TITLE"
  );
}

/**
 * Wrap long text with indentation for continuation lines.
 * Breaks at word boundaries when possible.
 *
 * @param text - Text to wrap
 * @param startCol - Column where text starts (for indenting continuation lines)
 * @param termWidth - Terminal width
 */
function wrapTitle(text: string, startCol: number, termWidth: number): string {
  const availableWidth = termWidth - startCol;

  // No wrapping needed or terminal too narrow
  if (text.length <= availableWidth || availableWidth < 20) {
    return text;
  }

  const indent = " ".repeat(startCol);
  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= availableWidth) {
      lines.push(remaining);
      break;
    }

    // Find break point (prefer word boundary)
    let breakAt = availableWidth;
    const lastSpace = remaining.lastIndexOf(" ", availableWidth);
    if (lastSpace > availableWidth * 0.5) {
      breakAt = lastSpace;
    }

    lines.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }

  // First line has no indent, continuation lines do
  return lines.join(`\n${indent}`);
}

/**
 * Options for formatting short IDs with alias highlighting.
 */
export type FormatShortIdOptions = {
  /** Project slug to determine the prefix for suffix highlighting */
  projectSlug?: string;
  /** Project alias (e.g., "e", "w", "o1:d") for multi-project display */
  projectAlias?: string;
  /** Whether in multi-project mode (shows ALIAS column) */
  isMultiProject?: boolean;
};

/**
 * Format short ID for multi-project mode by highlighting the alias characters.
 * Only highlights the specific characters that form the alias:
 * - CLI-25 with alias "c" → **C**LI-**25**
 * - CLI-WEBSITE-4 with alias "w" → CLI-**W**EBSITE-**4**
 * - API-APP-5 with alias "ap" → API-**AP**P-**5** (searches backwards to find correct part)
 * - X-AB-5 with alias "x-a" → **X-A**B-**5** (handles aliases with embedded dashes)
 *
 * @returns Formatted string if alias matches, null otherwise (to fall back to default)
 */
function formatShortIdWithAlias(
  upperShortId: string,
  projectAlias: string
): string | null {
  // Extract project part of alias (handle "o1/d" format for collision cases)
  const aliasProjectPart = projectAlias.includes("/")
    ? projectAlias.split("/").pop()
    : projectAlias;

  if (!aliasProjectPart) {
    return null;
  }

  const parts = upperShortId.split("-");
  if (parts.length < 2) {
    return null;
  }

  const aliasUpper = aliasProjectPart.toUpperCase();
  const aliasLen = aliasUpper.length;
  const projectParts = parts.slice(0, -1);
  const issueSuffix = parts.at(-1) ?? "";

  // Method 1: For aliases without dashes, search backwards through project parts
  // This handles cases like "api-app" where alias "ap" should match "APP" not "API"
  if (!aliasUpper.includes("-")) {
    for (let i = projectParts.length - 1; i >= 0; i--) {
      const part = projectParts[i];
      if (part?.startsWith(aliasUpper)) {
        // Found match - highlight alias prefix in this part and the issue suffix
        const result = projectParts.map((p, idx) => {
          if (idx === i) {
            return boldUnderline(p.slice(0, aliasLen)) + p.slice(aliasLen);
          }
          return p;
        });
        return `${result.join("-")}-${boldUnderline(issueSuffix)}`;
      }
    }
  }

  // Method 2: For aliases with dashes (or if Method 1 found no match),
  // match against the joined project portion
  const projectPortion = projectParts.join("-");
  if (projectPortion.startsWith(aliasUpper)) {
    // Highlight first aliasLen chars of project portion, plus issue suffix
    const highlighted = boldUnderline(projectPortion.slice(0, aliasLen));
    const rest = projectPortion.slice(aliasLen);
    return `${highlighted}${rest}-${boldUnderline(issueSuffix)}`;
  }

  return null;
}

/**
 * Format a short ID with highlighting to show what the user can type as shorthand.
 *
 * - Single project: CLI-25 → CLI-**25** (suffix highlighted)
 * - Multi-project: CLI-WEBSITE-4 with alias "w" → CLI-**W**EBSITE-**4** (alias chars highlighted)
 *
 * @param shortId - Full short ID (e.g., "CLI-25", "CLI-WEBSITE-4")
 * @param options - Formatting options (projectSlug, projectAlias, isMultiProject)
 * @returns Formatted short ID with highlights
 */
export function formatShortId(
  shortId: string,
  options?: FormatShortIdOptions | string
): string {
  // Handle legacy string parameter (projectSlug only)
  const opts: FormatShortIdOptions =
    typeof options === "string" ? { projectSlug: options } : (options ?? {});

  const { projectSlug, projectAlias, isMultiProject } = opts;
  const upperShortId = shortId.toUpperCase();

  // In multi-project mode with an alias, highlight the part that the alias represents
  if (isMultiProject && projectAlias) {
    const formatted = formatShortIdWithAlias(upperShortId, projectAlias);
    if (formatted) {
      return formatted;
    }
  }

  // Single-project mode or fallback: highlight just the issue suffix
  if (projectSlug) {
    const prefix = `${projectSlug.toUpperCase()}-`;
    if (upperShortId.startsWith(prefix)) {
      const suffix = shortId.slice(prefix.length);
      return `${prefix}${boldUnderline(suffix.toUpperCase())}`;
    }
  }

  return upperShortId;
}

/**
 * Calculate the raw display length of a formatted short ID (without ANSI codes).
 * In all modes, we display the full shortId (just with different styling).
 */
function getShortIdDisplayLength(shortId: string): number {
  return shortId.length;
}

/**
 * Compute the alias shorthand for an issue (e.g., "o1:d-a3", "w-2a").
 * This is what users type to reference the issue.
 *
 * @param shortId - Full short ID (e.g., "DASHBOARD-A3")
 * @param projectAlias - Project alias (e.g., "o1:d", "w")
 * @returns Alias shorthand (e.g., "o1:d-a3", "w-2a") or empty string if no alias
 */
function computeAliasShorthand(shortId: string, projectAlias?: string): string {
  if (!projectAlias) {
    return "";
  }
  const suffix = shortId.split("-").pop()?.toLowerCase() ?? "";
  return `${projectAlias}-${suffix}`;
}

/**
 * Format a single issue for list display.
 * Wraps long titles with proper indentation.
 *
 * @param issue - Issue to format
 * @param termWidth - Terminal width for wrapping (default 80)
 * @param shortIdOptions - Options for formatting the short ID (projectSlug and/or projectAlias)
 */
export function formatIssueRow(
  issue: SentryIssue,
  termWidth = 80,
  shortIdOptions?: FormatShortIdOptions | string
): string {
  // Handle legacy string parameter (projectSlug only)
  const opts: FormatShortIdOptions =
    typeof shortIdOptions === "string"
      ? { projectSlug: shortIdOptions }
      : (shortIdOptions ?? {});

  const { isMultiProject, projectAlias } = opts;

  const levelText = (issue.level ?? "unknown").toUpperCase().padEnd(COL_LEVEL);
  const level = levelColor(levelText, issue.level);
  const formattedShortId = formatShortId(issue.shortId, opts);

  // Calculate raw display length (without ANSI codes) for padding
  const rawLen = getShortIdDisplayLength(issue.shortId);
  const shortIdPadding = " ".repeat(Math.max(0, COL_SHORT_ID - rawLen));
  const shortId = `${formattedShortId}${shortIdPadding}`;
  const count = abbreviateCount(`${issue.count}`);
  const seen = formatRelativeTime(issue.lastSeen);

  // Fixability column (color applied after padding to preserve alignment)
  const fixText = formatFixability(issue.seerFixabilityScore);
  const fixPadding = " ".repeat(Math.max(0, COL_FIX - fixText.length));
  const score = issue.seerFixabilityScore;
  const fix =
    fixText && score !== null && score !== undefined
      ? fixabilityColor(fixText, getSeerFixabilityLabel(score)) + fixPadding
      : fixPadding;

  // Multi-project mode: include ALIAS column
  if (isMultiProject) {
    const aliasShorthand = computeAliasShorthand(issue.shortId, projectAlias);
    const aliasPadding = " ".repeat(
      Math.max(0, COL_ALIAS - aliasShorthand.length)
    );
    const alias = `${aliasShorthand}${aliasPadding}`;
    const title = wrapTitle(issue.title, TITLE_START_COL_MULTI, termWidth);
    return `${level} ${alias} ${shortId} ${count}  ${seen}  ${fix}  ${title}`;
  }

  const title = wrapTitle(issue.title, TITLE_START_COL, termWidth);
  return `${level} ${shortId} ${count}  ${seen}  ${fix}  ${title}`;
}

/**
 * Format detailed issue information as rendered markdown.
 *
 * @param issue - The Sentry issue to format
 * @returns Rendered terminal string
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: issue formatting logic
export function formatIssueDetails(issue: SentryIssue): string {
  const lines: string[] = [];

  lines.push(`## ${issue.shortId}: ${issue.title}`);
  lines.push("");

  // Key-value details as a table
  const rows: string[] = [];

  rows.push(
    `| **Status** | ${formatStatusLabel(issue.status)}${issue.substatus ? ` (${capitalize(issue.substatus)})` : ""} |`
  );

  if (issue.priority) {
    rows.push(`| **Priority** | ${capitalize(issue.priority)} |`);
  }

  if (
    issue.seerFixabilityScore !== null &&
    issue.seerFixabilityScore !== undefined
  ) {
    const tier = getSeerFixabilityLabel(issue.seerFixabilityScore);
    const fixDetail = formatFixabilityDetail(issue.seerFixabilityScore);
    rows.push(`| **Fixability** | ${fixabilityColor(fixDetail, tier)} |`);
  }

  let levelLine = issue.level ?? "unknown";
  if (issue.isUnhandled) {
    levelLine += " (unhandled)";
  }
  rows.push(`| **Level** | ${levelLine} |`);
  rows.push(
    `| **Platform** | ${escapeMarkdownCell(issue.platform ?? "unknown")} |`
  );
  rows.push(`| **Type** | ${escapeMarkdownCell(issue.type ?? "unknown")} |`);
  rows.push(
    `| **Assignee** | ${escapeMarkdownCell(String(issue.assignedTo?.name ?? "Unassigned"))} |`
  );

  if (issue.project) {
    rows.push(
      `| **Project** | ${escapeMarkdownCell(issue.project.name ?? "(unknown)")} (${safeCodeSpan(issue.project.slug ?? "")}) |`
    );
  }

  const firstReleaseVersion = issue.firstRelease?.shortVersion;
  const lastReleaseVersion = issue.lastRelease?.shortVersion;
  if (firstReleaseVersion || lastReleaseVersion) {
    const first = escapeMarkdownCell(String(firstReleaseVersion ?? ""));
    const last = escapeMarkdownCell(String(lastReleaseVersion ?? ""));
    if (firstReleaseVersion && lastReleaseVersion) {
      if (firstReleaseVersion === lastReleaseVersion) {
        rows.push(`| **Release** | ${first} |`);
      } else {
        rows.push(`| **Releases** | ${first} → ${last} |`);
      }
    } else if (lastReleaseVersion) {
      rows.push(`| **Release** | ${last} |`);
    } else if (firstReleaseVersion) {
      rows.push(`| **Release** | ${first} |`);
    }
  }

  rows.push(`| **Events** | ${issue.count ?? 0} |`);
  rows.push(`| **Users** | ${issue.userCount ?? 0} |`);

  if (issue.firstSeen) {
    let firstSeenLine = new Date(issue.firstSeen).toLocaleString();
    if (firstReleaseVersion) {
      firstSeenLine += ` (in ${firstReleaseVersion})`;
    }
    rows.push(`| **First seen** | ${firstSeenLine} |`);
  }
  if (issue.lastSeen) {
    let lastSeenLine = new Date(issue.lastSeen).toLocaleString();
    if (lastReleaseVersion && lastReleaseVersion !== firstReleaseVersion) {
      lastSeenLine += ` (in ${lastReleaseVersion})`;
    }
    rows.push(`| **Last seen** | ${lastSeenLine} |`);
  }

  if (issue.culprit) {
    rows.push(`| **Culprit** | ${safeCodeSpan(issue.culprit)} |`);
  }

  rows.push(`| **Link** | ${escapeMarkdownCell(issue.permalink ?? "")} |`);

  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(...rows);

  if (issue.metadata?.value) {
    lines.push("");
    lines.push("**Message:**");
    lines.push("");
    lines.push(`> ${issue.metadata.value.replace(/\n/g, "\n> ")}`);
  }

  if (issue.metadata?.filename) {
    lines.push("");
    lines.push(`**File:** \`${issue.metadata.filename}\``);
  }
  if (issue.metadata?.function) {
    lines.push(`**Function:** \`${issue.metadata.function}\``);
  }

  return renderMarkdown(lines.join("\n"));
}

// Stack Trace Formatting

/**
 * Format a single stack frame as markdown.
 */
function formatStackFrameMarkdown(frame: StackFrame): string {
  const lines: string[] = [];
  const fn = frame.function || "<anonymous>";
  const file = frame.filename || frame.absPath || "<unknown>";
  const line = frame.lineNo ?? "?";
  const col = frame.colNo ?? "?";
  const inAppTag = frame.inApp ? " `[in-app]`" : "";

  lines.push(`\`at ${fn} (${file}:${line}:${col})\`${inAppTag}`);

  if (frame.context && frame.context.length > 0) {
    lines.push("");
    lines.push("```");
    for (const [lineNo, code] of frame.context) {
      const isCurrentLine = lineNo === frame.lineNo;
      const prefix = isCurrentLine ? ">" : " ";
      lines.push(`${prefix} ${String(lineNo).padStart(6)} | ${code}`);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format an exception value (type, message, stack trace) as markdown.
 */
function formatExceptionValueMarkdown(exception: ExceptionValue): string {
  const lines: string[] = [];

  const type = exception.type || "Error";
  const value = exception.value || "";
  lines.push(`**\`${type}: ${value}\`**`);

  if (exception.mechanism) {
    const handled = exception.mechanism.handled ? "handled" : "unhandled";
    const mechType = exception.mechanism.type || "unknown";
    lines.push(`*mechanism: ${mechType} (${handled})*`);
  }
  lines.push("");

  const frames = exception.stacktrace?.frames ?? [];
  const reversedFrames = [...frames].reverse();
  for (const frame of reversedFrames) {
    lines.push(formatStackFrameMarkdown(frame));
  }

  return lines.join("\n");
}

/**
 * Build the stack trace section as markdown.
 */
function buildStackTraceMarkdown(exceptionEntry: ExceptionEntry): string {
  const lines: string[] = [];
  lines.push("### Stack Trace");
  lines.push("");

  const values = exceptionEntry.data.values ?? [];
  for (const exception of values) {
    lines.push(formatExceptionValueMarkdown(exception));
  }

  return lines.join("\n");
}

// Breadcrumbs Formatting

/**
 * Build the breadcrumbs section as a markdown table.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadcrumb formatting logic
function buildBreadcrumbsMarkdown(breadcrumbsEntry: BreadcrumbsEntry): string {
  const breadcrumbs = breadcrumbsEntry.data.values ?? [];
  if (breadcrumbs.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("### Breadcrumbs");
  lines.push("");
  lines.push("| Time | Level | Category | Message |");
  lines.push("|---|---|---|---|");

  for (const breadcrumb of breadcrumbs) {
    const timestamp = breadcrumb.timestamp
      ? new Date(breadcrumb.timestamp).toLocaleTimeString()
      : "??:??:??";

    const level = breadcrumb.level ?? "info";

    let message = breadcrumb.message ?? "";
    if (!message && breadcrumb.data) {
      const data = breadcrumb.data as Record<string, unknown>;
      if (data.url && data.method) {
        const status = data.status_code ? ` → ${data.status_code}` : "";
        message = `${data.method} ${data.url}${status}`;
      } else if (data.from && data.to) {
        message = `${data.from} → ${data.to}`;
      } else if (data.arguments && Array.isArray(data.arguments)) {
        message = String(data.arguments[0] || "").slice(0, 60);
      }
    }

    if (message.length > 80) {
      message = `${message.slice(0, 77)}...`;
    }

    // Escape special markdown characters that would break the table cell
    const safeMessage = escapeMarkdownCell(message);
    const safeCategory = escapeMarkdownCell(breadcrumb.category ?? "default");

    lines.push(
      `| ${timestamp} | ${level} | ${safeCategory} | ${safeMessage} |`
    );
  }

  return lines.join("\n");
}

// Request Formatting

/**
 * Build the HTTP request section as markdown.
 */
function buildRequestMarkdown(requestEntry: RequestEntry): string {
  const data = requestEntry.data;
  if (!data.url) {
    return "";
  }

  const lines: string[] = [];
  lines.push("### Request");
  lines.push("");
  const method = data.method || "GET";
  lines.push(`\`${method} ${data.url}\``);

  if (data.headers) {
    for (const [key, value] of data.headers) {
      if (key.toLowerCase() === "user-agent") {
        const truncatedUA =
          value.length > 100 ? `${value.slice(0, 97)}...` : value;
        lines.push(`**User-Agent:** ${truncatedUA}`);
        break;
      }
    }
  }

  return lines.join("\n");
}

// Span Tree Formatting

/**
 * Compute the duration of a span in milliseconds.
 * Prefers the API-provided `duration` field, falls back to timestamp arithmetic.
 *
 * @returns Duration in milliseconds, or undefined if not computable
 */
function computeSpanDurationMs(span: TraceSpan): number | undefined {
  if (span.duration !== undefined && Number.isFinite(span.duration)) {
    return span.duration;
  }
  const endTs = span.end_timestamp || span.timestamp;
  if (endTs !== undefined && Number.isFinite(endTs)) {
    const ms = (endTs - span.start_timestamp) * 1000;
    return ms >= 0 ? ms : undefined;
  }
  return;
}

type FormatSpanOptions = {
  lines: string[];
  prefix: string;
  isLast: boolean;
  currentDepth: number;
  maxDepth: number;
};

/**
 * Recursively format a span and its children as simple tree lines.
 * Uses "op — description (duration)" format.
 * Duration is omitted when unavailable.
 */
function formatSpanSimple(span: TraceSpan, opts: FormatSpanOptions): void {
  const { lines, prefix, isLast, currentDepth, maxDepth } = opts;
  const op = span.op || span["transaction.op"] || "unknown";
  const desc = span.description || span.transaction || "(no description)";

  const branch = isLast ? "└─" : "├─";
  const childPrefix = prefix + (isLast ? "   " : "│  ");

  let line = `${prefix}${branch} ${muted(op)} — ${desc}`;

  const durationMs = computeSpanDurationMs(span);
  if (durationMs !== undefined) {
    line += `  ${muted(`(${prettyMs(durationMs)})`)}`;
  }

  lines.push(line);

  if (currentDepth < maxDepth) {
    const children = span.children ?? [];
    const childCount = children.length;
    children.forEach((child, i) => {
      formatSpanSimple(child, {
        lines,
        prefix: childPrefix,
        isLast: i === childCount - 1,
        currentDepth: currentDepth + 1,
        maxDepth,
      });
    });
  }
}

/**
 * Maximum number of root-level spans to display before truncating.
 * Prevents overwhelming output when traces have thousands of flat root spans
 * (common in projects with very high span volume or flat hierarchies).
 */
const MAX_ROOT_SPANS = 50;

/**
 * Format trace as a simple tree with "op — description (duration)" per span.
 * Durations are shown when available, omitted otherwise.
 *
 * Root spans are capped at {@link MAX_ROOT_SPANS} to prevent terminal flooding
 * when traces contain thousands of flat spans.
 *
 * @param traceId - The trace ID for the header
 * @param spans - Root-level spans from the /trace/ API
 * @param maxDepth - Maximum nesting depth to display (default: unlimited). 0 = disabled, Infinity = unlimited.
 * @returns Array of formatted lines ready for display
 */
export function formatSimpleSpanTree(
  traceId: string,
  spans: TraceSpan[],
  maxDepth = Number.MAX_SAFE_INTEGER
): string[] {
  return withSerializeSpan("formatSimpleSpanTree", () => {
    // maxDepth = 0 means disabled (caller should skip, but handle gracefully)
    if (maxDepth === 0 || spans.length === 0) {
      return [];
    }

    // Infinity or large numbers = unlimited depth
    const effectiveMaxDepth = Number.isFinite(maxDepth)
      ? maxDepth
      : Number.MAX_SAFE_INTEGER;

    const lines: string[] = [];
    lines.push("");
    lines.push(muted("─── Span Tree ───"));
    lines.push("");
    lines.push(`${muted("Trace —")} ${traceId}`);

    const totalRootSpans = spans.length;
    const truncated = totalRootSpans > MAX_ROOT_SPANS;
    const displaySpans = truncated ? spans.slice(0, MAX_ROOT_SPANS) : spans;
    const displayCount = displaySpans.length;

    displaySpans.forEach((span, i) => {
      formatSpanSimple(span, {
        lines,
        prefix: "",
        isLast: !truncated && i === displayCount - 1,
        currentDepth: 1,
        maxDepth: effectiveMaxDepth,
      });
    });

    if (truncated) {
      const remaining = totalRootSpans - MAX_ROOT_SPANS;
      lines.push(
        `└─ ${muted(`... ${remaining} more root span${remaining === 1 ? "" : "s"} (${totalRootSpans} total). Use --json to see all.`)}`
      );
    }

    return lines;
  });
}

// Environment Context Formatting

/**
 * Build environment context section (browser, OS, device) as markdown.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: context formatting logic
function buildEnvironmentMarkdown(event: SentryEvent): string {
  const contexts = event.contexts;
  if (!contexts) {
    return "";
  }

  const rows: string[] = [];

  if (contexts.browser) {
    const name = contexts.browser.name || "Unknown Browser";
    const version = contexts.browser.version || "";
    rows.push(
      `| **Browser** | ${escapeMarkdownCell(`${name}${version ? ` ${version}` : ""}`)} |`
    );
  }

  if (contexts.os) {
    const name = contexts.os.name || "Unknown OS";
    const version = contexts.os.version || "";
    rows.push(
      `| **OS** | ${escapeMarkdownCell(`${name}${version ? ` ${version}` : ""}`)} |`
    );
  }

  if (contexts.device) {
    const family = contexts.device.family || contexts.device.model || "";
    const brand = contexts.device.brand || "";
    if (family || brand) {
      const device = brand ? `${family} (${brand})` : family;
      rows.push(`| **Device** | ${escapeMarkdownCell(device)} |`);
    }
  }

  if (rows.length === 0) {
    return "";
  }

  return `### Environment\n\n| | |\n|---|---|\n${rows.join("\n")}`;
}

/**
 * Build user information section as markdown.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: user formatting logic
function buildUserMarkdown(event: SentryEvent): string {
  const user = event.user;
  if (!user) {
    return "";
  }

  const hasUserData =
    user.email ||
    user.username ||
    user.id ||
    user.ip_address ||
    user.name ||
    user.geo;

  if (!hasUserData) {
    return "";
  }

  const rows: string[] = [];

  if (user.name) {
    rows.push(`| **Name** | ${escapeMarkdownCell(user.name)} |`);
  }
  if (user.email) {
    rows.push(`| **Email** | ${escapeMarkdownCell(user.email)} |`);
  }
  if (user.username) {
    rows.push(`| **Username** | ${escapeMarkdownCell(user.username)} |`);
  }
  if (user.id) {
    rows.push(`| **ID** | ${escapeMarkdownCell(user.id)} |`);
  }
  if (user.ip_address) {
    rows.push(`| **IP** | ${escapeMarkdownCell(user.ip_address)} |`);
  }

  if (user.geo) {
    const geo = user.geo;
    const parts: string[] = [];
    if (geo.city) {
      parts.push(geo.city);
    }
    if (geo.region && geo.region !== geo.city) {
      parts.push(geo.region);
    }
    if (geo.country_code) {
      parts.push(`(${geo.country_code})`);
    }
    if (parts.length > 0) {
      rows.push(`| **Location** | ${escapeMarkdownCell(parts.join(", "))} |`);
    }
  }

  return `### User\n\n| | |\n|---|---|\n${rows.join("\n")}`;
}

/**
 * Build replay link section as markdown.
 */
function buildReplayMarkdown(
  event: SentryEvent,
  issuePermalink?: string
): string {
  const replayTag = event.tags?.find((t) => t.key === "replayId");
  if (!replayTag?.value) {
    return "";
  }

  const lines: string[] = [];
  lines.push("### Replay");
  lines.push("");
  lines.push(`**ID:** \`${replayTag.value}\``);

  if (issuePermalink) {
    const match = BASE_URL_REGEX.exec(issuePermalink);
    if (match?.[1]) {
      lines.push(`**Link:** ${match[1]}/replays/${replayTag.value}/`);
    }
  }

  return lines.join("\n");
}

// Event Formatting

/**
 * Format event details for display as rendered markdown.
 *
 * @param event - The Sentry event to format
 * @param header - Optional header text (defaults to "Latest Event")
 * @param issuePermalink - Optional issue permalink for constructing replay links
 * @returns Rendered terminal string
 */
export function formatEventDetails(
  event: SentryEvent,
  header = "Latest Event",
  issuePermalink?: string
): string {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Event formatting requires multiple conditional sections
  return withSerializeSpan("formatEventDetails", () => {
    const sections: string[] = [];

    sections.push(`## ${header} (\`${event.eventID.slice(0, 8)}\`)`);
    sections.push("");

    // Basic info table
    const infoRows: string[] = [];
    infoRows.push(`| **Event ID** | \`${event.eventID}\` |`);
    if (event.dateReceived) {
      infoRows.push(
        `| **Received** | ${new Date(event.dateReceived).toLocaleString()} |`
      );
    }
    if (event.location) {
      infoRows.push(`| **Location** | ${safeCodeSpan(event.location)} |`);
    }

    const traceCtx = event.contexts?.trace;
    if (traceCtx?.trace_id) {
      infoRows.push(`| **Trace** | ${safeCodeSpan(traceCtx.trace_id)} |`);
    }

    if (event.sdk?.name || event.sdk?.version) {
      // Wrap in backtick code span — SDK names like sentry.python.aws_lambda
      // contain underscores that markdown would otherwise render as emphasis.
      const sdkName = event.sdk.name ?? "unknown";
      const sdkVersion = event.sdk.version ?? "";
      const sdkInfo = `${sdkName}${sdkVersion ? ` ${sdkVersion}` : ""}`;
      infoRows.push(`| **SDK** | \`${sdkInfo}\` |`);
    }

    if (event.release?.shortVersion) {
      infoRows.push(
        `| **Release** | ${escapeMarkdownCell(event.release.shortVersion)} |`
      );
    }

    if (infoRows.length > 0) {
      sections.push("| | |");
      sections.push("|---|---|");
      sections.push(...infoRows);
    }

    // User section
    const userSection = buildUserMarkdown(event);
    if (userSection) {
      sections.push("");
      sections.push(userSection);
    }

    // Environment section
    const envSection = buildEnvironmentMarkdown(event);
    if (envSection) {
      sections.push("");
      sections.push(envSection);
    }

    // HTTP Request section
    const requestEntry = extractEntry(event, "request");
    if (requestEntry) {
      const requestSection = buildRequestMarkdown(requestEntry);
      if (requestSection) {
        sections.push("");
        sections.push(requestSection);
      }
    }

    // Stack Trace
    const exceptionEntry = extractEntry(event, "exception");
    if (exceptionEntry) {
      sections.push("");
      sections.push(buildStackTraceMarkdown(exceptionEntry));
    }

    // Breadcrumbs
    const breadcrumbsEntry = extractEntry(event, "breadcrumbs");
    if (breadcrumbsEntry) {
      const breadcrumbSection = buildBreadcrumbsMarkdown(breadcrumbsEntry);
      if (breadcrumbSection) {
        sections.push("");
        sections.push(breadcrumbSection);
      }
    }

    // Replay link
    const replaySection = buildReplayMarkdown(event, issuePermalink);
    if (replaySection) {
      sections.push("");
      sections.push(replaySection);
    }

    // Tags
    if (event.tags?.length) {
      sections.push("");
      sections.push("### Tags");
      sections.push("");
      sections.push("| Key | Value |");
      sections.push("|---|---|");
      for (const tag of event.tags) {
        const safeVal = escapeMarkdownCell(String(tag.value));
        sections.push(`| \`${tag.key}\` | ${safeVal} |`);
      }
    }

    return renderMarkdown(sections.join("\n"));
  });
}

// Organization Formatting

/**
 * Format organization for list display
 */
export function formatOrgRow(
  org: SentryOrganization,
  slugWidth: number
): string {
  return `${org.slug.padEnd(slugWidth)}  ${org.name}`;
}

/**
 * Calculate max slug width from organizations
 */
export function calculateOrgSlugWidth(orgs: SentryOrganization[]): number {
  return Math.max(...orgs.map((o) => o.slug.length), 4);
}

/**
 * Format detailed organization information as rendered markdown.
 *
 * @param org - The Sentry organization to format
 * @returns Rendered terminal string
 */
export function formatOrgDetails(org: SentryOrganization): string {
  const lines: string[] = [];

  lines.push(`## ${org.slug}: ${org.name || "(unnamed)"}`);
  lines.push("");

  const rows: string[] = [];
  rows.push(`| **Slug** | \`${org.slug || "(none)"}\` |`);
  rows.push(`| **Name** | ${org.name || "(unnamed)"} |`);
  rows.push(`| **ID** | ${org.id} |`);
  if (org.dateCreated) {
    rows.push(
      `| **Created** | ${new Date(org.dateCreated).toLocaleString()} |`
    );
  }
  rows.push(`| **2FA** | ${org.require2FA ? "Required" : "Not required"} |`);
  rows.push(`| **Early Adopter** | ${org.isEarlyAdopter ? "Yes" : "No"} |`);

  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(...rows);

  const featuresSection = formatFeaturesMarkdown(org.features);
  if (featuresSection) {
    lines.push(featuresSection);
  }

  return renderMarkdown(lines.join("\n"));
}

// Project Formatting

type ProjectRowOptions = {
  orgWidth: number;
  slugWidth: number;
  nameWidth: number;
};

/**
 * Format project for list display
 */
export function formatProjectRow(
  project: SentryProject & { orgSlug?: string },
  options: ProjectRowOptions
): string {
  const { orgWidth, slugWidth, nameWidth } = options;
  const org = (project.orgSlug || "").padEnd(orgWidth);
  const slug = project.slug.padEnd(slugWidth);
  const name = project.name.padEnd(nameWidth);
  const platform = project.platform || "";
  return `${org}  ${slug}  ${name}  ${platform}`;
}

/**
 * Calculate column widths for project list display
 */
export function calculateProjectColumnWidths(
  projects: Array<SentryProject & { orgSlug?: string }>
): { orgWidth: number; slugWidth: number; nameWidth: number } {
  const orgWidth = Math.max(
    ...projects.map((p) => (p.orgSlug || "").length),
    3
  );
  const slugWidth = Math.max(...projects.map((p) => p.slug.length), 7);
  const nameWidth = Math.max(...projects.map((p) => p.name.length), 4);
  return { orgWidth, slugWidth, nameWidth };
}

/**
 * Format detailed project information as rendered markdown.
 *
 * @param project - The Sentry project to format
 * @param dsn - Optional DSN string to display
 * @returns Rendered terminal string
 */
export function formatProjectDetails(
  project: SentryProject,
  dsn?: string | null
): string {
  const lines: string[] = [];

  lines.push(`## ${project.slug}: ${project.name || "(unnamed)"}`);
  lines.push("");

  const rows: string[] = [];
  rows.push(`| **Slug** | \`${project.slug || "(none)"}\` |`);
  rows.push(`| **Name** | ${project.name || "(unnamed)"} |`);
  rows.push(`| **ID** | ${project.id} |`);
  rows.push(`| **Platform** | ${project.platform || "Not set"} |`);
  rows.push(`| **DSN** | \`${dsn || "No DSN available"}\` |`);
  rows.push(`| **Status** | ${project.status} |`);
  if (project.dateCreated) {
    rows.push(
      `| **Created** | ${new Date(project.dateCreated).toLocaleString()} |`
    );
  }
  if (project.organization) {
    rows.push(
      `| **Organization** | ${project.organization.name} (\`${project.organization.slug}\`) |`
    );
  }
  if (project.firstEvent) {
    rows.push(
      `| **First Event** | ${new Date(project.firstEvent).toLocaleString()} |`
    );
  } else {
    rows.push("| **First Event** | No events yet |");
  }

  rows.push(`| **Sessions** | ${project.hasSessions ? "Yes" : "No"} |`);
  rows.push(`| **Replays** | ${project.hasReplays ? "Yes" : "No"} |`);
  rows.push(`| **Profiles** | ${project.hasProfiles ? "Yes" : "No"} |`);
  rows.push(`| **Monitors** | ${project.hasMonitors ? "Yes" : "No"} |`);

  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(...rows);

  const featuresSection = formatFeaturesMarkdown(project.features);
  if (featuresSection) {
    lines.push(featuresSection);
  }

  return renderMarkdown(lines.join("\n"));
}

// User Identity Formatting

/**
 * User identity fields for display formatting.
 * Accepts both UserInfo (userId) and token response user (id) shapes.
 */
type UserIdentityInput = {
  /** User ID (from token response) */
  id?: string;
  /** User ID (from stored UserInfo) */
  userId?: string;
  email?: string;
  username?: string;
  /** Display name (different from username) */
  name?: string;
};

/**
 * Format user identity for display.
 * Prefers name over username, handles missing fields gracefully.
 *
 * @param user - User identity object (supports both id and userId fields)
 * @returns Formatted string like "Name <email>" or fallback to available fields
 */
export function formatUserIdentity(user: UserIdentityInput): string {
  const { name, username, email, id, userId } = user;
  const displayName = name ?? username;
  const finalId = id ?? userId;

  if (displayName && email) {
    return `${displayName} <${email}>`;
  }
  if (displayName) {
    return displayName;
  }
  if (email) {
    return email;
  }
  // Fallback to user ID if no name/username/email
  return `user ${finalId}`;
}

// Token Formatting

/**
 * Mask a token for display
 */
export function maskToken(token: string): string {
  if (token.length <= 12) {
    return "****";
  }
  return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
}

/**
 * Format a duration in seconds as a human-readable string.
 *
 * @param seconds - Duration in seconds
 * @returns Human-readable duration (e.g., "5 minutes", "2 hours", "1 hour and 30 minutes")
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  return `${hours} hour${hours !== 1 ? "s" : ""} and ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;
}

/**
 * Format token expiration info
 */
export function formatExpiration(expiresAt: number): string {
  const expiresDate = new Date(expiresAt);
  const now = new Date();

  if (expiresDate <= now) {
    return "Expired";
  }

  const secondsRemaining = Math.round(
    (expiresDate.getTime() - now.getTime()) / 1000
  );
  return `${expiresDate.toLocaleString()} (${formatDuration(secondsRemaining)} remaining)`;
}
