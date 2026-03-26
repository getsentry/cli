/**
 * sentry span list
 *
 * List spans from a Sentry project, or within a specific trace.
 *
 * Dual-mode command (like `log list`):
 * - **Project mode** (no trace ID): lists spans across the entire project
 * - **Trace mode** (trace ID provided): lists spans within a specific trace
 *
 * Disambiguation uses {@link isTraceId} to detect 32-char hex trace IDs.
 */

import type { SentryContext } from "../../context.js";
import type { SpanSortValue } from "../../lib/api/traces.js";
import { listSpans } from "../../lib/api-client.js";
import { validateLimit } from "../../lib/arg-parsing.js";
import {
  advancePaginationState,
  buildPaginationContextKey,
  hasPreviousPage,
  resolveCursor,
} from "../../lib/db/pagination.js";
import {
  type FlatSpan,
  formatSpanTable,
  spanListItemToFlatSpan,
  translateSpanQuery,
} from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { renderMarkdown } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  buildListCommand,
  LIST_PERIOD_FLAG,
  PERIOD_ALIASES,
  TARGET_PATTERN_NOTE,
} from "../../lib/list-command.js";
import { withProgress } from "../../lib/polling.js";
import { resolveOrgProjectFromArg } from "../../lib/resolve-target.js";
import {
  type ParsedTraceTarget,
  parseDualModeArgs,
  resolveTraceOrgProject,
  warnIfNormalized,
} from "../../lib/trace-target.js";

type ListFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly sort: SpanSortValue;
  readonly period: string;
  readonly cursor?: string;
  readonly json: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Accepted values for the --sort flag (matches trace list) */
const VALID_SORT_VALUES: SpanSortValue[] = ["date", "duration"];

/**
 * CLI-side upper bound for --limit.
 *
 * Passed directly as `per_page` to the Sentry Events API (spans dataset).
 * Matches the cap used by `issue list`, `trace list`, and `log list`.
 */
const MAX_LIMIT = 1000;

/** Default number of spans to show */
const DEFAULT_LIMIT = 25;

/** Default sort order for span results */
const DEFAULT_SORT: SpanSortValue = "date";

/** Default time period for span queries */
const DEFAULT_PERIOD = "7d";

/** Pagination storage key for trace-scoped span listing */
export const PAGINATION_KEY = "span-list";

/** Pagination storage key for project-scoped span listing */
export const PROJECT_PAGINATION_KEY = "span-search";

/** Command name used in resolver error messages (project mode) */
const COMMAND_NAME = "span list";

/** Usage hint for trace-mode ContextError messages */
const TRACE_USAGE_HINT = "sentry span list [<org>/<project>/]<trace-id>";

/**
 * Parse --limit flag, delegating range validation to shared utility.
 */
function parseLimit(value: string): number {
  return validateLimit(value, 1, MAX_LIMIT);
}

/**
 * Parse and validate sort flag value.
 *
 * @throws Error if value is not "date" or "duration"
 */
export function parseSort(value: string): SpanSortValue {
  if (!VALID_SORT_VALUES.includes(value as SpanSortValue)) {
    throw new Error(
      `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
    );
  }
  return value as SpanSortValue;
}

/**
 * Disambiguate span list positional arguments.
 *
 * Thin wrapper around {@link parseDualModeArgs} that binds the
 * trace-mode usage hint for span list.
 */
export function parseSpanListArgs(
  args: string[]
): ReturnType<typeof parseDualModeArgs> {
  return parseDualModeArgs(args, TRACE_USAGE_HINT);
}

// ---------------------------------------------------------------------------
// Next-page hints
// ---------------------------------------------------------------------------

/** Append active non-default flags to a base next-page command. */
function appendFlagHints(
  base: string,
  flags: Pick<ListFlags, "sort" | "query" | "period">
): string {
  const parts: string[] = [];
  if (flags.sort !== DEFAULT_SORT) {
    parts.push(`--sort ${flags.sort}`);
  }
  if (flags.query) {
    parts.push(`-q "${flags.query}"`);
  }
  if (flags.period !== DEFAULT_PERIOD) {
    parts.push(`--period ${flags.period}`);
  }
  return parts.length > 0 ? `${base} ${parts.join(" ")}` : base;
}

/** Build the CLI hint for fetching the next page in trace mode. */
function traceNextPageHint(
  org: string,
  project: string,
  traceId: string,
  flags: Pick<ListFlags, "sort" | "query" | "period">
): string {
  return appendFlagHints(
    `sentry span list ${org}/${project}/${traceId} -c next`,
    flags
  );
}

/** Build the CLI hint for fetching the previous page in trace mode. */
function tracePrevPageHint(
  org: string,
  project: string,
  traceId: string,
  flags: Pick<ListFlags, "sort" | "query" | "period">
): string {
  return appendFlagHints(
    `sentry span list ${org}/${project}/${traceId} -c prev`,
    flags
  );
}

/** Build the CLI hint for fetching the next page in project mode. */
function projectNextPageHint(
  org: string,
  project: string,
  flags: Pick<ListFlags, "sort" | "query" | "period">
): string {
  return appendFlagHints(`sentry span list ${org}/${project} -c next`, flags);
}

/** Build the CLI hint for fetching the previous page in project mode. */
function projectPrevPageHint(
  org: string,
  project: string,
  flags: Pick<ListFlags, "sort" | "query" | "period">
): string {
  return appendFlagHints(`sentry span list ${org}/${project} -c prev`, flags);
}

// ---------------------------------------------------------------------------
// Output config types and formatters
// ---------------------------------------------------------------------------

/** Structured data returned by the command for both JSON and human output */
type SpanListData = {
  /** Flattened span items for display */
  flatSpans: FlatSpan[];
  /** Whether more results are available beyond the limit */
  hasMore: boolean;
  /** Whether a previous page exists (for bidirectional hints) */
  hasPrev?: boolean;
  /** Opaque cursor for fetching the next page (null/undefined when no more) */
  nextCursor?: string | null;
  /** The trace ID being queried (only in trace mode) */
  traceId?: string;
  /** Org slug for project-mode header */
  org?: string;
  /** Project slug for project-mode header */
  project?: string;
};

/**
 * Format span list data for human-readable terminal output.
 *
 * Uses `renderMarkdown()` for the header and `formatSpanTable()` for the table,
 * ensuring proper rendering in both TTY and plain output modes.
 */
function formatSpanListHuman(data: SpanListData): string {
  if (data.flatSpans.length === 0) {
    return data.hasMore
      ? "No spans on this page."
      : "No spans matched the query.";
  }
  const parts: string[] = [];
  if (data.traceId) {
    parts.push(renderMarkdown(`Spans in trace \`${data.traceId}\`:\n`));
  } else {
    parts.push(`Spans in ${data.org}/${data.project}:\n\n`);
  }
  parts.push(formatSpanTable(data.flatSpans));
  return parts.join("\n");
}

/**
 * Transform span list data for JSON output.
 *
 * Produces a `{ data: [...], hasMore, nextCursor? }` envelope matching the
 * standard paginated list format. Applies `--fields` filtering per element.
 */
function jsonTransformSpanList(data: SpanListData, fields?: string[]): unknown {
  const items =
    fields && fields.length > 0
      ? data.flatSpans.map((item) => filterFields(item, fields))
      : data.flatSpans;
  const envelope: Record<string, unknown> = {
    data: items,
    hasMore: data.hasMore,
    hasPrev: !!data.hasPrev,
  };
  if (
    data.nextCursor !== null &&
    data.nextCursor !== undefined &&
    data.nextCursor !== ""
  ) {
    envelope.nextCursor = data.nextCursor;
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Mode handlers — extracted from func() to stay under biome complexity limit
// ---------------------------------------------------------------------------

/** Shared context passed to mode handlers from the Stricli command function. */
type ModeContext = {
  cwd: string;
  flags: ListFlags;
};

/**
 * Handle trace mode: list spans within a specific trace.
 *
 * Resolves the trace target, builds a query prefixed with `trace:{id}`,
 * and returns the result with a trace-specific header and hints.
 */
async function handleTraceMode(
  parsed: ParsedTraceTarget,
  ctx: ModeContext
): Promise<{ output: SpanListData; hint?: string }> {
  const { flags, cwd } = ctx;
  warnIfNormalized(parsed, "span.list");
  const { traceId, org, project } = await resolveTraceOrgProject(
    parsed,
    cwd,
    TRACE_USAGE_HINT
  );
  const queryParts = [`trace:${traceId}`];
  if (flags.query) {
    queryParts.push(translateSpanQuery(flags.query));
  }
  const apiQuery = queryParts.join(" ");

  const contextKey = buildPaginationContextKey(
    "span",
    `${org}/${project}/${traceId}`,
    { sort: flags.sort, q: flags.query, period: flags.period }
  );
  const { cursor, direction } = resolveCursor(
    flags.cursor,
    PAGINATION_KEY,
    contextKey
  );

  const { data: spanItems, nextCursor } = await withProgress(
    { message: `Fetching spans (up to ${flags.limit})...`, json: flags.json },
    () =>
      listSpans(org, project, {
        query: apiQuery,
        sort: flags.sort,
        limit: flags.limit,
        cursor,
        statsPeriod: flags.period,
      })
  );

  // Update pagination state (handles both advance and truncation)
  advancePaginationState(PAGINATION_KEY, contextKey, direction, nextCursor);
  const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);

  const flatSpans = spanItems.map(spanListItemToFlatSpan);
  const hasMore = !!nextCursor;

  const navParts: string[] = [];
  if (hasPrev) {
    navParts.push(`Prev: ${tracePrevPageHint(org, project, traceId, flags)}`);
  }
  if (hasMore) {
    navParts.push(`Next: ${traceNextPageHint(org, project, traceId, flags)}`);
  }
  const nav = navParts.join(" | ");

  let hint: string | undefined;
  if (flatSpans.length === 0 && nav) {
    hint = `No spans on this page. ${nav}`;
  } else if (flatSpans.length > 0) {
    const countText = `Showing ${flatSpans.length} span${flatSpans.length === 1 ? "" : "s"}.`;
    hint = nav
      ? `${countText} ${nav}`
      : `${countText} Use 'sentry span view ${traceId} <span-id>' to view span details.`;
  }

  return {
    output: { flatSpans, hasMore, hasPrev, nextCursor, traceId },
    hint,
  };
}

/**
 * Handle project mode: list spans across the entire project.
 *
 * Resolves the org/project target and queries the spans dataset
 * without a trace ID filter.
 */
async function handleProjectMode(
  target: string | undefined,
  ctx: ModeContext
): Promise<{ output: SpanListData; hint?: string }> {
  const { flags, cwd } = ctx;
  const { org, project } = await resolveOrgProjectFromArg(
    target,
    cwd,
    COMMAND_NAME
  );
  const apiQuery = flags.query ? translateSpanQuery(flags.query) : undefined;

  const contextKey = buildPaginationContextKey(
    "span-search",
    `${org}/${project}`,
    { sort: flags.sort, q: flags.query, period: flags.period }
  );
  const { cursor, direction } = resolveCursor(
    flags.cursor,
    PROJECT_PAGINATION_KEY,
    contextKey
  );

  const { data: spanItems, nextCursor } = await withProgress(
    { message: `Fetching spans (up to ${flags.limit})...`, json: flags.json },
    () =>
      listSpans(org, project, {
        query: apiQuery,
        sort: flags.sort,
        limit: flags.limit,
        cursor,
        statsPeriod: flags.period,
      })
  );

  // Update pagination state (handles both advance and truncation)
  advancePaginationState(
    PROJECT_PAGINATION_KEY,
    contextKey,
    direction,
    nextCursor
  );
  const hasPrev = hasPreviousPage(PROJECT_PAGINATION_KEY, contextKey);

  const flatSpans = spanItems.map(spanListItemToFlatSpan);
  const hasMore = !!nextCursor;

  const navParts: string[] = [];
  if (hasPrev) {
    navParts.push(`Prev: ${projectPrevPageHint(org, project, flags)}`);
  }
  if (hasMore) {
    navParts.push(`Next: ${projectNextPageHint(org, project, flags)}`);
  }
  const nav = navParts.join(" | ");

  let hint: string | undefined;
  if (flatSpans.length === 0 && nav) {
    hint = `No spans on this page. ${nav}`;
  } else if (flatSpans.length > 0) {
    const countText = `Showing ${flatSpans.length} span${flatSpans.length === 1 ? "" : "s"}.`;
    hint = nav
      ? `${countText} ${nav}`
      : `${countText} Use 'sentry span view <trace-id> <span-id>' to view span details.`;
  }

  return {
    output: { flatSpans, hasMore, hasPrev, nextCursor, org, project },
    hint,
  };
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export const listCommand = buildListCommand("span", {
  docs: {
    brief: "List spans in a project or trace",
    fullDescription:
      "List spans from a Sentry project, or within a specific trace.\n\n" +
      "Project mode (no trace ID):\n" +
      "  sentry span list                        # auto-detect from DSN or config\n" +
      "  sentry span list <org>/<project>        # explicit org and project\n" +
      "  sentry span list <project>              # find project across all orgs\n\n" +
      `${TARGET_PATTERN_NOTE}\n\n` +
      "Trace mode (provide a 32-char trace ID):\n" +
      "  sentry span list <trace-id>                      # auto-detect org/project\n" +
      "  sentry span list <org>/<project>/<trace-id>      # explicit\n" +
      "  sentry span list <project> <trace-id>            # find project + trace\n\n" +
      "Pagination:\n" +
      "  sentry span list -c next                # fetch next page (project mode)\n" +
      "  sentry span list -c prev                # fetch previous page\n" +
      "  sentry span list <trace-id> -c next     # fetch next page (trace mode)\n\n" +
      "Examples:\n" +
      "  sentry span list                        # List recent spans in project\n" +
      '  sentry span list -q "op:db"             # Find all DB spans\n' +
      '  sentry span list -q "duration:>100ms"   # Slow spans\n' +
      "  sentry span list --period 24h           # Last 24 hours only\n" +
      "  sentry span list --sort duration        # Sort by slowest first\n" +
      "  sentry span list <trace-id>             # Spans in a specific trace\n" +
      '  sentry span list <trace-id> -q "op:db"  # DB spans in a trace\n\n' +
      "Alias: `sentry spans` → `sentry span list`",
  },
  output: {
    human: formatSpanListHuman,
    jsonTransform: jsonTransformSpanList,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/project/trace-id",
        brief: "[<org>/<project>] or [<org>/<project>/]<trace-id>",
        parse: String,
      },
    },
    flags: {
      limit: {
        kind: "parsed",
        parse: parseLimit,
        brief: `Number of spans (<=${MAX_LIMIT})`,
        default: String(DEFAULT_LIMIT),
      },
      query: {
        kind: "parsed",
        parse: String,
        brief:
          'Filter spans (e.g., "op:db", "duration:>100ms", "project:backend")',
        optional: true,
      },
      sort: {
        kind: "parsed",
        parse: parseSort,
        brief: `Sort order: ${VALID_SORT_VALUES.join(", ")}`,
        default: DEFAULT_SORT,
      },
      period: LIST_PERIOD_FLAG,
    },
    aliases: {
      ...PERIOD_ALIASES,
      n: "limit",
      q: "query",
      s: "sort",
    },
  },
  async *func(this: SentryContext, flags: ListFlags, ...args: string[]) {
    const { cwd } = this;
    const parsed = parseSpanListArgs(args);
    const modeCtx: ModeContext = { cwd, flags };

    const { output, hint } =
      parsed.mode === "trace"
        ? await handleTraceMode(parsed.parsed, modeCtx)
        : await handleProjectMode(parsed.target, modeCtx);

    yield new CommandOutput(output);
    return { hint };
  },
});
