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
  formatLogRow,
  formatLogsHeader,
  isPlainOutput,
} from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { renderInlineMarkdown } from "../../lib/formatters/markdown.js";
import {
  type CommandOutput,
  commandOutput,
  formatFooter,
  type HumanRenderer,
  jsonlLines,
} from "../../lib/formatters/output.js";
import type { StreamingTable } from "../../lib/formatters/text-table.js";
import {
  applyFreshFlag,
  buildListCommand,
  FRESH_FLAG,
  TARGET_PATTERN_NOTE,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import {
  resolveOrg,
  resolveOrgProjectFromArg,
} from "../../lib/resolve-target.js";
import { validateTraceId } from "../../lib/trace-id.js";
import { getUpdateNotification } from "../../lib/version-check.js";

type ListFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly follow?: number;
  readonly json: boolean;
  readonly trace?: string;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/**
 * Result yielded by the log list command — one per batch.
 *
 * Both single-fetch and follow mode yield the same type. The human
 * renderer always renders incrementally (header on first non-empty
 * batch, rows per batch, footer via `finalize()`).
 */
type LogListResult = {
  logs: LogLike[];
  /** Trace ID, present for trace-filtered queries */
  traceId?: string;
  /**
   * When true, JSON output uses JSONL (one object per line) instead
   * of a JSON array. Set for follow-mode batches where output is
   * consumed incrementally. Does not affect human rendering.
   */
  jsonl?: boolean;
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

/** Result from a single fetch: logs to yield + hint for the footer. */
type FetchResult = {
  result: LogListResult;
  hint: string;
};

/**
 * Execute a single fetch of logs (non-streaming mode).
 *
 * Returns the logs and a hint. The caller yields the result and
 * returns the hint as a footer via `CommandReturn`.
 */
async function executeSingleFetch(
  org: string,
  project: string,
  flags: ListFlags
): Promise<FetchResult> {
  const logs = await listLogs(org, project, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: "90d",
  });

  if (logs.length === 0) {
    return { result: { logs: [] }, hint: "No logs found." };
  }

  // Reverse for chronological order (API returns newest first, tail shows oldest first)
  const chronological = [...logs].reverse();

  const hasMore = logs.length >= flags.limit;
  const countText = `Showing ${logs.length} log${logs.length === 1 ? "" : "s"}.`;
  const tip = hasMore ? " Use --limit to show more, or -f to follow." : "";

  return { result: { logs: chronological }, hint: `${countText}${tip}` };
}

// ---------------------------------------------------------------------------
// Streaming follow-mode infrastructure
// ---------------------------------------------------------------------------

/**
 * Sleep that resolves early when an AbortSignal fires.
 * Resolves (not rejects) on abort for clean generator shutdown.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Configuration for the follow-mode async generator.
 *
 * Parameterized over the log type to handle both project-scoped
 * (`SentryLog`) and trace-scoped (`TraceLog`) streaming.
 *
 * Unlike the old callback-based approach, this does NOT include
 * stdout/stderr. All stdout output flows through yielded chunks;
 * diagnostics are reported via the `onDiagnostic` callback.
 */
type FollowGeneratorConfig<T extends LogLike> = {
  flags: ListFlags;
  /** Report diagnostic/error messages (caller logs via logger) */
  onDiagnostic: (message: string) => void;
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

/** Find the highest timestamp_precise in a batch, or undefined if none have it. */
function maxTimestamp(logs: LogLike[]): number | undefined {
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

/**
 * Render a batch of log rows as a human-readable string.
 *
 * When a StreamingTable is provided (TTY mode), renders rows through the
 * bordered table. Otherwise falls back to plain markdown rows.
 */
function renderLogRows(
  logs: LogLike[],
  includeTrace: boolean,
  table?: StreamingTable
): string {
  let text = "";
  for (const log of logs) {
    if (table) {
      text += table.row(
        buildLogRowCells(log, true, includeTrace).map(renderInlineMarkdown)
      );
    } else {
      text += formatLogRow(log, includeTrace);
    }
  }
  return text;
}

/**
 * Execute a single poll iteration in follow mode.
 *
 * Returns the new logs, or `undefined` if a transient error occurred
 * (reported via `onDiagnostic`). Re-throws {@link AuthError}.
 */
async function fetchPoll<T extends LogLike>(
  config: FollowGeneratorConfig<T>,
  lastTimestamp: number
): Promise<T[] | undefined> {
  try {
    const rawLogs = await config.fetch("10m", lastTimestamp);
    return config.extractNew(rawLogs, lastTimestamp);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    Sentry.captureException(error);
    const message = stringifyUnknown(error);
    config.onDiagnostic(`Error fetching logs: ${message}\n`);
    return;
  }
}

/**
 * Async generator that streams log entries via follow-mode polling.
 *
 * Yields batches of log entries (chronological order). The command wraps
 * each batch in a `LogListResult` so the OutputConfig formatters can
 * handle incremental rendering and JSONL expansion.
 *
 * The generator handles SIGINT via AbortController for clean shutdown.
 * It never touches stdout — all data output flows through yielded batches
 * and diagnostics use the `onDiagnostic` callback.
 *
 * @throws {AuthError} if the API returns an authentication error
 */
async function* generateFollowLogs<T extends LogLike>(
  config: FollowGeneratorConfig<T>
): AsyncGenerator<T[], void, undefined> {
  const { flags } = config;
  const pollInterval = flags.follow ?? DEFAULT_POLL_INTERVAL;
  const pollIntervalMs = pollInterval * 1000;

  // timestamp_precise is nanoseconds; Date.now() is milliseconds → convert
  let lastTimestamp = Date.now() * 1_000_000;

  // AbortController for clean SIGINT handling
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);

  try {
    // Initial fetch
    const initialLogs = await config.fetch("1m");
    if (initialLogs.length > 0) {
      yield [...initialLogs].reverse();
    }
    lastTimestamp = maxTimestamp(initialLogs) ?? lastTimestamp;
    config.onInitialLogs?.(initialLogs);

    // Poll loop — exits when SIGINT fires
    while (!controller.signal.aborted) {
      await abortableSleep(pollIntervalMs, controller.signal);
      if (controller.signal.aborted) {
        break;
      }

      const newLogs = await fetchPoll(config, lastTimestamp);
      if (newLogs && newLogs.length > 0) {
        yield [...newLogs].reverse();
        lastTimestamp = maxTimestamp(newLogs) ?? lastTimestamp;
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
  }
}

/**
 * Consume a follow-mode generator, yielding `LogListResult` batches.
 * The generator returns when SIGINT fires — the wrapper's `finalize()`
 * callback handles closing the streaming table.
 */
async function* yieldFollowBatches<T extends LogLike>(
  generator: AsyncGenerator<T[], void, undefined>,
  extra?: Partial<LogListResult>
): AsyncGenerator<CommandOutput<LogListResult>, void, undefined> {
  for await (const batch of generator) {
    yield commandOutput({ logs: batch, jsonl: true, ...extra });
  }
}

/** Default time period for trace-logs queries */
const DEFAULT_TRACE_PERIOD = "14d";

/**
 * Execute a single fetch of trace-filtered logs (non-streaming, --trace mode).
 * Uses the dedicated trace-logs endpoint which is org-scoped.
 *
 * Returns the fetched logs, trace ID, and a human-readable hint.
 * The caller (via the output config) handles rendering to stdout.
 */
async function executeTraceSingleFetch(
  org: string,
  traceId: string,
  flags: ListFlags
): Promise<FetchResult> {
  const logs = await listTraceLogs(org, traceId, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: DEFAULT_TRACE_PERIOD,
  });

  if (logs.length === 0) {
    return {
      result: { logs: [], traceId },
      hint:
        `No logs found for trace ${traceId} in the last ${DEFAULT_TRACE_PERIOD}.\n\n` +
        "Try 'sentry trace logs' for more options (e.g., --period 30d).",
    };
  }

  const chronological = [...logs].reverse();

  const hasMore = logs.length >= flags.limit;
  const countText = `Showing ${logs.length} log${logs.length === 1 ? "" : "s"} for trace ${traceId}.`;
  const tip = hasMore ? " Use --limit to show more." : "";

  return {
    result: { logs: chronological, traceId },
    hint: `${countText}${tip}`,
  };
}

/**
 * Write the follow-mode banner via logger. Suppressed in JSON mode
 * to avoid stderr noise when agents consume JSONL output.
 */
function writeFollowBanner(
  pollInterval: number,
  bannerText: string,
  json: boolean
): void {
  if (json) {
    return;
  }
  logger.info(`${bannerText} (poll interval: ${pollInterval}s)`);
  logger.info("Press Ctrl+C to stop.");
  const notification = getUpdateNotification();
  if (notification) {
    logger.info(notification);
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/**
 * Create a stateful human renderer for log list output.
 *
 * The factory is called once per command invocation. The returned renderer
 * tracks streaming table state (header emitted, table instance) and cleans
 * up via `finalize()`.
 *
 * All yields go through `render()` — both single-fetch and follow mode.
 * The renderer emits the table header on the first non-empty batch, rows
 * per batch, and the table footer + hint via `finalize()`.
 */
function createLogRenderer(): HumanRenderer<LogListResult> {
  const plain = isPlainOutput();
  const table: StreamingTable | undefined = plain
    ? undefined
    : createLogStreamingTable();
  let headerEmitted = false;

  return {
    render(result: LogListResult): string {
      if (result.logs.length === 0) {
        return "";
      }

      const includeTrace = !result.traceId;
      let text = "";

      // Emit header on first non-empty batch
      if (!headerEmitted) {
        text += table ? table.header() : formatLogsHeader();
        headerEmitted = true;
      }

      text += renderLogRows(result.logs, includeTrace, table);
      return text.trimEnd();
    },

    finalize(hint?: string): string {
      let text = "";

      // Close the streaming table if header was emitted
      if (headerEmitted && table) {
        text += table.footer();
      }

      // Append hint (count, pagination, empty-state message)
      if (hint) {
        text += `${text ? "\n" : ""}${formatFooter(hint)}`;
      }

      return text;
    },
  };
}

/**
 * Transform log output into the JSON shape.
 *
 * - **Single-fetch** (`jsonl` absent/false): returns a JSON array.
 * - **Follow mode** (`jsonl: true`): returns JSONL-wrapped objects
 *   so the framework writes one JSON line per log entry.
 */
function jsonTransformLogOutput(
  result: LogListResult,
  fields?: string[]
): unknown {
  const applyFields = (log: LogLike) =>
    fields && fields.length > 0 ? filterFields(log, fields) : log;

  if (result.logs.length === 0) {
    // Follow mode: suppress empty batches (no JSONL output)
    // Single-fetch: return empty array for valid JSON
    return result.jsonl ? undefined : [];
  }

  const mapped = result.logs.map(applyFields);
  return result.jsonl ? jsonlLines(mapped) : mapped;
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
  output: {
    json: true,
    human: createLogRenderer,
    jsonTransform: jsonTransformLogOutput,
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
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    applyFreshFlag(flags);
    const { cwd, setContext } = this;

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

        // Banner (suppressed in JSON mode)
        writeFollowBanner(
          flags.follow ?? DEFAULT_POLL_INTERVAL,
          `Streaming logs for trace ${traceId}...`,
          flags.json
        );

        // Track IDs of logs seen without timestamp_precise so they are
        // shown once but not duplicated on subsequent polls.
        const seenWithoutTs = new Set<string>();
        const generator = generateFollowLogs({
          flags,
          onDiagnostic: (msg) => logger.warn(msg),
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

        yield* yieldFollowBatches(generator, { traceId });
        return;
      }

      const { result, hint } = await executeTraceSingleFetch(
        org,
        flags.trace,
        flags
      );
      yield commandOutput(result);
      return { hint };
    }

    // Standard project-scoped mode — kept in else-like block to avoid
    // `org` shadowing the trace-mode `org` declaration above.
    {
      const { org, project } = await resolveOrgProjectFromArg(
        target,
        cwd,
        COMMAND_NAME
      );
      setContext([org], [project]);

      if (flags.follow) {
        writeFollowBanner(
          flags.follow ?? DEFAULT_POLL_INTERVAL,
          "Streaming logs...",
          flags.json
        );

        const generator = generateFollowLogs({
          flags,
          onDiagnostic: (msg) => logger.warn(msg),
          fetch: (statsPeriod, afterTimestamp) =>
            listLogs(org, project, {
              query: flags.query,
              limit: flags.limit,
              statsPeriod,
              afterTimestamp,
            }),
          extractNew: (logs) => logs,
        });

        yield* yieldFollowBatches(generator);
        return;
      }

      const { result, hint } = await executeSingleFetch(org, project, flags);
      yield commandOutput(result);
      return { hint };
    }
  },
});
