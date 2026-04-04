/**
 * sentry issue events
 *
 * List events for a specific Sentry issue.
 */

import type { SentryContext } from "../../context.js";
import { listIssueEvents } from "../../lib/api-client.js";
import { validateLimit } from "../../lib/arg-parsing.js";
import {
  advancePaginationState,
  buildPaginationContextKey,
  hasPreviousPage,
  resolveCursor,
} from "../../lib/db/pagination.js";
import { ContextError } from "../../lib/errors.js";
import { filterFields } from "../../lib/formatters/json.js";
import { colorTag, escapeMarkdownCell } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { type Column, formatTable } from "../../lib/formatters/table.js";
import { formatRelativeTime } from "../../lib/formatters/time-utils.js";
import {
  buildListCommand,
  LIST_PERIOD_FLAG,
  PERIOD_ALIASES,
  paginationHint,
} from "../../lib/list-command.js";
import { withProgress } from "../../lib/polling.js";
import { type IssueEvent, IssueEventSchema } from "../../types/index.js";
import { buildCommandHint, issueIdPositional, resolveIssue } from "./utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventsFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly full: boolean;
  readonly period: string;
  readonly json: boolean;
  readonly cursor?: string;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/**
 * Result data for the issue events command.
 *
 * Contains the events array plus pagination metadata and context
 * needed by both the human formatter and JSON transform.
 */
type IssueEventsResult = {
  /** The list of events returned by the API */
  events: IssueEvent[];
  /** Whether more pages are available */
  hasMore: boolean;
  /** Whether a previous page exists (for bidirectional hints) */
  hasPrev: boolean;
  /** Opaque cursor for fetching the next page */
  nextCursor?: string | null;
  /** The issue short ID (for display in header) */
  issueShortId: string;
  /** The numeric issue ID (for pagination context) */
  issueId: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed value for --limit flag */
const MAX_LIMIT = 1000;

/** Minimum allowed value for --limit flag */
const MIN_LIMIT = 1;

/** Default number of events to show */
const DEFAULT_LIMIT = 25;

/** Command name used in issue resolution error messages */
const COMMAND_NAME = "events";

/** Default time period for event queries */
const DEFAULT_PERIOD = "7d";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "issue-events";

// ---------------------------------------------------------------------------
// Table columns
// ---------------------------------------------------------------------------

/** Extract a display label for the event's user, falling back through available fields. */
function getUserLabel(event: IssueEvent): string {
  if (!event.user) {
    return colorTag("muted", "—");
  }
  const label =
    event.user.email ??
    event.user.username ??
    event.user.ip_address ??
    event.user.id;
  return label ? escapeMarkdownCell(label) : colorTag("muted", "—");
}

/** Table columns for issue events list */
const EVENT_COLUMNS: Column<IssueEvent>[] = [
  {
    header: "EVENT ID",
    value: (e) => `\`${e.eventID.slice(0, 12)}\``,
    shrinkable: false,
  },
  {
    header: "TIMESTAMP",
    value: (e) => formatRelativeTime(e.dateCreated),
  },
  {
    header: "TITLE",
    value: (e) => escapeMarkdownCell(e.title),
    truncate: true,
  },
  {
    header: "PLATFORM",
    value: (e) => escapeMarkdownCell(e.platform ?? "—"),
  },
  {
    header: "USER",
    value: getUserLabel,
  },
];

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Format issue events data for human-readable terminal output.
 *
 * Handles three display states:
 * - Empty list with more pages → "No events on this page."
 * - Empty list, no more pages → "No events found for this issue."
 * - Non-empty → header line + formatted table
 */
function formatIssueEventsHuman(result: IssueEventsResult): string {
  const { events, hasMore, issueShortId } = result;

  if (events.length === 0) {
    return hasMore
      ? "No events on this page."
      : "No events found for this issue.";
  }

  return `Events for ${issueShortId}:\n\n${formatTable(events, EVENT_COLUMNS)}`;
}

/**
 * Transform issue events data into the JSON list envelope.
 *
 * Produces the standard `{ data, hasMore, hasPrev, nextCursor? }` envelope.
 * Field filtering is applied per-element inside `data`.
 */
function jsonTransformIssueEvents(
  result: IssueEventsResult,
  fields?: string[]
): unknown {
  const items =
    fields && fields.length > 0
      ? result.events.map((e) => filterFields(e, fields))
      : result.events;

  const envelope: Record<string, unknown> = {
    data: items,
    hasMore: result.hasMore,
    hasPrev: result.hasPrev,
  };
  if (
    result.nextCursor !== null &&
    result.nextCursor !== undefined &&
    result.nextCursor !== ""
  ) {
    envelope.nextCursor = result.nextCursor;
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Pagination hints
// ---------------------------------------------------------------------------

/** Append active non-default flags to a base command string. */
function appendEventsFlags(
  base: string,
  flags: Pick<EventsFlags, "query" | "full" | "period">
): string {
  const parts: string[] = [];
  if (flags.query) {
    parts.push(`-q "${flags.query}"`);
  }
  if (flags.full) {
    parts.push("--full");
  }
  if (flags.period !== DEFAULT_PERIOD) {
    parts.push(`--period ${flags.period}`);
  }
  return parts.length > 0 ? `${base} ${parts.join(" ")}` : base;
}

/** Build the CLI hint for fetching the next page, preserving active flags. */
function nextPageHint(
  issueArg: string,
  flags: Pick<EventsFlags, "query" | "full" | "period">
): string {
  return appendEventsFlags(`sentry issue events ${issueArg} -c next`, flags);
}

/** Build the CLI hint for fetching the previous page, preserving active flags. */
function prevPageHint(
  issueArg: string,
  flags: Pick<EventsFlags, "query" | "full" | "period">
): string {
  return appendEventsFlags(`sentry issue events ${issueArg} -c prev`, flags);
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

/** Parse --limit flag, delegating range validation to shared utility. */
function parseLimit(value: string): number {
  return validateLimit(value, MIN_LIMIT, MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export const eventsCommand = buildListCommand("issue", {
  docs: {
    brief: "List events for a specific issue",
    fullDescription:
      "List events belonging to a Sentry issue.\n\n" +
      "Issue formats:\n" +
      "  @latest          - Most recent unresolved issue\n" +
      "  @most_frequent   - Issue with highest event frequency\n" +
      "  <org>/ID         - Explicit org: sentry/EXTENSION-7\n" +
      "  <project>-suffix - Project + suffix: cli-G\n" +
      "  ID               - Short ID: CLI-G\n" +
      "  numeric          - Numeric ID: 123456789\n\n" +
      "Examples:\n" +
      "  sentry issue events CLI-G\n" +
      "  sentry issue events @latest --limit 50\n" +
      "  sentry issue events 123456789 --full\n" +
      '  sentry issue events CLI-G -q "user.email:foo@bar.com"\n' +
      "  sentry issue events CLI-G --json",
  },
  output: {
    human: formatIssueEventsHuman,
    jsonTransform: jsonTransformIssueEvents,
    schema: IssueEventSchema,
  },
  parameters: {
    positional: issueIdPositional,
    flags: {
      limit: {
        kind: "parsed",
        parse: parseLimit,
        brief: `Number of events (${MIN_LIMIT}-${MAX_LIMIT})`,
        default: String(DEFAULT_LIMIT),
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Search query (Sentry search syntax)",
        optional: true,
      },
      full: {
        kind: "boolean",
        brief: "Include full event body (stacktraces)",
        default: false,
      },
      period: LIST_PERIOD_FLAG,
    },
    aliases: {
      ...PERIOD_ALIASES,
      n: "limit",
      q: "query",
    },
  },
  async *func(this: SentryContext, flags: EventsFlags, issueArg: string) {
    const { cwd } = this;

    // Resolve issue using shared resolution logic (supports @latest, short IDs, etc.)
    const { org, issue } = await resolveIssue({
      issueArg,
      cwd,
      command: COMMAND_NAME,
    });

    // Org is required for region-routed events endpoint
    if (!org) {
      throw new ContextError(
        "Organization",
        buildCommandHint(COMMAND_NAME, issueArg)
      );
    }

    // Build context key for pagination (keyed by issue ID + query-varying params)
    const contextKey = buildPaginationContextKey(
      "issue-events",
      `${org}/${issue.id}`,
      { q: flags.query, period: flags.period }
    );
    const { cursor, direction } = resolveCursor(
      flags.cursor,
      PAGINATION_KEY,
      contextKey
    );

    const { data: events, nextCursor } = await withProgress(
      {
        message: `Fetching events for ${issue.shortId} (up to ${flags.limit})...`,
        json: flags.json,
      },
      () =>
        listIssueEvents(org, issue.id, {
          limit: flags.limit,
          query: flags.query,
          full: flags.full,
          cursor,
          statsPeriod: flags.period,
        })
    );

    // Update pagination state (handles both advance and truncation)
    advancePaginationState(PAGINATION_KEY, contextKey, direction, nextCursor);
    const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);

    const hasMore = !!nextCursor;

    // Build footer hint based on result state
    const nav = paginationHint({
      hasMore,
      hasPrev,
      prevHint: prevPageHint(issueArg, flags),
      nextHint: nextPageHint(issueArg, flags),
    });
    let hint: string | undefined;
    if (events.length === 0 && nav) {
      hint = `No events on this page. ${nav}`;
    } else if (events.length > 0) {
      const countText = `Showing ${events.length} event${events.length === 1 ? "" : "s"}.`;
      hint = nav
        ? `${countText} ${nav}`
        : `${countText} Use 'sentry event view <EVENT_ID>' to view full event details.`;
    }

    yield new CommandOutput({
      events,
      hasMore,
      hasPrev,
      nextCursor,
      issueShortId: issue.shortId,
      issueId: issue.id,
    });
    return { hint };
  },
});
