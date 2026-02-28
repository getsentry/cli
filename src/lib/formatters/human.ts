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
  Writer,
} from "../../types/index.js";
import { withSerializeSpan } from "../telemetry.js";
import { type FixabilityTier, muted } from "./colors.js";
import {
  colorTag,
  escapeMarkdownCell,
  escapeMarkdownInline,
  mdKvTable,
  mdRow,
  mdTableHeader,
  renderMarkdown,
  safeCodeSpan,
} from "./markdown.js";
import { type Column, writeTable } from "./table.js";

// Color tag maps

/** Markdown color tags for issue level values */
const LEVEL_TAGS: Record<string, Parameters<typeof colorTag>[0]> = {
  fatal: "red",
  error: "red",
  warning: "yellow",
  info: "cyan",
  debug: "muted",
};

/** Markdown color tags for Seer fixability tiers */
const FIXABILITY_TAGS: Record<FixabilityTier, Parameters<typeof colorTag>[0]> =
  {
    high: "green",
    med: "yellow",
    low: "red",
  };

// Status Formatting

const STATUS_ICONS: Record<IssueStatus, string> = {
  resolved: colorTag("green", "✓"),
  unresolved: colorTag("yellow", "●"),
  ignored: colorTag("muted", "−"),
};

const STATUS_LABELS: Record<IssueStatus, string> = {
  resolved: `${colorTag("green", "✓")} Resolved`,
  unresolved: `${colorTag("yellow", "●")} Unresolved`,
  ignored: `${colorTag("muted", "−")} Ignored`,
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
  return STATUS_ICONS[status as IssueStatus] ?? colorTag("yellow", "●");
}

/**
 * Get full status label for an issue status
 */
export function formatStatusLabel(status: string | undefined): string {
  return (
    STATUS_LABELS[status as IssueStatus] ?? `${colorTag("yellow", "●")} Unknown`
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
    return muted("—");
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

  return text;
}

// Issue Formatting

/** Quantifier suffixes indexed by groups of 3 digits (K=10^3, M=10^6, …, E=10^18) */
const QUANTIFIERS = ["", "K", "M", "B", "T", "P", "E"];

/**
 * Abbreviate large numbers with K/M/B/T/P/E suffixes (up to 10^18).
 *
 * The decimal is only shown when the rounded value is < 100 (e.g. "12.3K",
 * "1.5M" but not "100M").
 *
 * @param raw - Stringified count
 * @returns Abbreviated string without padding
 */
function abbreviateCount(raw: string): string {
  const n = Number(raw);
  if (Number.isNaN(n)) {
    Sentry.logger.warn(`Unexpected non-numeric issue count: ${raw}`);
    return "?";
  }
  if (n < 1000) {
    return raw;
  }
  const tier = Math.min(Math.floor(Math.log10(n) / 3), QUANTIFIERS.length - 1);
  const suffix = QUANTIFIERS[tier] ?? "";
  const scaled = n / 10 ** (tier * 3);
  const rounded1dp = Number(scaled.toFixed(1));
  if (rounded1dp < 100) {
    return `${rounded1dp.toFixed(1)}${suffix}`;
  }
  const rounded = Math.round(scaled);
  if (rounded >= 1000 && tier < QUANTIFIERS.length - 1) {
    const nextSuffix = QUANTIFIERS[tier + 1] ?? "";
    return `${(rounded / 1000).toFixed(1)}${nextSuffix}`;
  }
  return `${Math.min(rounded, 999)}${suffix}`;
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
 *
 * @returns Formatted string with ANSI highlights, or null if no match found
 */
function formatShortIdWithAlias(
  shortId: string,
  projectAlias: string
): string | null {
  // Extract the project part of the alias — cross-org collision aliases use
  // the format "o1/d" where only "d" should match against the short ID parts.
  const aliasPart = projectAlias.includes("/")
    ? (projectAlias.split("/").pop() ?? projectAlias)
    : projectAlias;

  const aliasUpper = aliasPart.toUpperCase();
  const aliasLen = aliasUpper.length;

  const parts = shortId.split("-");
  const issueSuffix = parts.pop() ?? "";
  const projectParts = parts;

  if (!aliasUpper.includes("-")) {
    for (let i = projectParts.length - 1; i >= 0; i--) {
      const part = projectParts[i];
      if (part?.startsWith(aliasUpper)) {
        const result = projectParts.map((p, idx) => {
          if (idx === i) {
            return `**${p.slice(0, aliasLen)}**${p.slice(aliasLen)}`;
          }
          return p;
        });
        return `${result.join("-")}-**${issueSuffix}**`;
      }
    }
  }

  const projectPortion = projectParts.join("-");
  if (projectPortion.startsWith(aliasUpper)) {
    const highlighted = `**${projectPortion.slice(0, aliasLen)}**`;
    const rest = projectPortion.slice(aliasLen);
    return `${highlighted}${rest}-**${issueSuffix}**`;
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
 * @param options - Formatting options (projectSlug and/or projectAlias)
 * @returns Formatted short ID with highlights
 */
export function formatShortId(
  shortId: string,
  options?: FormatShortIdOptions | string
): string {
  const opts: FormatShortIdOptions =
    typeof options === "string" ? { projectSlug: options } : (options ?? {});

  const { projectSlug, projectAlias, isMultiProject } = opts;
  const upperShortId = shortId.toUpperCase();

  if (isMultiProject && projectAlias) {
    const formatted = formatShortIdWithAlias(upperShortId, projectAlias);
    if (formatted) {
      return formatted;
    }
  }

  if (projectSlug) {
    const prefix = `${projectSlug.toUpperCase()}-`;
    if (upperShortId.startsWith(prefix)) {
      const suffix = shortId.slice(prefix.length);
      return `${prefix}**${suffix.toUpperCase()}**`;
    }
  }

  return upperShortId;
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

/** Row data prepared for the issue table */
export type IssueTableRow = {
  issue: SentryIssue;
  /** Org slug — used as project key in trimWithProjectGuarantee and similar utilities. */
  orgSlug: string;
  formatOptions: FormatShortIdOptions;
};

/**
 * Write an issue list as a Unicode-bordered markdown table.
 *
 * Columns are conditionally included based on `isMultiProject` mode.
 * Cell values are pre-colored with ANSI codes which survive the
 * cli-table3 rendering pipeline.
 *
 * @param stdout - Output writer
 * @param rows - Issues with formatting options
 * @param isMultiProject - Whether to include the ALIAS column
 */
export function writeIssueTable(
  stdout: Writer,
  rows: IssueTableRow[],
  isMultiProject: boolean
): void {
  const columns: Column<IssueTableRow>[] = [
    {
      header: "LEVEL",
      value: ({ issue }) => {
        const level = (issue.level ?? "unknown").toLowerCase();
        const tag = LEVEL_TAGS[level];
        const label = level.toUpperCase();
        return tag ? colorTag(tag, label) : label;
      },
    },
  ];

  if (isMultiProject) {
    columns.push({
      header: "ALIAS",
      value: ({ issue, formatOptions }) =>
        computeAliasShorthand(issue.shortId, formatOptions.projectAlias),
    });
  }

  columns.push(
    {
      header: "SHORT ID",
      // Short IDs are the primary identifier users copy for
      // `sentry issue view <ID>` — never shrink or truncate them.
      shrinkable: false,
      value: ({ issue, formatOptions }) => {
        const formatted = formatShortId(issue.shortId, formatOptions);
        if (issue.permalink) {
          return `[${formatted}](${issue.permalink})`;
        }
        return formatted;
      },
    },
    {
      header: "COUNT",
      value: ({ issue }) => abbreviateCount(`${issue.count}`),
      align: "right",
    },
    {
      header: "SEEN",
      value: ({ issue }) => formatRelativeTime(issue.lastSeen),
    },
    {
      header: "FIXABILITY",
      value: ({ issue }) => {
        const text = formatFixability(issue.seerFixabilityScore);
        const score = issue.seerFixabilityScore;
        if (text && score !== null && score !== undefined) {
          const tier = getSeerFixabilityLabel(score);
          return colorTag(FIXABILITY_TAGS[tier], text);
        }
        return "";
      },
    },
    {
      header: "TITLE",
      // Escape markdown emphasis chars so underscores/asterisks in issue titles
      // (e.g. "Expected <string> got <number>") don't render as italic/bold text.
      value: ({ issue }) => escapeMarkdownInline(issue.title),
    }
  );

  writeTable(stdout, rows, columns);
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

  lines.push(`## ${issue.shortId}: ${escapeMarkdownInline(issue.title ?? "")}`);
  lines.push("");

  // Key-value details as a table
  const kvRows: [string, string][] = [];

  kvRows.push([
    "Status",
    `${formatStatusLabel(issue.status)}${issue.substatus ? ` (${capitalize(issue.substatus)})` : ""}`,
  ]);

  if (issue.priority) {
    kvRows.push(["Priority", capitalize(issue.priority)]);
  }

  if (
    issue.seerFixabilityScore !== null &&
    issue.seerFixabilityScore !== undefined
  ) {
    const tier = getSeerFixabilityLabel(issue.seerFixabilityScore);
    const fixDetail = formatFixabilityDetail(issue.seerFixabilityScore);
    kvRows.push(["Fixability", colorTag(FIXABILITY_TAGS[tier], fixDetail)]);
  }

  let levelLine = issue.level ?? "unknown";
  if (issue.isUnhandled) {
    levelLine += " (unhandled)";
  }
  kvRows.push(["Level", levelLine]);
  kvRows.push(["Platform", issue.platform ?? "unknown"]);
  kvRows.push(["Type", issue.type ?? "unknown"]);
  kvRows.push(["Assignee", String(issue.assignedTo?.name ?? "Unassigned")]);

  if (issue.project) {
    kvRows.push([
      "Project",
      `${issue.project.name ?? "(unknown)"} (${safeCodeSpan(issue.project.slug ?? "")})`,
    ]);
  }

  const firstReleaseVersion = issue.firstRelease?.shortVersion;
  const lastReleaseVersion = issue.lastRelease?.shortVersion;
  if (firstReleaseVersion || lastReleaseVersion) {
    const first = String(firstReleaseVersion ?? "");
    const last = String(lastReleaseVersion ?? "");
    if (firstReleaseVersion && lastReleaseVersion) {
      if (firstReleaseVersion === lastReleaseVersion) {
        kvRows.push(["Release", first]);
      } else {
        kvRows.push(["Releases", `${first} → ${last}`]);
      }
    } else if (lastReleaseVersion) {
      kvRows.push(["Release", last]);
    } else if (firstReleaseVersion) {
      kvRows.push(["Release", first]);
    }
  }

  kvRows.push(["Events", String(issue.count ?? 0)]);
  kvRows.push(["Users", String(issue.userCount ?? 0)]);

  if (issue.firstSeen) {
    let firstSeenLine = new Date(issue.firstSeen).toLocaleString();
    if (firstReleaseVersion) {
      firstSeenLine += ` (in ${escapeMarkdownCell(String(firstReleaseVersion))})`;
    }
    kvRows.push(["First seen", firstSeenLine]);
  }
  if (issue.lastSeen) {
    let lastSeenLine = new Date(issue.lastSeen).toLocaleString();
    if (lastReleaseVersion && lastReleaseVersion !== firstReleaseVersion) {
      lastSeenLine += ` (in ${escapeMarkdownCell(String(lastReleaseVersion))})`;
    }
    kvRows.push(["Last seen", lastSeenLine]);
  }

  if (issue.culprit) {
    kvRows.push(["Culprit", safeCodeSpan(issue.culprit)]);
  }

  kvRows.push(["Link", issue.permalink ?? ""]);

  lines.push(mdKvTable(kvRows));

  if (issue.metadata?.value) {
    lines.push("");
    lines.push("**Message:**");
    lines.push("");
    lines.push(
      `> ${escapeMarkdownInline(issue.metadata.value).replace(/\n/g, "\n> ")}`
    );
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

  lines.push(`${safeCodeSpan(`at ${fn} (${file}:${line}:${col})`)}${inAppTag}`);

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
  lines.push(`**${safeCodeSpan(`${type}: ${value}`)}**`);

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
  lines.push(mdTableHeader(["Time", "Level", "Category", "Message"]).trimEnd());

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

    lines.push(mdRow([timestamp, level, safeCategory, safeMessage]).trimEnd());
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

  const kvRows: [string, string][] = [];

  if (contexts.browser) {
    const name = contexts.browser.name || "Unknown Browser";
    const version = contexts.browser.version || "";
    kvRows.push(["Browser", `${name}${version ? ` ${version}` : ""}`]);
  }

  if (contexts.os) {
    const name = contexts.os.name || "Unknown OS";
    const version = contexts.os.version || "";
    kvRows.push(["OS", `${name}${version ? ` ${version}` : ""}`]);
  }

  if (contexts.device) {
    const family = contexts.device.family || contexts.device.model || "";
    const brand = contexts.device.brand || "";
    if (family || brand) {
      const device = brand ? `${family} (${brand})` : family;
      kvRows.push(["Device", device]);
    }
  }

  if (kvRows.length === 0) {
    return "";
  }

  return mdKvTable(kvRows, "Environment");
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

  const kvRows: [string, string][] = [];

  if (user.name) {
    kvRows.push(["Name", user.name]);
  }
  if (user.email) {
    kvRows.push(["Email", user.email]);
  }
  if (user.username) {
    kvRows.push(["Username", user.username]);
  }
  if (user.id) {
    kvRows.push(["ID", user.id]);
  }
  if (user.ip_address) {
    kvRows.push(["IP", user.ip_address]);
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
      kvRows.push(["Location", parts.join(", ")]);
    }
  }

  return mdKvTable(kvRows, "User");
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

    sections.push(
      `## ${escapeMarkdownInline(header)} (\`${event.eventID.slice(0, 8)}\`)`
    );
    sections.push("");

    // Basic info table
    const infoKvRows: [string, string][] = [];
    infoKvRows.push(["Event ID", `\`${event.eventID}\``]);
    if (event.dateReceived) {
      infoKvRows.push([
        "Received",
        new Date(event.dateReceived).toLocaleString(),
      ]);
    }
    if (event.location) {
      infoKvRows.push(["Location", safeCodeSpan(event.location)]);
    }

    const traceCtx = event.contexts?.trace;
    if (traceCtx?.trace_id) {
      infoKvRows.push(["Trace", safeCodeSpan(traceCtx.trace_id)]);
    }

    if (event.sdk?.name || event.sdk?.version) {
      // Wrap in backtick code span — SDK names like sentry.python.aws_lambda
      // contain underscores that markdown would otherwise render as emphasis.
      const sdkName = event.sdk.name ?? "unknown";
      const sdkVersion = event.sdk.version ?? "";
      const sdkInfo = `${sdkName}${sdkVersion ? ` ${sdkVersion}` : ""}`;
      infoKvRows.push(["SDK", `\`${sdkInfo}\``]);
    }

    if (event.release?.shortVersion) {
      infoKvRows.push(["Release", String(event.release.shortVersion)]);
    }

    if (infoKvRows.length > 0) {
      sections.push(mdKvTable(infoKvRows));
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
      sections.push(mdTableHeader(["Key", "Value"]).trimEnd());
      for (const tag of event.tags) {
        sections.push(
          mdRow([
            `\`${tag.key}\``,
            escapeMarkdownCell(String(tag.value)),
          ]).trimEnd()
        );
      }
    }

    return renderMarkdown(sections.join("\n"));
  });
}

// Organization Formatting

/**
 * Format detailed organization information as rendered markdown.
 *
 * @param org - The Sentry organization to format
 * @returns Rendered terminal string
 */
export function formatOrgDetails(org: SentryOrganization): string {
  const lines: string[] = [];

  lines.push(
    `## ${escapeMarkdownInline(org.slug)}: ${escapeMarkdownInline(org.name || "(unnamed)")}`
  );
  lines.push("");

  const kvRows: [string, string][] = [];
  kvRows.push(["Slug", `\`${org.slug || "(none)"}\``]);
  kvRows.push(["Name", org.name || "(unnamed)"]);
  kvRows.push(["ID", String(org.id)]);
  if (org.dateCreated) {
    kvRows.push(["Created", new Date(org.dateCreated).toLocaleString()]);
  }
  kvRows.push(["2FA", org.require2FA ? "Required" : "Not required"]);
  kvRows.push(["Early Adopter", org.isEarlyAdopter ? "Yes" : "No"]);

  lines.push(mdKvTable(kvRows));

  const featuresSection = formatFeaturesMarkdown(org.features);
  if (featuresSection) {
    lines.push(featuresSection);
  }

  return renderMarkdown(lines.join("\n"));
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

  lines.push(
    `## ${escapeMarkdownInline(project.slug)}: ${escapeMarkdownInline(project.name || "(unnamed)")}`
  );
  lines.push("");

  const kvRows: [string, string][] = [];
  kvRows.push(["Slug", `\`${project.slug || "(none)"}\``]);
  kvRows.push(["Name", project.name || "(unnamed)"]);
  kvRows.push(["ID", String(project.id)]);
  kvRows.push(["Platform", project.platform || "Not set"]);
  kvRows.push(["DSN", `\`${dsn || "No DSN available"}\``]);
  kvRows.push(["Status", project.status ?? "unknown"]);
  if (project.dateCreated) {
    kvRows.push(["Created", new Date(project.dateCreated).toLocaleString()]);
  }
  if (project.organization) {
    kvRows.push([
      "Organization",
      `${project.organization.name} (${safeCodeSpan(project.organization.slug)})`,
    ]);
  }
  if (project.firstEvent) {
    kvRows.push(["First Event", new Date(project.firstEvent).toLocaleString()]);
  } else {
    kvRows.push(["First Event", "No events yet"]);
  }

  kvRows.push(["Sessions", project.hasSessions ? "Yes" : "No"]);
  kvRows.push(["Replays", project.hasReplays ? "Yes" : "No"]);
  kvRows.push(["Profiles", project.hasProfiles ? "Yes" : "No"]);
  kvRows.push(["Monitors", project.hasMonitors ? "Yes" : "No"]);

  lines.push(mdKvTable(kvRows));

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
