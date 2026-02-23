/**
 * sentry log list
 *
 * List and stream logs from Sentry projects.
 * Supports real-time streaming with --follow flag.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import type { SentryContext } from "../../context.js";
import { listLogs } from "../../lib/api-client.js";
import { validateLimit } from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { AuthError, stringifyUnknown } from "../../lib/errors.js";
import {
  formatLogRow,
  formatLogsHeader,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import { TARGET_PATTERN_NOTE } from "../../lib/list-command.js";
import { resolveOrgProjectFromArg } from "../../lib/resolve-target.js";
import { getUpdateNotification } from "../../lib/version-check.js";
import type { SentryLog, Writer } from "../../types/index.js";

type ListFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly follow?: number;
  readonly json: boolean;
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
 * Write logs to output in the appropriate format.
 */
function writeLogs(stdout: Writer, logs: SentryLog[], asJson: boolean): void {
  if (asJson) {
    for (const log of logs) {
      writeJson(stdout, log);
    }
  } else {
    for (const log of logs) {
      stdout.write(formatLogRow(log));
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

  stdout.write(formatLogsHeader());
  for (const log of chronological) {
    stdout.write(formatLogRow(log));
  }

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

  // Track if header has been printed (for human mode)
  let headerPrinted = false;

  // Initial fetch: only last minute for follow mode (we want recent logs, not historical)
  const initialLogs = await listLogs(org, project, {
    query: flags.query,
    limit: flags.limit,
    statsPeriod: "1m",
  });

  // Print header before initial logs (human mode only)
  if (!flags.json && initialLogs.length > 0) {
    stdout.write(formatLogsHeader());
    headerPrinted = true;
  }

  // Reverse for chronological order (API returns newest first, tail -f shows oldest first)
  const chronologicalInitial = [...initialLogs].reverse();
  writeLogs(stdout, chronologicalInitial, flags.json);

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
          stdout.write(formatLogsHeader());
          headerPrinted = true;
        }

        // Reverse for chronological order (oldest first for tail -f style)
        const chronologicalNew = [...newLogs].reverse();
        writeLogs(stdout, chronologicalNew, flags.json);

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

export const listCommand = buildCommand({
  docs: {
    brief: "List logs from a project",
    fullDescription:
      "List and stream logs from Sentry projects.\n\n" +
      "Target patterns:\n" +
      "  sentry log list               # auto-detect from DSN or config\n" +
      "  sentry log list <org>/<proj>  # explicit org and project\n" +
      "  sentry log list <project>     # find project across all orgs\n\n" +
      `${TARGET_PATTERN_NOTE}\n\n` +
      "Examples:\n" +
      "  sentry log list                    # List last 100 logs\n" +
      "  sentry log list -f                 # Stream logs (2s poll interval)\n" +
      "  sentry log list -f 5               # Stream logs (5s poll interval)\n" +
      "  sentry log list --limit 50         # Show last 50 logs\n" +
      "  sentry log list -q 'level:error'   # Filter to errors only",
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

    // Resolve org/project from positional arg, config, or DSN auto-detection
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
  },
});
