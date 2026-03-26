/**
 * sentry trace logs
 *
 * View logs associated with a distributed trace.
 */

import type { SentryContext } from "../../context.js";
import { type LogSortDirection, listTraceLogs } from "../../lib/api-client.js";
import { parseLogSort, validateLimit } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { filterFields } from "../../lib/formatters/json.js";
import { formatLogTable } from "../../lib/formatters/log.js";
import { CommandOutput, formatFooter } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { withProgress } from "../../lib/polling.js";
import { buildTraceUrl } from "../../lib/sentry-urls.js";
import {
  parseTraceTarget,
  resolveTraceOrg,
  warnIfNormalized,
} from "../../lib/trace-target.js";

type LogsFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly period: string;
  readonly limit: number;
  readonly query?: string;
  readonly sort: LogSortDirection;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Minimal log shape shared with the formatters. */
type LogLike = {
  timestamp: string;
  severity?: string | null;
  message?: string | null;
  trace?: string | null;
};

/** Data yielded by the trace logs command. */
type TraceLogsData = {
  logs: LogLike[];
  traceId: string;
  hasMore: boolean;
  /** Message shown when no logs found */
  emptyMessage?: string;
};

/** Format trace log results as human-readable table output. */
function formatTraceLogsHuman(data: TraceLogsData): string {
  if (data.logs.length === 0) {
    return data.emptyMessage ?? "No logs found.";
  }
  const parts = [formatLogTable(data.logs, false)];
  const countText = `Showing ${data.logs.length} log${data.logs.length === 1 ? "" : "s"} for trace ${data.traceId}.`;
  const tip = data.hasMore ? " Use --limit to show more." : "";
  parts.push(formatFooter(`${countText}${tip}`));
  return parts.join("").trimEnd();
}

/** Maximum allowed value for --limit flag */
const MAX_LIMIT = 1000;

/** Default number of log entries to show */
const DEFAULT_LIMIT = 100;

/**
 * Default time period for the trace-logs API.
 * The API requires statsPeriod — without it the response may be empty even
 * when logs exist for the trace.
 */
const DEFAULT_PERIOD = "14d";

/** Usage hint shown in error messages */
const USAGE_HINT = "sentry trace logs [<org>/]<trace-id>";

/**
 * Parse --limit flag, delegating range validation to shared utility.
 */
function parseLimit(value: string): number {
  return validateLimit(value, 1, MAX_LIMIT);
}

export const logsCommand = buildCommand({
  docs: {
    brief: "View logs associated with a trace",
    fullDescription:
      "View logs associated with a specific distributed trace.\n\n" +
      "Uses the dedicated trace-logs endpoint, which is org-scoped and\n" +
      "automatically queries all projects — no project flag needed.\n\n" +
      "Target specification:\n" +
      "  sentry trace logs <trace-id>          # auto-detect org\n" +
      "  sentry trace logs <org>/<trace-id>    # explicit org\n\n" +
      "The trace ID is the 32-character hexadecimal identifier.\n\n" +
      "Examples:\n" +
      "  sentry trace logs abc123def456abc123def456abc123de\n" +
      "  sentry trace logs myorg/abc123def456abc123def456abc123de\n" +
      "  sentry trace logs --period 7d abc123def456abc123def456abc123de\n" +
      "  sentry trace logs --json abc123def456abc123def456abc123de",
  },
  output: {
    human: formatTraceLogsHuman,
    jsonTransform: (data: TraceLogsData, fields?: string[]) => {
      const items =
        fields && fields.length > 0
          ? data.logs.map((entry) => filterFields(entry, fields))
          : data.logs;
      return { data: items, hasMore: data.hasMore };
    },
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/trace-id",
        brief: "[<org>/]<trace-id> - Optional org and required trace ID",
        parse: String,
      },
    },
    flags: {
      web: {
        kind: "boolean",
        brief: "Open trace in browser",
        default: false,
      },
      period: {
        kind: "parsed",
        parse: String,
        brief: `Time period to search (e.g., "14d", "7d", "24h"). Default: ${DEFAULT_PERIOD}`,
        default: DEFAULT_PERIOD,
      },
      limit: {
        kind: "parsed",
        parse: parseLimit,
        brief: `Number of log entries (<=${MAX_LIMIT})`,
        default: String(DEFAULT_LIMIT),
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Additional filter query (Sentry search syntax)",
        optional: true,
      },
      sort: {
        kind: "parsed",
        parse: parseLogSort,
        brief: 'Sort order: "newest" (default) or "oldest"',
        default: "newest",
      },
      fresh: FRESH_FLAG,
    },
    aliases: {
      ...FRESH_ALIASES,
      w: "web",
      t: "period",
      n: "limit",
      q: "query",
      s: "sort",
    },
  },
  async *func(this: SentryContext, flags: LogsFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd } = this;

    // Parse and resolve org/trace-id
    const parsed = parseTraceTarget(args, USAGE_HINT);
    warnIfNormalized(parsed, "trace.logs");
    const { traceId, org } = await resolveTraceOrg(parsed, cwd, USAGE_HINT);
    if (flags.web) {
      await openInBrowser(buildTraceUrl(org, traceId), "trace");
      return;
    }

    const logs = await withProgress(
      {
        message: `Fetching trace logs (up to ${flags.limit})...`,
        json: flags.json,
      },
      () =>
        listTraceLogs(org, traceId, {
          statsPeriod: flags.period,
          limit: flags.limit,
          query: flags.query,
          sort: flags.sort,
        })
    );

    const hasMore = logs.length >= flags.limit;

    const emptyMessage =
      `No logs found for trace ${traceId} in the last ${flags.period}.\n\n` +
      `Try a longer period: sentry trace logs --period 30d ${traceId}`;

    return yield new CommandOutput({
      logs,
      traceId,
      hasMore,
      emptyMessage,
    });
  },
});
