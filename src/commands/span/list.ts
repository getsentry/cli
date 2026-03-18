/**
 * sentry span list
 *
 * List spans in a distributed trace with optional filtering and sorting.
 */

import type { SentryContext } from "../../context.js";
import type { SpanSortValue } from "../../lib/api/traces.js";
import { listSpans } from "../../lib/api-client.js";
import { validateLimit } from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import {
  buildPaginationContextKey,
  clearPaginationCursor,
  resolveOrgCursor,
  setPaginationCursor,
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
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
  LIST_CURSOR_FLAG,
} from "../../lib/list-command.js";
import { withProgress } from "../../lib/polling.js";
import {
  parseTraceTarget,
  resolveTraceOrgProject,
  warnIfNormalized,
} from "../../lib/trace-target.js";

type ListFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly sort: SpanSortValue;
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

/** Pagination storage key for cursor resume */
export const PAGINATION_KEY = "span-list";

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry span list [<org>/<project>/]<trace-id>";

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

/** Build the CLI hint for fetching the next page, preserving active flags. */
function nextPageHint(
  org: string,
  project: string,
  traceId: string,
  flags: Pick<ListFlags, "sort" | "query">
): string {
  const base = `sentry span list ${org}/${project}/${traceId} -c last`;
  const parts: string[] = [];
  if (flags.sort !== DEFAULT_SORT) {
    parts.push(`--sort ${flags.sort}`);
  }
  if (flags.query) {
    parts.push(`-q "${flags.query}"`);
  }
  return parts.length > 0 ? `${base} ${parts.join(" ")}` : base;
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
  /** Opaque cursor for fetching the next page (null/undefined when no more) */
  nextCursor?: string | null;
  /** The trace ID being queried */
  traceId: string;
};

/**
 * Format span list data for human-readable terminal output.
 *
 * Uses `renderMarkdown()` for the header and `formatSpanTable()` for the table,
 * ensuring proper rendering in both TTY and plain output modes.
 */
function formatSpanListHuman(data: SpanListData): string {
  if (data.flatSpans.length === 0) {
    return "No spans matched the query.";
  }
  const parts: string[] = [];
  parts.push(renderMarkdown(`Spans in trace \`${data.traceId}\`:\n`));
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

export const listCommand = buildCommand({
  docs: {
    brief: "List spans in a trace",
    fullDescription:
      "List spans in a distributed trace with optional filtering and sorting.\n\n" +
      "Target specification:\n" +
      "  sentry span list <trace-id>                       # auto-detect from DSN or config\n" +
      "  sentry span list <org>/<project>/<trace-id>       # explicit org and project\n" +
      "  sentry span list <project> <trace-id>             # find project across all orgs\n\n" +
      "The trace ID is the 32-character hexadecimal identifier.\n\n" +
      "Pagination:\n" +
      "  sentry span list <trace-id> -c last               # fetch next page\n\n" +
      "Examples:\n" +
      "  sentry span list <trace-id>                       # List spans in trace\n" +
      "  sentry span list <trace-id> --limit 50            # Show more spans\n" +
      '  sentry span list <trace-id> -q "op:db"            # Filter by operation\n' +
      "  sentry span list <trace-id> --sort duration       # Sort by slowest first\n" +
      '  sentry span list <trace-id> -q "duration:>100ms"  # Spans slower than 100ms\n\n' +
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
        brief:
          "[<org>/<project>/]<trace-id> - Target (optional) and trace ID (required)",
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
      cursor: LIST_CURSOR_FLAG,
      fresh: FRESH_FLAG,
    },
    aliases: {
      ...FRESH_ALIASES,
      n: "limit",
      q: "query",
      s: "sort",
      c: "cursor",
    },
  },
  async *func(this: SentryContext, flags: ListFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd, setContext } = this;

    // Parse and resolve org/project/trace-id
    const parsed = parseTraceTarget(args, USAGE_HINT);
    warnIfNormalized(parsed, "span.list");
    const { traceId, org, project } = await resolveTraceOrgProject(
      parsed,
      cwd,
      USAGE_HINT
    );
    setContext([org], [project]);

    // Build server-side query
    const queryParts = [`trace:${traceId}`];
    if (flags.query) {
      queryParts.push(translateSpanQuery(flags.query));
    }
    const apiQuery = queryParts.join(" ");

    // Build context key and resolve cursor for pagination
    const contextKey = buildPaginationContextKey(
      "span",
      `${org}/${project}/${traceId}`,
      { sort: flags.sort, q: flags.query }
    );
    const cursor = resolveOrgCursor(flags.cursor, PAGINATION_KEY, contextKey);

    // Fetch spans from EAP endpoint
    const { data: spanItems, nextCursor } = await withProgress(
      { message: "Fetching spans...", json: flags.json },
      () =>
        listSpans(org, project, {
          query: apiQuery,
          sort: flags.sort,
          limit: flags.limit,
          cursor,
        })
    );

    // Store or clear pagination cursor
    if (nextCursor) {
      setPaginationCursor(PAGINATION_KEY, contextKey, nextCursor);
    } else {
      clearPaginationCursor(PAGINATION_KEY, contextKey);
    }

    const flatSpans = spanItems.map(spanListItemToFlatSpan);
    const hasMore = !!nextCursor;

    // Build hint footer
    let hint: string | undefined;
    if (flatSpans.length === 0 && hasMore) {
      hint = `Try the next page: ${nextPageHint(org, project, traceId, flags)}`;
    } else if (flatSpans.length > 0) {
      const countText = `Showing ${flatSpans.length} span${flatSpans.length === 1 ? "" : "s"}.`;
      hint = hasMore
        ? `${countText} Next page: ${nextPageHint(org, project, traceId, flags)}`
        : `${countText} Use 'sentry span view ${traceId} <span-id>' to view span details.`;
    }

    yield new CommandOutput({ flatSpans, hasMore, nextCursor, traceId });
    return { hint };
  },
});
