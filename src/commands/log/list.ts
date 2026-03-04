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
import {
  AuthError,
  ContextError,
  stringifyUnknown,
  ValidationError,
} from "../../lib/errors.js";
import {
  buildLogRowCells,
  createLogStreamingTable,
  formatLogRow,
  formatLogsHeader,
  formatLogTable,
  isPlainOutput,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import { renderInlineMarkdown } from "../../lib/formatters/markdown.js";
import {
  buildListCommand,
  TARGET_PATTERN_NOTE,
} from "../../lib/list-command.js";
import {
  resolveOrg,
  resolveOrgProjectFromArg,
} from "../../lib/resolve-target.js";
import { getUpdateNotification } from "../../lib/version-check.js";
import type { Writer } from "../../types/index.js";

type ListFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly follow?: number;
  readonly json: boolean;
  readonly trace?: string;
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

/** Regex for a valid 32-character hexadecimal trace ID */
const TRACE_ID_RE = /^[0-9a-f]{32}$/i;

/**
 * Validate that a string looks like a 32-character hex trace ID.
 *
 * @throws {ValidationError} If the trace ID format is invalid
 */
function validateTraceId(traceId: string): string {
  if (!TRACE_ID_RE.test(traceId)) {
    throw new ValidationError(
      `Invalid trace ID "${traceId}". Expected a 32-character hexadecimal string.\n\n` +
        "Example: sentry log list --trace abc123def456abc123def456abc123de"
    );
  }
  return traceId;
}

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
 * needed for table rendering.
 */
type LogLike = {
  timestamp: string;
  severity?: string | null;
  message?: string | null;
  trace?: string | null;
};

type WriteLogsOptions = {
  stdout: Writer;
  logs: LogLike[];
  asJson: boolean;
  table?: import("../../lib/formatters/text-table.js").StreamingTable;
  /** Whether to append a short trace-ID suffix (default: true) */
  includeTrace?: boolean;
};

/**
 * Write logs to output in the appropriate format.
 *
 * When a StreamingTable is provided (TTY mode), renders rows through the
 * bordered table. Otherwise falls back to plain markdown rows.
 */
function writeLogs(options: WriteLogsOptions): void {
  const { stdout, logs, asJson, table, includeTrace = true } = options;
  if (asJson) {
    for (const log of logs) {
      writeJson(stdout, log);
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
async function executeSingleFetch(
  stdout: Writer,
  org: string,
  project: string,
  flags: ListFlags
): Promise<void> {
  const logs = await listLogs(org, project, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: "90d",
  });

  if (flags.json) {
    // Reverse for chronological order (API returns newest first)
    writeJson(stdout, [...logs].reverse());
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

type FollowModeOptions = {
  stdout: Writer;
  stderr: Writer;
  org: string;
  project: string;
  flags: ListFlags;
};

/**
 * Execute streaming mode (--follow flag).
 *
 * Uses timestamp-based filtering to efficiently fetch only new logs.
 * Each poll requests logs with timestamp_precise > last seen timestamp,
 * ensuring no duplicates and no missed logs.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming loop with error handling
async function executeFollowMode(options: FollowModeOptions): Promise<void> {
  const { stdout, stderr, org, project, flags } = options;
  const pollInterval = flags.follow ?? DEFAULT_POLL_INTERVAL;
  const pollIntervalMs = pollInterval * 1000;

  if (!flags.json) {
    stderr.write(`Streaming logs... (poll interval: ${pollInterval}s)\n`);
    stderr.write("Press Ctrl+C to stop.\n");

    // Show update notification before streaming (since we'll never reach the normal exit)
    const notification = getUpdateNotification();
    if (notification) {
      stderr.write(notification);
    }
    stderr.write("\n");
  }

  // In TTY mode, use a bordered StreamingTable for aligned columns.
  // In plain mode, use raw markdown rows for pipe-friendly output.
  const plain = flags.json || isPlainOutput();
  const table = plain ? undefined : createLogStreamingTable();

  // Track if header has been printed (for human/plain mode)
  let headerPrinted = false;

  // Initial fetch: only last minute for follow mode (we want recent logs, not historical)
  const initialLogs = await listLogs(org, project, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: "1m",
  });

  // Print header before initial logs (human mode only)
  if (!flags.json && initialLogs.length > 0) {
    stdout.write(table ? table.header() : formatLogsHeader());
    headerPrinted = true;
  }

  // Reverse for chronological order (API returns newest first, tail -f shows oldest first)
  const chronologicalInitial = [...initialLogs].reverse();
  writeLogs({ stdout, logs: chronologicalInitial, asJson: flags.json, table });

  // Print bottom border on Ctrl+C so the table closes cleanly
  if (table) {
    process.once("SIGINT", () => {
      stdout.write(table.footer());
      process.exit(0);
    });
  }

  // Track newest timestamp (logs are sorted -timestamp, so first is newest)
  // Use current time as fallback to avoid fetching old logs when initial fetch is empty
  // (timestamp_precise is in nanoseconds, Date.now() is milliseconds)
  let lastTimestamp =
    initialLogs[0]?.timestamp_precise ?? Date.now() * 1_000_000;

  // Poll for new logs indefinitely
  while (true) {
    await Bun.sleep(pollIntervalMs);

    try {
      const newLogs = await listLogs(org, project, {
        query: flags.query,
        limit: flags.limit,
        statsPeriod: "10m",
        afterTimestamp: lastTimestamp,
      });

      const newestLog = newLogs[0];
      if (newestLog) {
        // Print header before first logs if not already printed
        if (!(flags.json || headerPrinted)) {
          stdout.write(table ? table.header() : formatLogsHeader());
          headerPrinted = true;
        }

        // Reverse for chronological order (oldest first for tail -f style)
        const chronologicalNew = [...newLogs].reverse();
        writeLogs({
          stdout,
          logs: chronologicalNew,
          asJson: flags.json,
          table,
        });

        // Update timestamp AFTER successful write to avoid losing logs on write failure
        lastTimestamp = newestLog.timestamp_precise;
      }
    } catch (error) {
      // Auth errors should propagate - user needs to re-authenticate
      if (error instanceof AuthError) {
        throw error;
      }

      // Report transient errors to Sentry for visibility
      Sentry.captureException(error);

      // Always write to stderr (doesn't interfere with JSON on stdout)
      const message = stringifyUnknown(error);
      stderr.write(`Error fetching logs: ${message}\n`);
      // Continue polling on transient errors (network, etc.)
    }
  }
}

/** Default time period for trace-logs queries */
const DEFAULT_TRACE_PERIOD = "14d";

/**
 * Execute a single fetch of trace-filtered logs (non-streaming, --trace mode).
 * Uses the dedicated trace-logs endpoint which is org-scoped.
 */
async function executeTraceSingleFetch(
  stdout: Writer,
  org: string,
  traceId: string,
  flags: ListFlags
): Promise<void> {
  const logs = await listTraceLogs(org, traceId, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: DEFAULT_TRACE_PERIOD,
  });

  if (flags.json) {
    writeJson(stdout, [...logs].reverse());
    return;
  }

  if (logs.length === 0) {
    stdout.write(
      `No logs found for trace ${traceId} in the last ${DEFAULT_TRACE_PERIOD}.\n\n` +
        "Try 'sentry trace logs' for more options (e.g., --period 30d).\n"
    );
    return;
  }

  const chronological = [...logs].reverse();
  stdout.write(formatLogTable(chronological, false));

  const hasMore = logs.length >= flags.limit;
  const countText = `Showing ${logs.length} log${logs.length === 1 ? "" : "s"} for trace ${traceId}.`;
  const tip = hasMore ? " Use --limit to show more." : "";
  writeFooter(stdout, `${countText}${tip}`);
}

type TraceFollowModeOptions = {
  stdout: Writer;
  stderr: Writer;
  org: string;
  traceId: string;
  flags: ListFlags;
};

/**
 * Execute streaming mode for trace-filtered logs (--follow + --trace).
 * Uses the trace-logs endpoint and polls for new entries.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming loop with error handling
async function executeTraceFollowMode(
  options: TraceFollowModeOptions
): Promise<void> {
  const { stdout, stderr, org, traceId, flags } = options;
  const pollInterval = flags.follow ?? DEFAULT_POLL_INTERVAL;
  const pollIntervalMs = pollInterval * 1000;

  if (!flags.json) {
    stderr.write(
      `Streaming logs for trace ${traceId}... (poll interval: ${pollInterval}s)\n`
    );
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

  // Initial fetch
  const initialLogs = await listTraceLogs(org, traceId, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: "1m",
  });

  if (!flags.json && initialLogs.length > 0) {
    stdout.write(table ? table.header() : formatLogsHeader());
    headerPrinted = true;
  }

  const chronologicalInitial = [...initialLogs].reverse();
  writeLogs({
    stdout,
    logs: chronologicalInitial,
    asJson: flags.json,
    table,
    includeTrace: false,
  });

  if (table) {
    process.once("SIGINT", () => {
      stdout.write(table.footer());
      process.exit(0);
    });
  }

  let lastTimestamp =
    initialLogs[0]?.timestamp_precise ?? Date.now() * 1_000_000;

  while (true) {
    await Bun.sleep(pollIntervalMs);

    try {
      // The trace-logs endpoint doesn't support afterTimestamp, so we
      // fetch recent logs and deduplicate by checking timestamp_precise.
      const newLogs = await listTraceLogs(org, traceId, {
        query: flags.query,
        limit: flags.limit,
        statsPeriod: "10m",
      });

      // Filter to only logs newer than lastTimestamp
      const freshLogs = newLogs.filter(
        (log) => log.timestamp_precise > lastTimestamp
      );

      // newest-first from API, so first element is the newest
      const newestFresh = freshLogs[0];
      if (newestFresh) {
        if (!(flags.json || headerPrinted)) {
          stdout.write(table ? table.header() : formatLogsHeader());
          headerPrinted = true;
        }

        const chronologicalNew = [...freshLogs].reverse();
        writeLogs({
          stdout,
          logs: chronologicalNew,
          asJson: flags.json,
          table,
          includeTrace: false,
        });

        lastTimestamp = newestFresh.timestamp_precise;
      }
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }

      Sentry.captureException(error);

      const message = stringifyUnknown(error);
      stderr.write(`Error fetching logs: ${message}\n`);
    }
  }
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
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
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
        await executeTraceFollowMode({
          stdout,
          stderr,
          org,
          traceId: flags.trace,
          flags,
        });
      } else {
        await executeTraceSingleFetch(stdout, org, flags.trace, flags);
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
        await executeFollowMode({ stdout, stderr, org, project, flags });
      } else {
        await executeSingleFetch(stdout, org, project, flags);
      }
    }
  },
});
