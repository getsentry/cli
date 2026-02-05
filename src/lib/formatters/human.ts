/**
 * Human-readable output formatters
 *
 * Centralized formatting utilities for consistent CLI output.
 * Follows gh cli patterns for alignment and presentation.
 */

import type {
  Breadcrumb,
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
  green,
  levelColor,
  muted,
  red,
  statusColor,
  yellow,
} from "./colors.js";

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
 * Format a features array for display, truncating if necessary.
 *
 * @param features - Array of feature names (may be undefined)
 * @returns Formatted lines to append to output, or empty array if no features
 */
function formatFeaturesList(features: string[] | undefined): string[] {
  if (!features || features.length === 0) {
    return [];
  }

  const lines: string[] = ["", `Features (${features.length}):`];
  const displayFeatures = features.slice(0, MAX_DISPLAY_FEATURES);
  lines.push(`  ${displayFeatures.join(", ")}`);

  if (features.length > MAX_DISPLAY_FEATURES) {
    lines.push(`  ... and ${features.length - MAX_DISPLAY_FEATURES} more`);
  }

  return lines;
}

/** Minimum width for header separator line */
const MIN_HEADER_WIDTH = 20;

/**
 * Format a details header with slug and name.
 * Handles empty values gracefully.
 *
 * @param slug - Resource slug (e.g., org or project slug)
 * @param name - Resource display name
 * @returns Array with header line and separator
 */
function formatDetailsHeader(slug: string, name: string): [string, string] {
  const displaySlug = slug || "(no slug)";
  const displayName = name || "(unnamed)";
  const header = `${displaySlug}: ${displayName}`;
  const separatorWidth = Math.max(
    MIN_HEADER_WIDTH,
    Math.min(80, header.length)
  );
  return [header, muted("═".repeat(separatorWidth))];
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

// Table Formatting

type TableColumn = {
  header: string;
  width: number;
  align?: "left" | "right";
};

/**
 * Format a table with aligned columns
 */
export function formatTable(
  columns: TableColumn[],
  rows: string[][]
): string[] {
  const lines: string[] = [];

  // Header
  const header = columns
    .map((col) =>
      col.align === "right"
        ? col.header.padStart(col.width)
        : col.header.padEnd(col.width)
    )
    .join("  ");
  lines.push(header);

  // Rows
  for (const row of rows) {
    const formatted = row
      .map((cell, i) => {
        const col = columns[i];
        if (!col) {
          return cell;
        }
        return col.align === "right"
          ? cell.padStart(col.width)
          : cell.padEnd(col.width);
      })
      .join("  ");
    lines.push(formatted);
  }

  return lines;
}

/**
 * Create a horizontal divider
 */
export function divider(length = 80, char = "─"): string {
  return muted(char.repeat(length));
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

/** Column where title starts in single-project mode (no ALIAS column) */
const TITLE_START_COL =
  COL_LEVEL + 1 + COL_SHORT_ID + 1 + COL_COUNT + 2 + COL_SEEN + 2; // = 50

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
  2; // = 66

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
  const aliasUpper = aliasProjectPart.toUpperCase();
  const aliasLen = aliasUpper.length;

  // Find the part that starts with the alias
  const matchIndex = parts.findIndex((part) => part.startsWith(aliasUpper));
  if (matchIndex < 0 || parts.length < 2) {
    return null;
  }

  // Build result: highlight alias prefix in matching part + highlight last part (issue suffix)
  const lastIndex = parts.length - 1;
  const result = parts.map((part, i) => {
    if (i === matchIndex) {
      // Highlight the alias prefix, keep the rest plain
      return boldUnderline(part.slice(0, aliasLen)) + part.slice(aliasLen);
    }
    if (i === lastIndex) {
      // Highlight the issue suffix (last part)
      return boldUnderline(part);
    }
    return part;
  });

  return result.join("-");
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
  const count = `${issue.count}`.padStart(COL_COUNT);
  const seen = formatRelativeTime(issue.lastSeen);

  // Multi-project mode: include ALIAS column
  if (isMultiProject) {
    const aliasShorthand = computeAliasShorthand(issue.shortId, projectAlias);
    const aliasPadding = " ".repeat(
      Math.max(0, COL_ALIAS - aliasShorthand.length)
    );
    const alias = `${aliasShorthand}${aliasPadding}`;
    const title = wrapTitle(issue.title, TITLE_START_COL_MULTI, termWidth);
    return `${level} ${alias} ${shortId} ${count}  ${seen}  ${title}`;
  }

  const title = wrapTitle(issue.title, TITLE_START_COL, termWidth);
  return `${level} ${shortId} ${count}  ${seen}  ${title}`;
}

/**
 * Format detailed issue information
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: issue formatting logic
export function formatIssueDetails(issue: SentryIssue): string[] {
  const lines: string[] = [];

  // Header
  lines.push(`${issue.shortId}: ${issue.title}`);
  lines.push(
    muted(
      "═".repeat(Math.min(80, issue.title.length + issue.shortId.length + 2))
    )
  );
  lines.push("");

  // Status with substatus
  let statusLine = formatStatusLabel(issue.status);
  if (issue.substatus) {
    statusLine += ` (${capitalize(issue.substatus)})`;
  }
  lines.push(`Status:     ${statusLine}`);

  // Priority
  if (issue.priority) {
    lines.push(`Priority:   ${capitalize(issue.priority)}`);
  }

  // Level with unhandled indicator
  let levelLine = issue.level ?? "unknown";
  if (issue.isUnhandled) {
    levelLine += " (unhandled)";
  }
  lines.push(`Level:      ${levelLine}`);

  lines.push(`Platform:   ${issue.platform ?? "unknown"}`);
  lines.push(`Type:       ${issue.type ?? "unknown"}`);

  // Assignee (show early, it's important)
  const assigneeName = issue.assignedTo?.name ?? "Unassigned";
  lines.push(`Assignee:   ${assigneeName}`);
  lines.push("");

  // Project
  if (issue.project) {
    lines.push(`Project:    ${issue.project.name} (${issue.project.slug})`);
  }

  // Releases
  const firstReleaseVersion = issue.firstRelease?.shortVersion;
  const lastReleaseVersion = issue.lastRelease?.shortVersion;
  if (firstReleaseVersion || lastReleaseVersion) {
    if (firstReleaseVersion && lastReleaseVersion) {
      if (firstReleaseVersion === lastReleaseVersion) {
        lines.push(`Release:    ${firstReleaseVersion}`);
      } else {
        lines.push(
          `Releases:   ${firstReleaseVersion} -> ${lastReleaseVersion}`
        );
      }
    } else if (lastReleaseVersion) {
      lines.push(`Release:    ${lastReleaseVersion}`);
    } else if (firstReleaseVersion) {
      lines.push(`Release:    ${firstReleaseVersion}`);
    }
  }
  lines.push("");

  // Stats
  lines.push(`Events:     ${issue.count ?? 0}`);
  lines.push(`Users:      ${issue.userCount ?? 0}`);

  // First/Last seen with release info
  if (issue.firstSeen) {
    let firstSeenLine = `First seen: ${new Date(issue.firstSeen).toLocaleString()}`;
    if (firstReleaseVersion) {
      firstSeenLine += ` (in ${firstReleaseVersion})`;
    }
    lines.push(firstSeenLine);
  }
  if (issue.lastSeen) {
    let lastSeenLine = `Last seen:  ${new Date(issue.lastSeen).toLocaleString()}`;
    if (lastReleaseVersion && lastReleaseVersion !== firstReleaseVersion) {
      lastSeenLine += ` (in ${lastReleaseVersion})`;
    }
    lines.push(lastSeenLine);
  }
  lines.push("");

  // Culprit
  if (issue.culprit) {
    lines.push(`Culprit:    ${issue.culprit}`);
    lines.push("");
  }

  // Metadata
  if (issue.metadata?.value) {
    lines.push("Message:");
    lines.push(`  ${issue.metadata.value}`);
    lines.push("");
  }

  if (issue.metadata?.filename) {
    lines.push(`File:       ${issue.metadata.filename}`);
  }
  if (issue.metadata?.function) {
    lines.push(`Function:   ${issue.metadata.function}`);
  }

  // Link
  lines.push("");
  lines.push(`Link:       ${issue.permalink}`);

  return lines;
}

// Stack Trace Formatting

/**
 * Format a single stack frame
 */
function formatStackFrame(frame: StackFrame): string[] {
  const lines: string[] = [];
  const fn = frame.function || "<anonymous>";
  const file = frame.filename || frame.absPath || "<unknown>";
  const line = frame.lineNo ?? "?";
  const col = frame.colNo ?? "?";
  const inAppTag = frame.inApp ? " [in-app]" : "";

  lines.push(`  at ${fn} (${file}:${line}:${col})${inAppTag}`);

  // Show code context if available
  if (frame.context && frame.context.length > 0) {
    for (const [lineNo, code] of frame.context) {
      const isCurrentLine = lineNo === frame.lineNo;
      const prefix = isCurrentLine ? ">" : " ";
      const lineNumStr = String(lineNo).padStart(6);
      const codeLine = `     ${prefix} ${lineNumStr} | ${code}`;
      lines.push(isCurrentLine ? yellow(codeLine) : muted(codeLine));
    }
    lines.push(""); // blank line after context
  }

  return lines;
}

/**
 * Format an exception value (type, message, stack trace)
 */
function formatExceptionValue(exception: ExceptionValue): string[] {
  const lines: string[] = [];

  // Exception type and message
  const type = exception.type || "Error";
  const value = exception.value || "";
  lines.push(red(`${type}: ${value}`));

  // Mechanism info
  if (exception.mechanism) {
    const handled = exception.mechanism.handled ? "handled" : "unhandled";
    const mechType = exception.mechanism.type || "unknown";
    lines.push(muted(`  mechanism: ${mechType} (${handled})`));
  }
  lines.push("");

  // Stack trace frames (reversed - most recent first, which is last in array)
  const frames = exception.stacktrace?.frames ?? [];
  // Reverse frames so most recent is first (stack traces are usually bottom-up)
  const reversedFrames = [...frames].reverse();
  for (const frame of reversedFrames) {
    lines.push(...formatStackFrame(frame));
  }

  return lines;
}

/**
 * Format the full stack trace section
 */
function formatStackTrace(exceptionEntry: ExceptionEntry): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(muted("─── Stack Trace ───"));
  lines.push("");

  const values = exceptionEntry.data.values ?? [];
  // Usually there's one exception, but there can be chained exceptions
  for (const exception of values) {
    lines.push(...formatExceptionValue(exception));
  }

  return lines;
}

// Breadcrumbs Formatting

/**
 * Format breadcrumb level with color
 */
function formatBreadcrumbLevel(level: string | undefined): string {
  const lvl = (level || "info").padEnd(7);
  switch (level) {
    case "error":
      return red(lvl);
    case "warning":
      return yellow(lvl);
    case "debug":
      return muted(lvl);
    default:
      return muted(lvl);
  }
}

/**
 * Format a single breadcrumb
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadcrumb formatting logic
function formatBreadcrumb(breadcrumb: Breadcrumb): string {
  const timestamp = breadcrumb.timestamp
    ? new Date(breadcrumb.timestamp).toLocaleTimeString()
    : "??:??:??";
  const level = formatBreadcrumbLevel(breadcrumb.level);
  const category = (breadcrumb.category || "default").padEnd(18);

  // Build message from breadcrumb data
  let message = breadcrumb.message || "";
  if (!message && breadcrumb.data) {
    // Format common breadcrumb types
    const data = breadcrumb.data as Record<string, unknown>;
    if (data.url && data.method) {
      // HTTP request breadcrumb
      const status = data.status_code ? ` -> ${data.status_code}` : "";
      message = `${data.method} ${data.url}${status}`;
    } else if (data.from && data.to) {
      // Navigation breadcrumb
      message = `${data.from} -> ${data.to}`;
    } else if (data.arguments && Array.isArray(data.arguments)) {
      // Console breadcrumb
      message = String(data.arguments[0] || "").slice(0, 60);
    }
  }

  // Truncate long messages
  if (message.length > 60) {
    message = `${message.slice(0, 57)}...`;
  }

  return `  ${timestamp}  ${level}  ${category}  ${message}`;
}

/**
 * Format the breadcrumbs section
 */
function formatBreadcrumbs(breadcrumbsEntry: BreadcrumbsEntry): string[] {
  const lines: string[] = [];
  const breadcrumbs = breadcrumbsEntry.data.values ?? [];

  if (breadcrumbs.length === 0) {
    return lines;
  }

  lines.push("");
  lines.push(muted("─── Breadcrumbs ───"));
  lines.push("");

  // Show all breadcrumbs, oldest first (they're usually already in order)
  for (const breadcrumb of breadcrumbs) {
    lines.push(formatBreadcrumb(breadcrumb));
  }

  return lines;
}

// Request Formatting

/**
 * Format the HTTP request section
 */
function formatRequest(requestEntry: RequestEntry): string[] {
  const lines: string[] = [];
  const data = requestEntry.data;

  if (!data.url) {
    return lines;
  }

  lines.push("");
  lines.push("Request:");
  const method = data.method || "GET";
  lines.push(`  ${method} ${data.url}`);

  // Show User-Agent if available
  if (data.headers) {
    for (const [key, value] of data.headers) {
      if (key.toLowerCase() === "user-agent") {
        const truncatedUA =
          value.length > 70 ? `${value.slice(0, 67)}...` : value;
        lines.push(`  User-Agent: ${truncatedUA}`);
        break;
      }
    }
  }

  return lines;
}

// Span Tree Formatting

type FormatSpanOptions = {
  lines: string[];
  prefix: string;
  isLast: boolean;
  currentDepth: number;
  maxDepth: number;
};

/**
 * Recursively format a span and its children as simple tree lines.
 * Uses "op — description" format without durations.
 */
function formatSpanSimple(span: TraceSpan, opts: FormatSpanOptions): void {
  const { lines, prefix, isLast, currentDepth, maxDepth } = opts;
  const op = span.op || span["transaction.op"] || "unknown";
  const desc = span.description || span.transaction || "(no description)";

  const branch = isLast ? "└─" : "├─";
  const childPrefix = prefix + (isLast ? "   " : "│  ");

  lines.push(`${prefix}${branch} ${muted(op)} — ${desc}`);

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
 * Format trace as simple tree (op — description).
 * No durations, just hierarchy like Sentry's dashboard.
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

    const spanCount = spans.length;
    spans.forEach((span, i) => {
      formatSpanSimple(span, {
        lines,
        prefix: "",
        isLast: i === spanCount - 1,
        currentDepth: 1,
        maxDepth: effectiveMaxDepth,
      });
    });

    return lines;
  });
}

// Environment Context Formatting

/**
 * Format the environment contexts (browser, OS, device)
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: context formatting logic
function formatEnvironmentContexts(event: SentryEvent): string[] {
  const lines: string[] = [];
  const contexts = event.contexts;

  if (!contexts) {
    return lines;
  }

  const parts: string[] = [];

  // Browser
  if (contexts.browser) {
    const name = contexts.browser.name || "Unknown Browser";
    const version = contexts.browser.version || "";
    parts.push(`Browser: ${name}${version ? ` ${version}` : ""}`);
  }

  // OS
  if (contexts.os) {
    const name = contexts.os.name || "Unknown OS";
    const version = contexts.os.version || "";
    parts.push(`OS: ${name}${version ? ` ${version}` : ""}`);
  }

  // Device
  if (contexts.device) {
    const family = contexts.device.family || contexts.device.model || "";
    const brand = contexts.device.brand || "";
    if (family || brand) {
      const device = brand ? `${family} (${brand})` : family;
      parts.push(`Device: ${device}`);
    }
  }

  if (parts.length > 0) {
    lines.push("");
    lines.push("Environment:");
    for (const part of parts) {
      lines.push(`  ${part}`);
    }
  }

  return lines;
}

/**
 * Format user information including geo data
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: user formatting logic
function formatUserInfo(event: SentryEvent): string[] {
  const lines: string[] = [];
  const user = event.user;

  if (!user) {
    return lines;
  }

  const hasUserData =
    user.email ||
    user.username ||
    user.id ||
    user.ip_address ||
    user.name ||
    user.geo;

  if (!hasUserData) {
    return lines;
  }

  lines.push("");
  lines.push("User:");

  if (user.name) {
    lines.push(`  Name:     ${user.name}`);
  }
  if (user.email) {
    lines.push(`  Email:    ${user.email}`);
  }
  if (user.username) {
    lines.push(`  Username: ${user.username}`);
  }
  if (user.id) {
    lines.push(`  ID:       ${user.id}`);
  }
  if (user.ip_address) {
    lines.push(`  IP:       ${user.ip_address}`);
  }

  // Geo information
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
      lines.push(`  Location: ${parts.join(", ")}`);
    }
  }

  return lines;
}

/**
 * Format replay link if available
 */
function formatReplayLink(
  event: SentryEvent,
  issuePermalink?: string
): string[] {
  const lines: string[] = [];

  // Find replayId in tags
  const replayTag = event.tags?.find((t) => t.key === "replayId");
  if (!replayTag?.value) {
    return lines;
  }

  lines.push("");
  lines.push(muted("─── Replay ───"));
  lines.push("");
  lines.push(`  ID: ${replayTag.value}`);

  // Try to construct replay URL from issue permalink
  if (issuePermalink) {
    // Extract base URL from permalink (e.g., https://org.sentry.io/issues/123/)
    const match = BASE_URL_REGEX.exec(issuePermalink);
    if (match?.[1]) {
      lines.push(`  Link: ${match[1]}/replays/${replayTag.value}/`);
    }
  }

  return lines;
}

// Event Formatting

/**
 * Format event details for display.
 *
 * @param event - The Sentry event to format
 * @param header - Optional header text (defaults to "Latest Event")
 * @param issuePermalink - Optional issue permalink for constructing replay links
 * @returns Array of formatted lines
 */
export function formatEventDetails(
  event: SentryEvent,
  header = "Latest Event",
  issuePermalink?: string
): string[] {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Event formatting requires multiple conditional sections
  return withSerializeSpan("formatEventDetails", () => {
    const lines: string[] = [];

    // Header
    lines.push("");
    lines.push(muted(`─── ${header} (${event.eventID.slice(0, 8)}) ───`));
    lines.push("");

    // Basic info
    lines.push(`Event ID:   ${event.eventID}`);
    if (event.dateReceived) {
      lines.push(
        `Received:   ${new Date(event.dateReceived).toLocaleString()}`
      );
    }
    if (event.location) {
      lines.push(`Location:   ${event.location}`);
    }

    // Trace context
    const traceCtx = event.contexts?.trace;
    if (traceCtx?.trace_id) {
      lines.push(`Trace:      ${traceCtx.trace_id}`);
    }

    // User info (including geo)
    lines.push(...formatUserInfo(event));

    // Environment contexts (browser, OS, device)
    lines.push(...formatEnvironmentContexts(event));

    // HTTP Request
    const requestEntry = extractEntry(event, "request");
    if (requestEntry) {
      lines.push(...formatRequest(requestEntry));
    }

    // SDK info
    if (event.sdk?.name || event.sdk?.version) {
      lines.push("");
      const sdkName = event.sdk.name ?? "unknown";
      const sdkVersion = event.sdk.version ?? "";
      lines.push(`SDK:        ${sdkName}${sdkVersion ? ` ${sdkVersion}` : ""}`);
    }

    // Release info
    if (event.release?.shortVersion) {
      lines.push(`Release:    ${event.release.shortVersion}`);
    }

    // Stack Trace
    const exceptionEntry = extractEntry(event, "exception");
    if (exceptionEntry) {
      lines.push(...formatStackTrace(exceptionEntry));
    }

    // Breadcrumbs
    const breadcrumbsEntry = extractEntry(event, "breadcrumbs");
    if (breadcrumbsEntry) {
      lines.push(...formatBreadcrumbs(breadcrumbsEntry));
    }

    // Replay link
    lines.push(...formatReplayLink(event, issuePermalink));

    // Tags
    if (event.tags?.length) {
      lines.push("");
      lines.push(muted("─── Tags ───"));
      lines.push("");
      for (const tag of event.tags) {
        lines.push(`  ${tag.key}: ${tag.value}`);
      }
    }

    return lines;
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
 * Format detailed organization information.
 *
 * @param org - The Sentry organization to format
 * @returns Array of formatted lines
 */
export function formatOrgDetails(org: SentryOrganization): string[] {
  const lines: string[] = [];

  // Header
  const [header, separator] = formatDetailsHeader(org.slug, org.name);
  lines.push(header, separator, "");

  // Basic info
  lines.push(`Slug:       ${org.slug || "(none)"}`);
  lines.push(`Name:       ${org.name || "(unnamed)"}`);
  lines.push(`ID:         ${org.id}`);
  if (org.dateCreated) {
    lines.push(`Created:    ${new Date(org.dateCreated).toLocaleString()}`);
  }
  lines.push("");

  // Settings
  lines.push(`2FA:        ${org.require2FA ? "Required" : "Not required"}`);
  lines.push(`Early Adopter: ${org.isEarlyAdopter ? "Yes" : "No"}`);

  // Features
  lines.push(...formatFeaturesList(org.features));

  return lines;
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
 * Format detailed project information.
 *
 * @param project - The Sentry project to format
 * @param dsn - Optional DSN string to display
 * @returns Array of formatted lines
 */
export function formatProjectDetails(
  project: SentryProject,
  dsn?: string | null
): string[] {
  const lines: string[] = [];

  // Header
  const [header, separator] = formatDetailsHeader(project.slug, project.name);
  lines.push(header, separator, "");

  // Basic info
  lines.push(`Slug:       ${project.slug || "(none)"}`);
  lines.push(`Name:       ${project.name || "(unnamed)"}`);
  lines.push(`ID:         ${project.id}`);
  lines.push(`Platform:   ${project.platform || "Not set"}`);
  lines.push(`DSN:        ${dsn || "No DSN available"}`);
  lines.push(`Status:     ${project.status}`);
  if (project.dateCreated) {
    lines.push(`Created:    ${new Date(project.dateCreated).toLocaleString()}`);
  }

  // Organization context
  if (project.organization) {
    lines.push("");
    lines.push(
      `Organization: ${project.organization.name} (${project.organization.slug})`
    );
  }

  // Activity info
  lines.push("");
  if (project.firstEvent) {
    lines.push(`First Event: ${new Date(project.firstEvent).toLocaleString()}`);
  } else {
    lines.push("First Event: No events yet");
  }

  // Capabilities
  lines.push("");
  lines.push("Capabilities:");
  lines.push(`  Sessions:  ${project.hasSessions ? "Yes" : "No"}`);
  lines.push(`  Replays:   ${project.hasReplays ? "Yes" : "No"}`);
  lines.push(`  Profiles:  ${project.hasProfiles ? "Yes" : "No"}`);
  lines.push(`  Monitors:  ${project.hasMonitors ? "Yes" : "No"}`);

  // Features
  lines.push(...formatFeaturesList(project.features));

  return lines;
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
