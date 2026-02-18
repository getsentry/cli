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
import { AuthError, stringifyUnknown } from "../../lib/errors.js";
import {
  formatLogRow,
  formatLogsHeader,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  listCommand as buildListCommand,
  resolveSingleTarget,
} from "../../lib/list-helpers.js";
import { getUpdateNotification } from "../../lib/version-check.js";
import type { SentryLog, Writer } from "../../types/index.js";

/** Maximum allowed value for --limit flag */
const MAX_LIMIT = 1000;

/** Minimum allowed value for --limit flag */
const MIN_LIMIT = 1;

/** Default number of log entries to show */
const DEFAULT_LIMIT = 100;

/** Default poll interval in seconds for --follow mode */
const DEFAULT_POLL_INTERVAL = 2;

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

type FollowModeOptions = {
  stdout: Writer;
  stderr: Writer;
  org: string;
  project: string;
  query: string | undefined;
  limit: number;
  json: boolean;
  pollInterval: number;
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
  const { stdout, stderr, org, project, query, limit, json, pollInterval } =
    options;
  const pollIntervalMs = pollInterval * 1000;

  if (!json) {
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
    query,
    limit,
    statsPeriod: "1m",
  });

  // Print header before initial logs (human mode only)
  if (!json && initialLogs.length > 0) {
    stdout.write(formatLogsHeader());
    headerPrinted = true;
  }

  // Reverse for chronological order (API returns newest first, tail -f shows oldest first)
  const chronologicalInitial = [...initialLogs].reverse();
  writeLogs(stdout, chronologicalInitial, json);

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
        query,
        limit,
        statsPeriod: "10m",
        afterTimestamp: lastTimestamp,
      });

      const newestLog = newLogs[0];
      if (newestLog) {
        // Print header before first logs if not already printed
        if (!(json || headerPrinted)) {
          stdout.write(formatLogsHeader());
          headerPrinted = true;
        }

        // Reverse for chronological order (oldest first for tail -f style)
        const chronologicalNew = [...newLogs].reverse();
        writeLogs(stdout, chronologicalNew, json);

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

export const listCommand = buildListCommand<SentryLog>({
  docs: {
    brief: "List logs from a project",
    fullDescription:
      "List and stream logs from Sentry projects.\n\n" +
      "Target specification:\n" +
      "  sentry log list               # auto-detect from DSN or config\n" +
      "  sentry log list <org>/<proj>  # explicit org and project\n" +
      "  sentry log list <project>     # find project across all orgs\n\n" +
      "Examples:\n" +
      "  sentry log list                    # List last 100 logs\n" +
      "  sentry log list -f                 # Stream logs (2s poll interval)\n" +
      "  sentry log list -f 5               # Stream logs (5s poll interval)\n" +
      "  sentry log list --limit 50         # Show last 50 logs\n" +
      "  sentry log list -q 'level:error'   # Filter to errors only",
  },
  limit: { min: MIN_LIMIT, max: MAX_LIMIT, default: DEFAULT_LIMIT },
  features: { query: true, follow: true },
  positional: {
    placeholder: "target",
    brief: "Target: <org>/<project> or <project>",
    optional: true,
  },
  emptyMessage: "No logs found.",
  footerTip: (result, flags) => {
    const count = result.items.length;
    const hasMore = count >= (flags.limit as number);
    const tip = hasMore ? " Use --limit to show more, or -f to follow." : "";
    return `Showing ${count} log${count === 1 ? "" : "s"}.${tip}`;
  },
  async fetch(this: SentryContext, flags, target) {
    const { org, project } = await resolveSingleTarget(
      target,
      this.cwd,
      "sentry log list"
    );
    this.setContext([org], [project]);

    // In --follow mode skip the historical fetch; the follow() callback owns the output.
    if (flags.follow !== undefined) {
      return { items: [] };
    }

    const logs = await listLogs(org, project, {
      query: flags.query,
      limit: flags.limit,
      statsPeriod: "90d",
    });

    // Reverse for chronological order (API returns newest first)
    const items = [...logs].reverse();
    return { items };
  },
  render(items, stdout) {
    stdout.write(formatLogsHeader());
    for (const log of items) {
      stdout.write(formatLogRow(log));
    }
  },
  // Override JSON output: reverse back to chronological
  formatJson(result, stdout) {
    writeJson(stdout, result.items);
  },
  async follow(this: SentryContext, flags, target, _initialResult) {
    const { org, project } = await resolveSingleTarget(
      target,
      this.cwd,
      "sentry log list"
    );
    await executeFollowMode({
      stdout: this.stdout,
      stderr: this.stderr,
      org,
      project,
      query: flags.query,
      limit: flags.limit,
      json: flags.json,
      pollInterval: (flags.follow as number) ?? DEFAULT_POLL_INTERVAL,
    });
  },
});
