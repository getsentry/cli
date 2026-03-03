/**
 * sentry trace list
 *
 * List recent traces from Sentry projects.
 */

import type { SentryContext } from "../../context.js";
import { listTransactions } from "../../lib/api-client.js";
import { validateLimit } from "../../lib/arg-parsing.js";
import {
  buildPaginationContextKey,
  clearPaginationCursor,
  resolveOrgCursor,
  setPaginationCursor,
} from "../../lib/db/pagination.js";
import {
  formatTraceTable,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  buildListCommand,
  LIST_CURSOR_FLAG,
  TARGET_PATTERN_NOTE,
} from "../../lib/list-command.js";
import { resolveOrgProjectFromArg } from "../../lib/resolve-target.js";

type ListFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly sort: "date" | "duration";
  readonly json: boolean;
  readonly cursor?: string;
};

type SortValue = "date" | "duration";

/** Accepted values for the --sort flag */
const VALID_SORT_VALUES: SortValue[] = ["date", "duration"];

/** Maximum allowed value for --limit flag */
const MAX_LIMIT = 1000;

/** Minimum allowed value for --limit flag */
const MIN_LIMIT = 1;

/** Default number of traces to show */
const DEFAULT_LIMIT = 20;

/** Command name used in resolver error messages */
const COMMAND_NAME = "trace list";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "trace-list";

/** Build the CLI hint for fetching the next page, preserving active flags. */
function nextPageHint(org: string, project: string, flags: ListFlags): string {
  const base = `sentry trace list ${org}/${project} -c last`;
  const parts: string[] = [];
  if (flags.sort !== "date") {
    parts.push(`--sort ${flags.sort}`);
  }
  if (flags.query) {
    parts.push(`-q "${flags.query}"`);
  }
  return parts.length > 0 ? `${base} ${parts.join(" ")}` : base;
}

/**
 * Parse --limit flag, delegating range validation to shared utility.
 */
function parseLimit(value: string): number {
  return validateLimit(value, MIN_LIMIT, MAX_LIMIT);
}

/**
 * Parse and validate sort flag value.
 *
 * @throws Error if value is not "date" or "duration"
 * @internal Exported for testing
 */
export function parseSort(value: string): SortValue {
  if (!VALID_SORT_VALUES.includes(value as SortValue)) {
    throw new Error(
      `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
    );
  }
  return value as SortValue;
}

export const listCommand = buildListCommand("trace", {
  docs: {
    brief: "List recent traces in a project",
    fullDescription:
      "List recent traces from Sentry projects.\n\n" +
      "Target patterns:\n" +
      "  sentry trace list               # auto-detect from DSN or config\n" +
      "  sentry trace list <org>/<proj>  # explicit org and project\n" +
      "  sentry trace list <project>     # find project across all orgs\n\n" +
      `${TARGET_PATTERN_NOTE}\n\n` +
      "Examples:\n" +
      "  sentry trace list                     # List last 10 traces\n" +
      "  sentry trace list --limit 50          # Show more traces\n" +
      "  sentry trace list --sort duration     # Sort by slowest first\n" +
      '  sentry trace list -q "transaction:GET /api/users"  # Filter by transaction',
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/project",
          brief: "<org>/<project> or <project> (search)",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      limit: {
        kind: "parsed",
        parse: parseLimit,
        brief: `Number of traces (${MIN_LIMIT}-${MAX_LIMIT})`,
        default: String(DEFAULT_LIMIT),
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Search query (Sentry search syntax)",
        optional: true,
      },
      sort: {
        kind: "parsed",
        parse: parseSort,
        brief: "Sort by: date, duration",
        default: "date" as const,
      },
      cursor: LIST_CURSOR_FLAG,
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
    aliases: { n: "limit", q: "query", s: "sort", c: "cursor" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    const { stdout, cwd, setContext } = this;

    // Resolve org/project from positional arg, config, or DSN auto-detection
    const { org, project } = await resolveOrgProjectFromArg(
      target,
      cwd,
      COMMAND_NAME
    );
    setContext([org], [project]);

    // Build context key and resolve cursor for pagination
    const contextKey = buildPaginationContextKey("trace", `${org}/${project}`, {
      sort: flags.sort,
      q: flags.query,
    });
    const cursor = resolveOrgCursor(flags.cursor, PAGINATION_KEY, contextKey);

    const { data: traces, nextCursor } = await listTransactions(org, project, {
      query: flags.query,
      limit: flags.limit,
      sort: flags.sort,
      cursor,
    });

    // Store or clear pagination cursor
    if (nextCursor) {
      setPaginationCursor(PAGINATION_KEY, contextKey, nextCursor);
    } else {
      clearPaginationCursor(PAGINATION_KEY, contextKey);
    }

    const hasMore = !!nextCursor;

    if (flags.json) {
      const output = hasMore
        ? { data: traces, nextCursor, hasMore: true }
        : { data: traces, hasMore: false };
      writeJson(stdout, output);
      return;
    }

    if (traces.length === 0) {
      if (hasMore) {
        stdout.write(
          `No traces on this page. Try the next page: ${nextPageHint(org, project, flags)}\n`
        );
      } else {
        stdout.write("No traces found.\n");
      }
      return;
    }

    stdout.write(`Recent traces in ${org}/${project}:\n\n`);
    stdout.write(formatTraceTable(traces));

    // Show footer with pagination info
    const countText = `Showing ${traces.length} trace${traces.length === 1 ? "" : "s"}.`;
    if (hasMore) {
      writeFooter(
        stdout,
        `${countText} Next page: ${nextPageHint(org, project, flags)}`
      );
    } else {
      writeFooter(
        stdout,
        `${countText} Use 'sentry trace view <TRACE_ID>' to view the full span tree.`
      );
    }
  },
});
