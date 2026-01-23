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
  Span,
  SpanEntry,
  StackFrame,
} from "../../types/index.js";
import {
  green,
  levelColor,
  muted,
  red,
  statusColor,
  yellow,
} from "./colors.js";

// ─────────────────────────────────────────────────────────────────────────────
// Status Formatting
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// String Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capitalize the first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Entry Extraction
// ─────────────────────────────────────────────────────────────────────────────

/** Map of entry type strings to their TypeScript types */
type EntryTypeMap = {
  exception: ExceptionEntry;
  breadcrumbs: BreadcrumbsEntry;
  request: RequestEntry;
  spans: SpanEntry;
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

// ─────────────────────────────────────────────────────────────────────────────
// Table Formatting
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Date Formatting
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Issue Formatting
// ─────────────────────────────────────────────────────────────────────────────

/** Column widths for issue list table */
const COL_LEVEL = 7;
const COL_SHORT_ID = 22;
const COL_COUNT = 5;
const COL_SEEN = 10;

/** Column where title starts (sum of all previous columns + separators) */
const TITLE_START_COL =
  COL_LEVEL + 1 + COL_SHORT_ID + 1 + COL_COUNT + 2 + COL_SEEN + 2; // = 50

/**
 * Format the header row for issue list table.
 * Uses same column widths as data rows to ensure alignment.
 */
export function formatIssueListHeader(): string {
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
 * Format a single issue for list display.
 * Wraps long titles with proper indentation.
 *
 * @param issue - Issue to format
 * @param termWidth - Terminal width for wrapping (default 80)
 */
export function formatIssueRow(issue: SentryIssue, termWidth = 80): string {
  const levelText = (issue.level ?? "unknown").toUpperCase().padEnd(COL_LEVEL);
  const level = levelColor(levelText, issue.level);
  const shortId = issue.shortId.padEnd(COL_SHORT_ID);
  const count = `${issue.count}`.padStart(COL_COUNT);
  const seen = formatRelativeTime(issue.lastSeen);
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
          `Releases:   ${firstReleaseVersion} → ${lastReleaseVersion}`
        );
      }
    } else if (lastReleaseVersion) {
      lines.push(`Release:    ${lastReleaseVersion}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Span Tree Formatting
// ─────────────────────────────────────────────────────────────────────────────

type SpanNode = {
  span: Span;
  children: SpanNode[];
};

/**
 * Format span duration in a human-readable format.
 */
function formatSpanDuration(span: Span): string {
  if (span.start_timestamp === undefined || span.timestamp === undefined) {
    return "";
  }
  const durationMs = (span.timestamp - span.start_timestamp) * 1000;
  if (durationMs < 1) {
    return `${(durationMs * 1000).toFixed(0)}µs`;
  }
  if (durationMs < 1000) {
    return `${durationMs.toFixed(1)}ms`;
  }
  return `${(durationMs / 1000).toFixed(2)}s`;
}

/**
 * Build a tree structure from a flat list of spans.
 */
function buildSpanTree(spans: Span[], rootSpanId?: string): SpanNode[] {
  const spanMap = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // Create nodes for all spans
  for (const span of spans) {
    spanMap.set(span.span_id, { span, children: [] });
  }

  // Build parent-child relationships
  for (const span of spans) {
    const node = spanMap.get(span.span_id);
    if (!node) {
      continue;
    }

    const parentId = span.parent_span_id;
    if (parentId && spanMap.has(parentId)) {
      const parent = spanMap.get(parentId);
      parent?.children.push(node);
    } else if (!parentId || parentId === rootSpanId) {
      // Root span or orphan
      roots.push(node);
    } else {
      // Parent not in span list (could be the transaction span)
      roots.push(node);
    }
  }

  // Sort children by start_timestamp
  const sortByTimestamp = (a: SpanNode, b: SpanNode) => {
    const aStart = a.span.start_timestamp ?? 0;
    const bStart = b.span.start_timestamp ?? 0;
    return aStart - bStart;
  };

  const sortTree = (nodes: SpanNode[]): void => {
    nodes.sort(sortByTimestamp);
    for (const node of nodes) {
      sortTree(node.children);
    }
  };

  sortTree(roots);
  return roots;
}

/**
 * Format a span tree as indented lines.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: tree traversal logic
function formatSpanTree(nodes: SpanNode[], prefix = ""): string[] {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) {
      continue;
    }

    const isLastNode = i === nodes.length - 1;
    const connector = isLastNode ? "└─" : "├─";
    const childPrefix = isLastNode ? "  " : "│ ";

    const op = node.span.op ?? "span";
    const desc = node.span.description ?? "";
    const duration = formatSpanDuration(node.span);
    const status = node.span.status;
    const statusIndicator = status && status !== "ok" ? ` [${status}]` : "";

    const spanLine = duration
      ? `${op}: ${desc} (${duration})${statusIndicator}`
      : `${op}: ${desc}${statusIndicator}`;

    lines.push(`${prefix}${connector} ${spanLine}`);

    if (node.children.length > 0) {
      const childLines = formatSpanTree(node.children, prefix + childPrefix);
      lines.push(...childLines);
    }
  }

  return lines;
}

/**
 * Extract spans from event entries.
 */
function extractSpansFromEvent(event: SentryEvent): Span[] {
  if (!event.entries) {
    return [];
  }

  for (const entry of event.entries) {
    // Check if this entry is a spans entry
    if (
      entry &&
      typeof entry === "object" &&
      "type" in entry &&
      entry.type === "spans" &&
      "data" in entry &&
      Array.isArray(entry.data)
    ) {
      return (entry as SpanEntry).data;
    }
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Stack Trace Formatting
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Breadcrumbs Formatting
// ─────────────────────────────────────────────────────────────────────────────

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
      const status = data.status_code ? ` → ${data.status_code}` : "";
      message = `${data.method} ${data.url}${status}`;
    } else if (data.from && data.to) {
      // Navigation breadcrumb
      message = `${data.from} → ${data.to}`;
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

// ─────────────────────────────────────────────────────────────────────────────
// Request Formatting
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Environment Context Formatting
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Event Formatting
// ─────────────────────────────────────────────────────────────────────────────

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
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(muted(`─── ${header} (${event.eventID.slice(0, 8)}) ───`));
  lines.push("");

  // Basic info
  lines.push(`Event ID:   ${event.eventID}`);
  if (event.dateReceived) {
    lines.push(`Received:   ${new Date(event.dateReceived).toLocaleString()}`);
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
  if (event.sdk) {
    lines.push("");
    lines.push(`SDK:        ${event.sdk.name} ${event.sdk.version}`);
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

  // Span tree (for transaction events)
  const spans = extractSpansFromEvent(event);
  if (spans.length > 0) {
    const rootSpanId = traceCtx?.span_id;
    const tree = buildSpanTree(spans, rootSpanId);
    lines.push("");
    lines.push(muted("─── Spans ───"));
    lines.push("");
    lines.push(`Spans (${spans.length}):`);
    const treeLines = formatSpanTree(tree);
    lines.push(...treeLines);
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Organization Formatting
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Project Formatting
// ─────────────────────────────────────────────────────────────────────────────

type ProjectRowOptions = {
  showOrg: boolean;
  orgSlug?: string;
  slugWidth: number;
};

/**
 * Format project for list display
 */
export function formatProjectRow(
  project: SentryProject,
  options: ProjectRowOptions
): string {
  const { showOrg, orgSlug, slugWidth } = options;
  const slug = showOrg
    ? `${orgSlug}/${project.slug}`.padEnd(slugWidth)
    : project.slug.padEnd(slugWidth);
  const platform = (project.platform || "").padEnd(20);
  return `${slug}  ${platform}  ${project.name}`;
}

/**
 * Calculate max slug width from projects
 */
export function calculateProjectSlugWidth(
  projects: Array<SentryProject & { orgSlug?: string }>,
  showOrg: boolean
): number {
  return Math.max(
    ...projects.map((p) =>
      showOrg ? `${p.orgSlug}/${p.slug}`.length : p.slug.length
    ),
    4
  );
}

/**
 * Format detailed project information.
 *
 * @param project - The Sentry project to format
 * @returns Array of formatted lines
 */
export function formatProjectDetails(project: SentryProject): string[] {
  const lines: string[] = [];

  // Header
  const [header, separator] = formatDetailsHeader(project.slug, project.name);
  lines.push(header, separator, "");

  // Basic info
  lines.push(`Slug:       ${project.slug || "(none)"}`);
  lines.push(`Name:       ${project.name || "(unnamed)"}`);
  lines.push(`ID:         ${project.id}`);
  lines.push(`Platform:   ${project.platform || "Not set"}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Token Formatting
// ─────────────────────────────────────────────────────────────────────────────

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
