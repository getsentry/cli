/**
 * Human-readable output formatters
 *
 * Centralized formatting utilities for consistent CLI output.
 * Follows gh cli patterns for alignment and presentation.
 */

import type {
  IssueStatus,
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
} from "../../types/index.js";
import {
  boldUnderline,
  green,
  levelColor,
  muted,
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
 * Options for formatting short IDs with alias highlighting.
 */
export type FormatShortIdOptions = {
  /** Project slug to determine the prefix for suffix highlighting */
  projectSlug?: string;
  /** Project alias (e.g., "e", "w", "s") for multi-project display */
  projectAlias?: string;
  /** Common prefix that was stripped to compute the alias (e.g., "spotlight-") */
  strippedPrefix?: string;
};

/**
 * Format a short ID with the unique suffix highlighted with underline.
 *
 * Single project mode: "CRAFT-G" → "CRAFT-_G_" (suffix underlined)
 * Multi-project mode: "SPOTLIGHT-WEBSITE-2A" with alias "w" and strippedPrefix "spotlight-"
 *   → "SPOTLIGHT-_W_EBSITE-_2A_" (alias char in remainder and suffix underlined)
 *
 * @param shortId - Full short ID (e.g., "CRAFT-G", "SPOTLIGHT-WEBSITE-A3")
 * @param options - Formatting options (projectSlug, projectAlias, strippedPrefix)
 * @returns Formatted short ID with underline highlights
 */
export function formatShortId(
  shortId: string,
  options?: FormatShortIdOptions | string
): string {
  // Handle legacy string parameter (projectSlug only)
  const opts: FormatShortIdOptions =
    typeof options === "string" ? { projectSlug: options } : (options ?? {});

  const { projectSlug, projectAlias, strippedPrefix } = opts;

  // Extract suffix from shortId (the part after PROJECT-)
  const upperShortId = shortId.toUpperCase();
  let suffix = shortId;
  if (projectSlug) {
    const prefix = `${projectSlug.toUpperCase()}-`;
    if (upperShortId.startsWith(prefix)) {
      suffix = shortId.slice(prefix.length);
    }
  }

  // Multi-project mode: highlight alias position and suffix
  if (projectAlias && projectSlug) {
    const upperSlug = projectSlug.toUpperCase();
    const aliasLen = projectAlias.length;

    // Find where the alias corresponds to in the project slug
    // If strippedPrefix exists, the alias is from the remainder after stripping
    const strippedLen = strippedPrefix?.length ?? 0;
    const aliasStartInSlug = Math.min(strippedLen, upperSlug.length);

    // Build the formatted output: PROJECT-SLUG with alias part underlined, then -SUFFIX underlined
    // e.g., "SPOTLIGHT-WEBSITE" with alias "w", strippedPrefix "spotlight-"
    //   → aliasStartInSlug = 10, so we underline chars 10-11 (the "W")
    const beforeAlias = upperSlug.slice(0, aliasStartInSlug);
    const aliasChars = upperSlug.slice(
      aliasStartInSlug,
      aliasStartInSlug + aliasLen
    );
    const afterAlias = upperSlug.slice(aliasStartInSlug + aliasLen);

    return `${beforeAlias}${boldUnderline(aliasChars)}${afterAlias}-${boldUnderline(suffix.toUpperCase())}`;
  }

  // Single project mode: show full shortId with suffix highlighted
  if (projectSlug) {
    const prefix = `${projectSlug.toUpperCase()}-`;
    if (upperShortId.startsWith(prefix)) {
      return `${prefix}${boldUnderline(suffix.toUpperCase())}`;
    }
  }

  return shortId.toUpperCase();
}

/**
 * Calculate the raw display length of a formatted short ID (without ANSI codes).
 * In all modes, we display the full shortId (just with different styling).
 */
function getShortIdDisplayLength(shortId: string): number {
  return shortId.length;
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
  const levelText = (issue.level ?? "unknown").toUpperCase().padEnd(COL_LEVEL);
  const level = levelColor(levelText, issue.level);
  const formattedShortId = formatShortId(issue.shortId, shortIdOptions);

  // Calculate raw display length (without ANSI codes) for padding
  const rawLen = getShortIdDisplayLength(issue.shortId);
  const shortIdPadding = " ".repeat(Math.max(0, COL_SHORT_ID - rawLen));
  const shortId = `${formattedShortId}${shortIdPadding}`;
  const count = `${issue.count}`.padStart(COL_COUNT);
  const seen = formatRelativeTime(issue.lastSeen);
  const title = wrapTitle(issue.title, TITLE_START_COL, termWidth);

  return `${level} ${shortId} ${count}  ${seen}  ${title}`;
}

/**
 * Format detailed issue information
 */
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

  // Status and level
  lines.push(`Status:     ${formatStatusLabel(issue.status)}`);
  lines.push(`Level:      ${issue.level ?? "unknown"}`);
  lines.push(`Platform:   ${issue.platform}`);
  lines.push(`Type:       ${issue.type}`);
  lines.push("");

  // Project
  if (issue.project) {
    lines.push(`Project:    ${issue.project.name} (${issue.project.slug})`);
    lines.push("");
  }

  // Stats
  lines.push(`Events:     ${issue.count}`);
  lines.push(`Users:      ${issue.userCount}`);
  if (issue.firstSeen) {
    lines.push(`First seen: ${new Date(issue.firstSeen).toLocaleString()}`);
  }
  if (issue.lastSeen) {
    lines.push(`Last seen:  ${new Date(issue.lastSeen).toLocaleString()}`);
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

  // Assignee
  if (issue.assignedTo) {
    lines.push("");
    lines.push(`Assigned:   ${issue.assignedTo.name}`);
  }

  // Link
  lines.push("");
  lines.push(`Link:       ${issue.permalink}`);

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
 * @returns Array of formatted lines
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: formatting logic
export function formatEventDetails(
  event: SentryEvent,
  header = "Latest Event"
): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(muted(`─── ${header} ───`));
  lines.push("");
  lines.push(`Event ID:   ${event.eventID}`);
  if (event.dateReceived) {
    lines.push(`Received:   ${new Date(event.dateReceived).toLocaleString()}`);
  }

  if (event.user) {
    lines.push("");
    lines.push("User:");
    if (event.user.email) {
      lines.push(`  Email:    ${event.user.email}`);
    }
    if (event.user.username) {
      lines.push(`  Username: ${event.user.username}`);
    }
    if (event.user.id) {
      lines.push(`  ID:       ${event.user.id}`);
    }
    if (event.user.ip_address) {
      lines.push(`  IP:       ${event.user.ip_address}`);
    }
  }

  if (event.sdk) {
    lines.push("");
    lines.push(`SDK:        ${event.sdk.name} ${event.sdk.version}`);
  }

  if (event.tags?.length) {
    lines.push("");
    lines.push("Tags:");
    const maxTags = 10;
    for (const tag of event.tags.slice(0, maxTags)) {
      lines.push(`  ${tag.key}: ${tag.value}`);
    }
    if (event.tags.length > maxTags) {
      lines.push(`  ... and ${event.tags.length - maxTags} more`);
    }
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
