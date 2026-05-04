/**
 * sentry replay list
 *
 * List Session Replays from Sentry.
 */

import type { SentryContext } from "../../context.js";
import {
  isReplaySortValue,
  listReplays,
  type ReplaySortValue,
} from "../../lib/api-client.js";
import { validateLimit } from "../../lib/arg-parsing.js";
import {
  advancePaginationState,
  buildPaginationContextKey,
  hasPreviousPage,
  resolveCursor,
} from "../../lib/db/pagination.js";
import {
  escapeMarkdownCell,
  formatRelativeTime,
  formatTable,
} from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import type { Column } from "../../lib/formatters/table.js";
import { formatDurationCompact } from "../../lib/formatters/time-utils.js";
import {
  appendQueryHint,
  appendSortHint,
  buildListCommand,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  LIST_MIN_LIMIT,
  LIST_PERIOD_FLAG,
  PERIOD_ALIASES,
  paginationHint,
  targetPatternExplanation,
} from "../../lib/list-command.js";
import { withProgress } from "../../lib/polling.js";
import {
  getReplayUserLabel,
  parseReplayEnvironmentFilter,
  replayMatchesPath,
} from "../../lib/replay-search.js";
import { resolveOrgOptionalProjectFromArg } from "../../lib/resolve-target.js";
import { sanitizeQuery } from "../../lib/search-query.js";
import {
  appendPeriodHint,
  serializeTimeRange,
  type TimeRange,
  timeRangeToApiParams,
} from "../../lib/time-range.js";
import {
  REPLAY_LIST_FIELDS,
  type ReplayListItem,
  ReplayListItemOutputSchema,
} from "../../types/index.js";

type ListFlags = {
  readonly environment?: readonly string[];
  readonly limit: number;
  readonly "problem-only": boolean;
  readonly friction: boolean;
  readonly "entry-path"?: string;
  readonly "exit-path"?: string;
  readonly path?: string;
  readonly query?: string;
  readonly sort: ReplaySortValue;
  readonly period: TimeRange;
  readonly json: boolean;
  readonly cursor?: string;
  readonly fresh: boolean;
  readonly fields?: string[];
  readonly url?: string;
};

type ReplayListResult = {
  replays: ReplayListItem[];
  hasMore: boolean;
  hasPrev: boolean;
  nextCursor?: string | null;
  org: string;
  project?: string;
};

type ReplaySortKey =
  | "activity"
  | "date"
  | "dead"
  | "duration"
  | "errors"
  | "oldest"
  | "rage"
  | "warnings";

type ReplayListHintFlags = Pick<
  ListFlags,
  | "entry-path"
  | "environment"
  | "exit-path"
  | "friction"
  | "path"
  | "problem-only"
  | "query"
  | "sort"
  | "period"
  | "url"
>;

const SORT_MAP: Record<ReplaySortKey, ReplaySortValue> = {
  activity: "-activity",
  date: "-started_at",
  dead: "-count_dead_clicks",
  duration: "-duration",
  errors: "-count_errors",
  oldest: "started_at",
  rage: "-count_rage_clicks",
  warnings: "-count_warnings",
};

const DEFAULT_PERIOD = LIST_PERIOD_FLAG.default;
const DEFAULT_SORT: ReplaySortValue = SORT_MAP.date;
const PAGINATION_KEY = "replay-list";
const COMMAND_NAME = "replay list";
const SIMPLE_SEARCH_VALUE_RE = /^[^\s:"]+$/;

function parseLimit(value: string): number {
  return validateLimit(value, LIST_MIN_LIMIT, LIST_MAX_LIMIT);
}

/**
 * Parse user-facing replay sort values into API sort expressions.
 */
export function parseSort(value: string): ReplaySortValue {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase() as ReplaySortKey;
  const mapped = SORT_MAP[normalized];
  if (mapped) {
    return mapped;
  }

  if (isReplaySortValue(trimmed)) {
    return trimmed;
  }

  throw new Error(
    `Invalid sort value. Must be one of: ${Object.keys(SORT_MAP).join(", ")} or a replay sort like -count_rage_clicks`
  );
}

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "0" : String(value);
}

function replayUserLabel(replay: ReplayListItem): string {
  return getReplayUserLabel(replay) ?? "—";
}

function quoteSearchValue(value: string): string {
  return SIMPLE_SEARCH_VALUE_RE.test(value) ? value : JSON.stringify(value);
}

function wildcardSearchValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("*")) {
    return trimmed;
  }
  return `*${trimmed}*`;
}

function buildReplaySearchQuery(filters: {
  query?: string;
  url?: string;
  path?: string;
  entryPath?: string;
  exitPath?: string;
}): string | undefined {
  const { entryPath, exitPath, path, query, url } = filters;
  const parts = [
    query,
    url ? `url:${quoteSearchValue(wildcardSearchValue(url))}` : undefined,
    path ? `url:${quoteSearchValue(wildcardSearchValue(path))}` : undefined,
    entryPath
      ? `url:${quoteSearchValue(wildcardSearchValue(entryPath))}`
      : undefined,
    exitPath
      ? `url:${quoteSearchValue(wildcardSearchValue(exitPath))}`
      : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function hasErrorOrWarningSignals(replay: ReplayListItem): boolean {
  return (
    (replay.count_errors ?? 0) > 0 ||
    (replay.count_warnings ?? 0) > 0 ||
    replay.error_ids.length > 0 ||
    replay.warning_ids.length > 0
  );
}

function hasFrictionSignals(replay: ReplayListItem): boolean {
  return (
    hasErrorOrWarningSignals(replay) ||
    (replay.count_rage_clicks ?? 0) > 0 ||
    (replay.count_dead_clicks ?? 0) > 0
  );
}

function replayMatchesRouteFilters(
  replay: ReplayListItem,
  flags: ListFlags
): boolean {
  if (flags.path && !replayMatchesPath(replay, flags.path)) {
    return false;
  }
  if (
    flags["entry-path"] &&
    !replayMatchesPath(replay, flags["entry-path"], "entry")
  ) {
    return false;
  }
  if (
    flags["exit-path"] &&
    !replayMatchesPath(replay, flags["exit-path"], "exit")
  ) {
    return false;
  }
  return true;
}

const REPLAY_COLUMNS: Column<ReplayListItem>[] = [
  {
    header: "ID",
    value: (replay) => `\`${replay.id.slice(0, 8)}\``,
    minWidth: 8,
    shrinkable: false,
  },
  {
    header: "STARTED",
    value: (replay) => formatRelativeTime(replay.started_at ?? undefined),
    minWidth: 10,
  },
  {
    header: "DURATION",
    value: (replay) => formatDurationCompact(replay.duration),
    minWidth: 10,
  },
  {
    header: "ERRORS",
    value: (replay) => formatCount(replay.count_errors),
    align: "right",
    minWidth: 6,
  },
  {
    header: "SEGMENTS",
    value: (replay) => formatCount(replay.count_segments),
    align: "right",
    minWidth: 8,
  },
  {
    header: "USER",
    value: (replay) => escapeMarkdownCell(replayUserLabel(replay)),
    minWidth: 16,
    truncate: true,
  },
  {
    header: "PROJECT",
    value: (replay) =>
      replay.project_id !== null && replay.project_id !== undefined
        ? String(replay.project_id)
        : "—",
    minWidth: 7,
  },
];

function formatScope(org: string, project?: string): string {
  return project ? `${org}/${project}` : `${org}/`;
}

function appendReplayFlags(base: string, flags: ReplayListHintFlags): string {
  const parts: string[] = [];
  appendQueryHint(parts, flags.query);
  appendSortHint(parts, flags.sort, DEFAULT_SORT);
  if (flags.url) {
    parts.push(`--url "${flags.url}"`);
  }
  if (flags.path) {
    parts.push(`--path "${flags.path}"`);
  }
  if (flags["entry-path"]) {
    parts.push(`--entry-path "${flags["entry-path"]}"`);
  }
  if (flags["exit-path"]) {
    parts.push(`--exit-path "${flags["exit-path"]}"`);
  }
  if (flags.friction) {
    parts.push("--friction");
  }
  if (flags["problem-only"]) {
    parts.push("--problem-only");
  }
  if (flags.environment && flags.environment.length > 0) {
    for (const environment of flags.environment) {
      parts.push(`-e "${environment}"`);
    }
  }
  appendPeriodHint(parts, flags.period, DEFAULT_PERIOD);
  return parts.length > 0 ? `${base} ${parts.join(" ")}` : base;
}

function nextPageHint(
  org: string,
  project: string | undefined,
  flags: ReplayListHintFlags
): string {
  return appendReplayFlags(
    `sentry replay list ${formatScope(org, project)} -c next`,
    flags
  );
}

function prevPageHint(
  org: string,
  project: string | undefined,
  flags: ReplayListHintFlags
): string {
  return appendReplayFlags(
    `sentry replay list ${formatScope(org, project)} -c prev`,
    flags
  );
}

function formatReplayListHuman(result: ReplayListResult): string {
  const { replays, hasMore, org, project } = result;
  if (replays.length === 0) {
    return hasMore ? "No replays on this page." : "No replays found.";
  }

  const scope = project ? `${org}/${project}` : `${org} (all projects)`;
  return `Recent replays in ${scope}:\n\n${formatTable(replays, REPLAY_COLUMNS, { truncate: true })}`;
}

function jsonTransformReplayList(
  result: ReplayListResult,
  fields?: string[]
): unknown {
  const items =
    fields && fields.length > 0
      ? result.replays.map((replay) => filterFields(replay, fields))
      : result.replays;

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

export const listCommand = buildListCommand("replay", {
  docs: {
    brief: "List recent Session Replays",
    fullDescription:
      "List recent Session Replays from Sentry.\n\n" +
      "Target patterns:\n" +
      "  sentry replay list              # auto-detect org from config or DSN\n" +
      "  sentry replay list <org>/       # list all org replays\n" +
      "  sentry replay list <org>/<proj> # list replays for one project\n" +
      "  sentry replay list <project>    # find project across all orgs\n\n" +
      `${targetPatternExplanation()}\n\n` +
      "Examples:\n" +
      "  sentry replay list\n" +
      "  sentry replay list sentry/\n" +
      "  sentry replay list sentry/cli --limit 50\n" +
      "  sentry replay list sentry/cli --sort duration\n" +
      "  sentry replay list sentry/cli --path /signup --friction\n" +
      '  sentry replay list sentry/cli -q "user.email:foo@example.com"\n' +
      "  sentry replay list sentry/cli -e production -e canary\n" +
      "  sentry replay list sentry/cli --period 24h\n\n" +
      "Alias: `sentry replays` → `sentry replay list`",
  },
  output: {
    human: formatReplayListHuman,
    jsonTransform: jsonTransformReplayList,
    schema: ReplayListItemOutputSchema,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/project",
          brief: "<org>/, <org>/<project>, or <project> (search)",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      limit: {
        kind: "parsed",
        parse: parseLimit,
        brief: `Number of replays (${LIST_MIN_LIMIT}-${LIST_MAX_LIMIT})`,
        default: String(LIST_DEFAULT_LIMIT),
      },
      query: {
        kind: "parsed",
        parse: sanitizeQuery,
        brief: "Search query (Sentry replay search syntax)",
        optional: true,
      },
      url: {
        kind: "parsed",
        parse: String,
        brief: "Filter by visited URL text using replay search",
        optional: true,
      },
      path: {
        kind: "parsed",
        parse: String,
        brief: "Filter by actual visited URL pathname",
        optional: true,
      },
      "entry-path": {
        kind: "parsed",
        parse: String,
        brief: "Filter by first visited URL pathname",
        optional: true,
      },
      "exit-path": {
        kind: "parsed",
        parse: String,
        brief: "Filter by last visited URL pathname",
        optional: true,
      },
      friction: {
        kind: "boolean",
        brief:
          "Only show replays with indexed friction signals (errors, warnings, rage clicks, or dead clicks)",
        default: false,
      },
      "problem-only": {
        kind: "boolean",
        brief: "Only show replays with indexed errors or warnings",
        default: false,
      },
      environment: {
        kind: "parsed",
        parse: String,
        brief: "Filter by environment (repeatable, comma-separated)",
        variadic: true,
        optional: true,
      },
      sort: {
        kind: "parsed",
        parse: parseSort,
        brief:
          "Sort by: date, oldest, duration, errors, warnings, rage, dead, activity, or a raw replay sort field",
        default: "date",
      },
      period: LIST_PERIOD_FLAG,
    },
    aliases: {
      ...PERIOD_ALIASES,
      e: "environment",
      n: "limit",
      q: "query",
      s: "sort",
      u: "url",
    },
  },
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    const { cwd } = this;
    const timeRange = flags.period;
    const environment = parseReplayEnvironmentFilter(flags.environment);
    const query = buildReplaySearchQuery({
      query: flags.query,
      url: flags.url,
      path: flags.path,
      entryPath: flags["entry-path"],
      exitPath: flags["exit-path"],
    });

    const resolved = await resolveOrgOptionalProjectFromArg(
      target,
      cwd,
      COMMAND_NAME
    );

    const contextKey = buildPaginationContextKey(
      "replay",
      formatScope(resolved.org, resolved.project),
      {
        env: environment?.join(","),
        entryPath: flags["entry-path"],
        exitPath: flags["exit-path"],
        friction: flags.friction ? "1" : undefined,
        path: flags.path,
        problem: flags["problem-only"] ? "1" : undefined,
        sort: flags.sort,
        q: query,
        period: serializeTimeRange(timeRange),
      }
    );
    const { cursor, direction } = resolveCursor(
      flags.cursor,
      PAGINATION_KEY,
      contextKey
    );

    const { data: fetchedReplays, nextCursor } = await withProgress(
      {
        message: `Fetching replays (up to ${flags.limit})...`,
        json: flags.json,
      },
      () =>
        listReplays(resolved.org, {
          environment,
          fields: [...REPLAY_LIST_FIELDS],
          limit: flags.limit,
          query,
          projectSlugs: resolved.project ? [resolved.project] : undefined,
          sort: flags.sort,
          cursor,
          ...timeRangeToApiParams(timeRange),
        })
    );
    const replays = fetchedReplays.filter((replay) => {
      if (!replayMatchesRouteFilters(replay, flags)) {
        return false;
      }
      if (flags["problem-only"]) {
        return hasErrorOrWarningSignals(replay);
      }
      return flags.friction ? hasFrictionSignals(replay) : true;
    });

    advancePaginationState(PAGINATION_KEY, contextKey, direction, nextCursor);
    const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);
    const hasMore = !!nextCursor;

    const nav = paginationHint({
      hasMore,
      hasPrev,
      prevHint: prevPageHint(resolved.org, resolved.project, flags),
      nextHint: nextPageHint(resolved.org, resolved.project, flags),
    });

    let hint: string | undefined;
    if (replays.length === 0 && nav) {
      hint = `No replays on this page. ${nav}`;
    } else if (replays.length > 0) {
      const countText = `Showing ${replays.length} replay${replays.length === 1 ? "" : "s"}.`;
      const firstReplay = replays[0];
      const replayHint = firstReplay
        ? `Use 'sentry replay view ${resolved.org}/${firstReplay.id}' for details.`
        : undefined;
      hint = nav
        ? `${countText} ${nav}`
        : [countText, replayHint].filter(Boolean).join(" ");
    }

    yield new CommandOutput({
      replays,
      hasMore,
      hasPrev,
      nextCursor,
      org: resolved.org,
      project: resolved.project,
    });
    return { hint };
  },
});
