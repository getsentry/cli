/**
 * sentry log list
 *
 * List and stream logs from Sentry projects.
 * Supports real-time streaming with --follow flag.
 * Supports --trace flag to filter logs by trace ID.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import type { SentryContext } from "../../context.js";
import { listLogs, listTraceLogs } from "../../lib/api-client.js";
import { validateLimit } from "../../lib/arg-parsing.js";
import { AuthError, ContextError, stringifyUnknown } from "../../lib/errors.js";
import {
  buildLogRowCells,
  createLogStreamingTable,
  displayTraceLogs,
  formatLogRow,
  formatLogsHeader,
  formatLogTable,
  isPlainOutput,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import { renderInlineMarkdown } from "../../lib/formatters/markdown.js";
import type { StreamingTable } from "../../lib/formatters/text-table.js";
import {
  applyFreshFlag,
  buildListCommand,
  FRESH_FLAG,
  TARGET_PATTERN_NOTE,
} from "../../lib/list-command.js";
import {
  resolveOrg,
  resolveOrgProjectFromArg,
} from "../../lib/resolve-target.js";
import { validateTraceId } from "../../lib/trace-id.js";
import { getUpdateNotification } from "../../lib/version-check.js";
import type { Writer } from "../../types/index.js";

type ListFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly follow?: number;
  readonly json: boolean;
  readonly trace?: string;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Maximum allowed value for --limit flag */
const MAX_LIMIT = 1000;

/** Minimum allowed value for --limit flag */
const MIN_LIMIT = 1;

/** Default number of log entries to show */
const DEFAULT_LIMIT = 100;

/** Default poll interval in seconds for --follow mode */
const DEFAULT_POLL_INTERVAL = 2;

/** Command name used in resolver error messages */
const COMMAND_NAME = "log list";

/**
 * Parse --limit flag, delegating range validation to shared utility.
 */
function parseLimit(value: string): number {
  return validateLimit(value, MIN_LIMIT, MAX_LIMIT);
}

/**
 * Parse --follow flag value.
 * Supports: -f (empty string → default interval), -f 10 (explicit interval)
 *
 * @throws Error if value is not a positive integer
 */
function parseFollow(value: string): number {
  if (value === "") {
    return DEFAULT_POLL_INTERVAL;
  }
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num < 1) {
    throw new Error("--follow interval must be a positive integer");
  }
  return num;
}

/**
 * Shape shared by both SentryLog and TraceLog — the minimum fields
 * needed for table rendering and follow-mode dedup tracking.
 */
type LogLike = {
  timestamp: string;
  /** Nanosecond-precision timestamp used for dedup in follow mode.
   * Optional because TraceLog may omit it when the API response doesn't include it. */
  timestamp_precise?: number;
  severity?: string | null;
  message?: string | null;
  trace?: string | null;
};

type WriteLogsOptions = {
  stdout: Writer;
  logs: LogLike[];
  asJson: boolean;
  table?: StreamingTable;
  /** Whether to append a short trace-ID suffix (default: true) */
  includeTrace?: boolean;
  /** Optional field paths to include in JSON output */
  fields?: string[];
};

/**
 * Write logs to output in the appropriate format.
 *
 * When a StreamingTable is provided (TTY mode), renders rows through the
 * bordered table. Otherwise falls back to plain markdown rows.
 */
function writeLogs(options: WriteLogsOptions): void {
  const { stdout, logs, asJson, table, includeTrace = true, fields } = options;
  if (asJson) {
    for (const log of logs) {
      writeJson(stdout, log, fields);
    }
  } else if (table) {
    for (const log of logs) {
      stdout.write(
        table.row(
          buildLogRowCells(log, true, includeTrace).map(renderInlineMarkdown)
        )
      );
    }
  } else {
    for (const log of logs) {
      stdout.write(formatLogRow(log, includeTrace));
    }
  }
}

/**
 * Execute a single fetch of logs (non-streaming mode).
 */
type SingleFetchOptions = {
  stdout: Writer;
  org: string;
  project: string;
  flags: ListFlags;
};

async function executeSingleFetch(options: SingleFetchOptions): Promise<void> {
  const { stdout, org, project, flags } = options;
  const logs = await listLogs(org, project, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: "90d",
  });

  if (flags.json) {
    // Reverse for chronological order (API returns newest first)
    writeJson(stdout, [...logs].reverse(), flags.fields);
    return;
  }

  if (logs.length === 0) {
    stdout.write("No logs found.\n");
    return;
  }

  // Reverse for chronological order (API returns newest first, tail shows oldest first)
  const chronological = [...logs].reverse();

  stdout.write(formatLogTable(chronological));

  // Show footer with tip if we hit the limit
  const hasMore = logs.length >= flags.limit;
  const countText = `Showing ${logs.length} log${logs.length === 1 ? "" : "s"}.`;
  const tip = hasMore ? " Use --limit to show more, or -f to follow." : "";
  writeFooter(stdout, `${countText}${tip}`);
}

/**
 * Configuration for the unified follow-mode loop.
 *
 * Parameterized over the log type to handle both project-scoped
 * (`SentryLog`) and trace-scoped (`TraceLog`) streaming.
 */
type FollowConfig<T extends LogLike> = {
  stdout: Writer;
  stderr: Writer;
  flags: ListFlags;
  /** Text for the stderr banner (e.g., "Streaming logs…") */
  bannerText: string;
  /** Whether to show the trace-ID column in table output */
  includeTrace: boolean;
  /**
   * Fetch logs with the given time window.
   * @param statsPeriod - Time window (e.g., "1m" for initial, "10m" for polls)
   * @param afterTimestamp - Only return logs newer than this (nanoseconds).
   *   Standard mode passes this for server-side dedup; trace mode ignores it.
   */
  fetch: (statsPeriod: string, afterTimestamp?: number) => Promise<T[]>;
  /** Extract only the genuinely new entries from a poll response */
  extractNew: (logs: T[], lastTimestamp: number) => T[];
  /**
   * Called with the initial batch of logs before polling begins.
   * Use this to seed dedup state (e.g., tracking seen log IDs).
   */
  onInitialLogs?: (logs: T[]) => void;
};

/**
 * Execute streaming mode (--follow flag).
 *
 * Uses `setTimeout`-based recursive scheduling so that SIGINT can
 * cleanly cancel the pending timer and resolve the returned promise
 * without `process.exit()`.
 */
function executeFollowMode<T extends LogLike>(
  config: FollowConfig<T>
): Promise<void> {
  const { stdout, stderr, flags } = config;
  const pollInterval = flags.follow ?? DEFAULT_POLL_INTERVAL;
  const pollIntervalMs = pollInterval * 1000;

  if (!flags.json) {
    stderr.write(`${config.bannerText} (poll interval: ${pollInterval}s)\n`);
    stderr.write("Press Ctrl+C to stop.\n");

    const notification = getUpdateNotification();
    if (notification) {
      stderr.write(notification);
    }
    stderr.write("\n");
  }

  const plain = flags.json || isPlainOutput();
  const table = plain ? undefined : createLogStreamingTable();

  let headerPrinted = false;
  // timestamp_precise is nanoseconds; Date.now() is milliseconds → convert
  let lastTimestamp = Date.now() * 1_000_000;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  return new Promise<void>((resolve, reject) => {
    function stop() {
      stopped = true;
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      if (table) {
        stdout.write(table.footer());
      }
      resolve();
    }

    process.once("SIGINT", stop);

    function scheduleNextPoll() {
      if (stopped) {
        return;
      }
      pendingTimer = setTimeout(poll, pollIntervalMs);
    }

    /** Find the highest timestamp_precise in a batch, or undefined if none have it. */
    function maxTimestamp(logs: T[]): number | undefined {
      let max: number | undefined;
      for (const l of logs) {
        if (l.timestamp_precise !== undefined) {
          max =
            max === undefined
              ? l.timestamp_precise
              : Math.max(max, l.timestamp_precise);
        }
      }
      return max;
    }

    function writeNewLogs(newLogs: T[]) {
      if (newLogs.length === 0) {
        return;
      }

      if (!(flags.json || headerPrinted)) {
        stdout.write(table ? table.header() : formatLogsHeader());
        headerPrinted = true;
      }
      const chronological = [...newLogs].reverse();
      writeLogs({
        stdout,
        logs: chronological,
        asJson: flags.json,
        table,
        includeTrace: config.includeTrace,
        fields: config.flags.fields,
      });
      lastTimestamp = maxTimestamp(newLogs) ?? lastTimestamp;
    }

    async function poll() {
      pendingTimer = null;
      if (stopped) {
        return;
      }
      try {
        const rawLogs = await config.fetch("10m", lastTimestamp);
        const newLogs = config.extractNew(rawLogs, lastTimestamp);
        writeNewLogs(newLogs);
        scheduleNextPoll();
      } catch (error) {
        if (error instanceof AuthError) {
          process.removeListener("SIGINT", stop);
          reject(error);
          return;
        }
        Sentry.captureException(error);
        const message = stringifyUnknown(error);
        stderr.write(`Error fetching logs: ${message}\n`);
        scheduleNextPoll();
      }
    }

    // Fire-and-forget: we cannot `await` here because `resolve` must
    // remain callable by the SIGINT handler (`stop`) at any time.
    config
      .fetch("1m")
      .then((initialLogs) => {
        if (!flags.json && initialLogs.length > 0) {
          stdout.write(table ? table.header() : formatLogsHeader());
          headerPrinted = true;
        }
        const chronological = [...initialLogs].reverse();
        writeLogs({
          stdout,
          logs: chronological,
          asJson: flags.json,
          table,
          includeTrace: config.includeTrace,
          fields: config.flags.fields,
        });
        lastTimestamp = maxTimestamp(initialLogs) ?? lastTimestamp;
        config.onInitialLogs?.(initialLogs);
        scheduleNextPoll();
      })
      .catch((error: unknown) => {
        process.removeListener("SIGINT", stop);
        reject(error);
      });
  });
}

/** Default time period for trace-logs queries */
const DEFAULT_TRACE_PERIOD = "14d";

/**
 * Execute a single fetch of trace-filtered logs (non-streaming, --trace mode).
 * Uses the dedicated trace-logs endpoint which is org-scoped.
 */
type TraceSingleFetchOptions = {
  stdout: Writer;
  org: string;
  traceId: string;
  flags: ListFlags;
};

async function executeTraceSingleFetch(
  options: TraceSingleFetchOptions
): Promise<void> {
  const { stdout, org, traceId, flags } = options;
  const logs = await listTraceLogs(org, traceId, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: DEFAULT_TRACE_PERIOD,
  });

  displayTraceLogs({
    stdout,
    logs,
    traceId,
    limit: flags.limit,
    asJson: flags.json,
    fields: flags.fields,
    emptyMessage:
      `No logs found for trace ${traceId} in the last ${DEFAULT_TRACE_PERIOD}.\n\n` +
      "Try 'sentry trace logs' for more options (e.g., --period 30d).\n",
  });
}

export const listCommand = buildListCommand("log", {
  docs: {
    brief: "List logs from a project",
    fullDescription:
      "List and stream logs from Sentry projects.\n\n" +
      "Target patterns:\n" +
      "  sentry log list               # auto-detect from DSN or config\n" +
      "  sentry log list <org>/<proj>  # explicit org and project\n" +
      "  sentry log list <project>     # find project across all orgs\n\n" +
      `${TARGET_PATTERN_NOTE}\n\n` +
      "Trace filtering:\n" +
      "  When --trace is given, only org resolution is needed (the trace-logs\n" +
      "  endpoint is org-scoped). The positional target is treated as an org\n" +
      "  slug, not an org/project pair.\n\n" +
      "Examples:\n" +
      "  sentry log list                    # List last 100 logs\n" +
      "  sentry log list -f                 # Stream logs (2s poll interval)\n" +
      "  sentry log list -f 5               # Stream logs (5s poll interval)\n" +
      "  sentry log list --limit 50         # Show last 50 logs\n" +
      "  sentry log list -q 'level:error'   # Filter to errors only\n" +
      "  sentry log list --trace abc123def456abc123def456abc123de  # Filter by trace",
  },
  output: "json",
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
        brief: `Number of log entries (${MIN_LIMIT}-${MAX_LIMIT})`,
        default: String(DEFAULT_LIMIT),
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Filter query (Sentry search syntax)",
        optional: true,
      },
      follow: {
        kind: "parsed",
        parse: parseFollow,
        brief: "Stream logs (optionally specify poll interval in seconds)",
        optional: true,
        inferEmpty: true,
      },
      trace: {
        kind: "parsed",
        parse: validateTraceId,
        brief: "Filter logs by trace ID (32-character hex string)",
        optional: true,
      },
      fresh: FRESH_FLAG,
    },
    aliases: {
      n: "limit",
      q: "query",
      f: "follow",
    },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    applyFreshFlag(flags);
    const { stdout, stderr, cwd, setContext } = this;

    if (flags.trace) {
      // Trace mode: use the org-scoped trace-logs endpoint.
      // The positional target is treated as an org slug (not org/project).
      const resolved = await resolveOrg({
        org: target,
        cwd,
      });
      if (!resolved) {
        throw new ContextError("Organization", "sentry log list --trace <id>", [
          "Set a default org with 'sentry org list', or specify one explicitly",
          `Example: sentry log list myorg --trace ${flags.trace}`,
        ]);
      }
      const { org } = resolved;
      setContext([org], []);

      if (flags.follow) {
        const traceId = flags.trace;
        // Track IDs of logs seen without timestamp_precise so they are
        // shown once but not duplicated on subsequent polls.
        const seenWithoutTs = new Set<string>();
        await executeFollowMode({
          stdout,
          stderr,
          flags,
          bannerText: `Streaming logs for trace ${traceId}...`,
          includeTrace: false,
          fetch: (statsPeriod) =>
            listTraceLogs(org, traceId, {
              query: flags.query,
              limit: flags.limit,
              statsPeriod,
            }),
          extractNew: (logs, lastTs) =>
            logs.filter((l) => {
              if (l.timestamp_precise !== undefined) {
                return l.timestamp_precise > lastTs;
              }
              // No precise timestamp — deduplicate by id
              if (seenWithoutTs.has(l.id)) {
                return false;
              }
              seenWithoutTs.add(l.id);
              return true;
            }),
          onInitialLogs: (logs) => {
            for (const l of logs) {
              if (l.timestamp_precise === undefined) {
                seenWithoutTs.add(l.id);
              }
            }
          },
        });
      } else {
        await executeTraceSingleFetch({
          stdout,
          org,
          traceId: flags.trace,
          flags,
        });
      }
    } else {
      // Standard project-scoped mode
      const { org, project } = await resolveOrgProjectFromArg(
        target,
        cwd,
        COMMAND_NAME
      );
      setContext([org], [project]);

      if (flags.follow) {
        await executeFollowMode({
          stdout,
          stderr,
          flags,
          bannerText: "Streaming logs...",
          includeTrace: true,
          fetch: (statsPeriod, afterTimestamp) =>
            listLogs(org, project, {
              query: flags.query,
              limit: flags.limit,
              statsPeriod,
              afterTimestamp,
            }),
          extractNew: (logs) => logs,
        });
      } else {
        await executeSingleFetch({
          stdout,
          org,
          project,
          flags,
        });
      }
    }
  },
});
