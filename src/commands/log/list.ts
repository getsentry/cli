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
  formatLogTable,
  isPlainOutput,
} from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
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

/** Result for non-follow log list operations. */
type LogListResult = {
  logs: LogLike[];
  /** Human-readable hint (e.g., "Showing 100 logs. Use --limit to show more.") */
  hint?: string;
  /** Trace ID, present for trace-filtered queries */
  traceId?: string;
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

/**
 * Execute a single fetch of logs (non-streaming mode).
 *
 * Returns the fetched logs and a human-readable hint. The caller
 * (via the output config) handles rendering to stdout.
 */
type SingleFetchOptions = {
  org: string;
  project: string;
  flags: ListFlags;
};

async function executeSingleFetch(
  options: SingleFetchOptions
): Promise<LogListResult> {
  const { org, project, flags } = options;
  const logs = await listLogs(org, project, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: "90d",
  });

  if (logs.length === 0) {
    return { logs: [], hint: "No logs found." };
  }

  // Reverse for chronological order (API returns newest first, tail shows oldest first)
  const chronological = [...logs].reverse();

  const hasMore = logs.length >= flags.limit;
  const countText = `Showing ${logs.length} log${logs.length === 1 ? "" : "s"}.`;
  const tip = hasMore ? " Use --limit to show more, or -f to follow." : "";

  return { logs: chronological, hint: `${countText}${tip}` };
}

// ---------------------------------------------------------------------------
// Streaming follow-mode infrastructure
// ---------------------------------------------------------------------------

/**
 * A chunk yielded by the follow-mode generator.
 *
 * Two kinds:
 * - `text` — pre-rendered human content (header, table rows, footer).
 *   Written to stdout in human mode, skipped in JSON mode.
 * - `data` — raw log entries for JSONL output. Skipped in human mode
 *   (the text chunk handles rendering).
 */
type LogStreamChunk =
  | { kind: "text"; content: string }
  | { kind: "data"; logs: LogLike[] };

/**
 * Yield `CommandOutput` values from a streaming log chunk.
 *
 * - **Human mode**: yields the chunk as-is (text is rendered, data is skipped
 *   by the human formatter).
 * - **JSON mode**: expands `data` chunks into one yield per log entry (JSONL).
 *   Text chunks yield a suppressed-in-JSON marker so the framework skips them.
 *
 * @param chunk - A streaming chunk from `generateFollowLogs`
 * @param json - Whether JSON output mode is active
 * @param fields - Optional field filter list
 */
function* yieldStreamChunks(
  chunk: LogStreamChunk,
  json: boolean
): Generator<{ data: LogListOutput }, void, undefined> {
  if (json) {
    // In JSON mode, expand data chunks into one yield per log for JSONL
    if (chunk.kind === "data") {
      for (const log of chunk.logs) {
        // Yield a single-log data chunk so jsonTransform emits one line
        yield { data: { kind: "data", logs: [log] } };
      }
    }
    // Text chunks suppressed in JSON mode (jsonTransform returns undefined)
    return;
  }
  // Human mode: yield the chunk directly for the human formatter
  yield { data: chunk };
}

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
 * stderr diagnostics use the `onDiagnostic` callback.
 */
type FollowGeneratorConfig<T extends LogLike> = {
  flags: ListFlags;
  /** Whether to show the trace-ID column in table output */
  includeTrace: boolean;
  /** Report diagnostic/error messages (caller writes to stderr) */
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
 * Yields typed {@link LogStreamChunk} values:
 * - `text` chunks contain pre-rendered human output (header, rows, footer)
 * - `data` chunks contain raw log arrays for JSONL serialization
 *
 * The generator handles SIGINT via AbortController for clean shutdown.
 * It never touches stdout/stderr directly — all output flows through
 * yielded chunks and the `onDiagnostic` callback.
 *
 * @throws {AuthError} if the API returns an authentication error
 */
async function* generateFollowLogs<T extends LogLike>(
  config: FollowGeneratorConfig<T>
): AsyncGenerator<LogStreamChunk, void, undefined> {
  const { flags } = config;
  const pollInterval = flags.follow ?? DEFAULT_POLL_INTERVAL;
  const pollIntervalMs = pollInterval * 1000;

  const plain = flags.json || isPlainOutput();
  const table = plain ? undefined : createLogStreamingTable();

  let headerPrinted = false;
  // timestamp_precise is nanoseconds; Date.now() is milliseconds → convert
  let lastTimestamp = Date.now() * 1_000_000;

  // AbortController for clean SIGINT handling
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);

  /**
   * Yield header + data + rendered-text chunks for a batch of logs.
   * Implemented as a sync sub-generator to use `yield*` from the caller.
   */
  function* yieldBatch(logs: T[]): Generator<LogStreamChunk, void, undefined> {
    if (logs.length === 0) {
      return;
    }

    // Header on first non-empty batch (human mode only)
    if (!(flags.json || headerPrinted)) {
      yield {
        kind: "text",
        content: table ? table.header() : formatLogsHeader(),
      };
      headerPrinted = true;
    }

    const chronological = [...logs].reverse();

    // Data chunk for JSONL
    yield { kind: "data", logs: chronological };

    // Rendered text chunk for human mode
    if (!flags.json) {
      yield {
        kind: "text",
        content: renderLogRows(chronological, config.includeTrace, table),
      };
    }
  }

  try {
    // Initial fetch
    const initialLogs = await config.fetch("1m");
    yield* yieldBatch(initialLogs);
    lastTimestamp = maxTimestamp(initialLogs) ?? lastTimestamp;
    config.onInitialLogs?.(initialLogs);

    // Poll loop — exits when SIGINT fires
    while (!controller.signal.aborted) {
      await abortableSleep(pollIntervalMs, controller.signal);
      if (controller.signal.aborted) {
        break;
      }

      const newLogs = await fetchPoll(config, lastTimestamp);
      if (newLogs) {
        yield* yieldBatch(newLogs);
        lastTimestamp = maxTimestamp(newLogs) ?? lastTimestamp;
      }
    }

    // Table footer — yielded after clean shutdown so the consumer can
    // render it. Placed inside `try` (not `finally`) because a yield in
    // `finally` is discarded when the consumer terminates via error.
    if (table && headerPrinted) {
      yield { kind: "text", content: table.footer() };
    }
  } finally {
    process.removeListener("SIGINT", stop);
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
type TraceSingleFetchOptions = {
  org: string;
  traceId: string;
  flags: ListFlags;
};

async function executeTraceSingleFetch(
  options: TraceSingleFetchOptions
): Promise<LogListResult> {
  const { org, traceId, flags } = options;
  const logs = await listTraceLogs(org, traceId, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: DEFAULT_TRACE_PERIOD,
  });

  if (logs.length === 0) {
    return {
      logs: [],
      traceId,
      hint:
        `No logs found for trace ${traceId} in the last ${DEFAULT_TRACE_PERIOD}.\n\n` +
        "Try 'sentry trace logs' for more options (e.g., --period 30d).",
    };
  }

  const chronological = [...logs].reverse();

  const hasMore = logs.length >= flags.limit;
  const countText = `Showing ${logs.length} log${logs.length === 1 ? "" : "s"} for trace ${traceId}.`;
  const tip = hasMore ? " Use --limit to show more." : "";

  return { logs: chronological, traceId, hint: `${countText}${tip}` };
}

/**
 * Write the follow-mode banner to stderr. Suppressed in JSON mode.
 * Includes poll interval, Ctrl+C hint, and update notification.
 */
function writeFollowBanner(
  stderr: Writer,
  flags: ListFlags,
  bannerText: string
): void {
  if (flags.json) {
    return;
  }
  const pollInterval = flags.follow ?? DEFAULT_POLL_INTERVAL;
  stderr.write(`${bannerText} (poll interval: ${pollInterval}s)\n`);
  stderr.write("Press Ctrl+C to stop.\n");
  const notification = getUpdateNotification();
  if (notification) {
    stderr.write(notification);
  }
  stderr.write("\n");
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/** Data yielded by the log list command — either a batch result or a stream chunk. */
type LogListOutput = LogListResult | LogStreamChunk;

/**
 * Format log output as human-readable terminal text.
 *
 * Handles both batch results ({@link LogListResult}) and streaming
 * chunks ({@link LogStreamChunk}). The returned string omits a trailing
 * newline — the output framework appends one automatically.
 */
function formatLogOutput(result: LogListOutput): string {
  if ("kind" in result) {
    // Streaming chunk — text is pre-rendered, data is skipped (handled by JSON)
    return result.kind === "text" ? result.content.trimEnd() : "";
  }
  // Batch result
  if (result.logs.length === 0) {
    return result.hint ?? "No logs found.";
  }
  const includeTrace = !result.traceId;
  return formatLogTable(result.logs, includeTrace).trimEnd();
}

/**
 * Transform log output into the JSON shape.
 *
 * - Batch: returns the logs array (no envelope).
 * - Streaming text: returns `undefined` (suppressed in JSON mode).
 * - Streaming data: returns individual log objects for JSONL expansion.
 */
function jsonTransformLogOutput(
  result: LogListOutput,
  fields?: string[]
): unknown {
  if ("kind" in result) {
    // Streaming: text chunks are suppressed, data chunks return bare log
    // objects for JSONL (one JSON object per line, not wrapped in an array).
    // yieldStreamChunks already fans out to one log per chunk.
    if (result.kind === "text") {
      return;
    }
    const log = result.logs[0];
    if (log === undefined) {
      return;
    }
    if (fields && fields.length > 0) {
      return filterFields(log, fields);
    }
    return log;
  }
  // Batch result
  if (fields && fields.length > 0) {
    return result.logs.map((log) => filterFields(log, fields));
  }
  return result.logs;
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
    human: formatLogOutput,
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
        const { stderr } = this;
        const traceId = flags.trace;

        // Banner (stderr, suppressed in JSON mode)
        writeFollowBanner(
          stderr,
          flags,
          `Streaming logs for trace ${traceId}...`
        );

        // Track IDs of logs seen without timestamp_precise so they are
        // shown once but not duplicated on subsequent polls.
        const seenWithoutTs = new Set<string>();
        const generator = generateFollowLogs({
          flags,
          includeTrace: false,
          onDiagnostic: (msg) => stderr.write(msg),
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

        for await (const chunk of generator) {
          yield* yieldStreamChunks(chunk, flags.json);
        }
        return;
      }

      const result = await executeTraceSingleFetch({
        org,
        traceId: flags.trace,
        flags,
      });
      // Only forward hint to the footer when items exist — empty results
      // already render hint text inside the human formatter.
      const hint = result.logs.length > 0 ? result.hint : undefined;
      yield { data: result, hint };
      return;
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
        const { stderr } = this;

        writeFollowBanner(stderr, flags, "Streaming logs...");

        const generator = generateFollowLogs({
          flags,
          includeTrace: true,
          onDiagnostic: (msg) => stderr.write(msg),
          fetch: (statsPeriod, afterTimestamp) =>
            listLogs(org, project, {
              query: flags.query,
              limit: flags.limit,
              statsPeriod,
              afterTimestamp,
            }),
          extractNew: (logs) => logs,
        });

        for await (const chunk of generator) {
          yield* yieldStreamChunks(chunk, flags.json);
        }
        return;
      }

      const result = await executeSingleFetch({
        org,
        project,
        flags,
      });
      // Only forward hint to the footer when items exist — empty results
      // already render hint text inside the human formatter.
      const hint = result.logs.length > 0 ? result.hint : undefined;
      yield { data: result, hint };
    }
  },
});
