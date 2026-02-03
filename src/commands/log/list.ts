/**
 * sentry log list
 *
 * List and stream logs from Sentry projects.
 * Supports real-time streaming with --follow flag.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { findProjectsBySlug, listLogs } from "../../lib/api-client.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatLogRow,
  formatLogsHeader,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  parseOrgProjectArg,
  resolveOrgAndProject,
} from "../../lib/resolve-target.js";
import type { SentryLog, Writer } from "../../types/index.js";

type ListFlags = {
  readonly tail: number;
  readonly query?: string;
  readonly follow: boolean;
  readonly pollInterval: number;
  readonly json: boolean;
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry log list <org>/<project>";

/** Maximum allowed value for --tail flag */
const MAX_ROWS = 1000;

/** Minimum allowed value for --tail flag */
const MIN_ROWS = 1;

/** Default number of log entries to show */
const DEFAULT_TAIL = 100;

/** Default poll interval in seconds for --follow mode */
const DEFAULT_POLL_INTERVAL = 2;

/**
 * Validate that --tail value is within allowed range.
 *
 * @throws Error if value is outside MIN_ROWS..MAX_ROWS range
 */
function validateTail(value: string): number {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num < MIN_ROWS || num > MAX_ROWS) {
    throw new Error(`--tail must be between ${MIN_ROWS} and ${MAX_ROWS}`);
  }
  return num;
}

/**
 * Validate that --poll-interval is a positive number.
 *
 * @throws Error if value is not a positive number
 */
function validatePollInterval(value: string): number {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num < 1) {
    throw new Error("--poll-interval must be a positive integer");
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
    limit: flags.tail,
    statsPeriod: "90d",
  });

  if (flags.json) {
    writeJson(stdout, logs);
    return;
  }

  if (logs.length === 0) {
    stdout.write("No logs found.\n");
    return;
  }

  stdout.write(formatLogsHeader());
  for (const log of logs) {
    stdout.write(formatLogRow(log));
  }

  // Show footer with tip if we hit the limit
  const hasMore = logs.length >= flags.tail;
  const countText = `Showing ${logs.length} log${logs.length === 1 ? "" : "s"}.`;
  const tip = hasMore ? " Use --tail to show more, or -f to follow." : "";
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
async function executeFollowMode(options: FollowModeOptions): Promise<void> {
  const { stdout, stderr, org, project, flags } = options;
  const pollIntervalMs = flags.pollInterval * 1000;

  if (!flags.json) {
    stderr.write(`Streaming logs... (poll interval: ${flags.pollInterval}s)\n`);
    stderr.write("Press Ctrl+C to stop.\n\n");
  }

  // Initial fetch to get starting point and show recent logs
  const initialLogs = await listLogs(org, project, {
    query: flags.query,
    limit: flags.tail,
    statsPeriod: "90d",
  });

  writeLogs(stdout, initialLogs, flags.json);

  // Track newest timestamp (logs are sorted -timestamp, so first is newest)
  let lastTimestamp = initialLogs[0]?.timestamp_precise ?? 0;

  // Poll for new logs indefinitely
  while (true) {
    await Bun.sleep(pollIntervalMs);

    try {
      const newLogs = await listLogs(org, project, {
        query: flags.query,
        limit: flags.tail,
        statsPeriod: "10m",
        afterTimestamp: lastTimestamp,
      });

      const newestLog = newLogs[0];
      if (newestLog) {
        lastTimestamp = newestLog.timestamp_precise;
        writeLogs(stdout, newLogs, flags.json);
      }
    } catch (error) {
      if (!flags.json) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`Error fetching logs: ${message}\n`);
      }
      // Continue polling even on errors
    }
  }
}

/** Resolved org and project for log commands */
type ResolvedLogTarget = {
  org: string;
  project: string;
};

/**
 * Resolve org/project from parsed argument or auto-detection.
 *
 * Handles:
 * - explicit: "org/project" → use directly
 * - project-search: "project" → find project across all orgs
 * - auto-detect: no input → use DSN detection or config defaults
 *
 * @throws {ContextError} When target cannot be resolved
 */
async function resolveLogTarget(
  target: string | undefined,
  cwd: string
): Promise<ResolvedLogTarget> {
  const parsed = parseOrgProjectArg(target);

  switch (parsed.type) {
    case "explicit":
      return { org: parsed.org, project: parsed.project };

    case "org-all":
      throw new ContextError(
        "Project",
        `Please specify a project: sentry log list ${parsed.org}/<project>`
      );

    case "project-search": {
      // Find project across all orgs
      const matches = await findProjectsBySlug(parsed.projectSlug);

      if (matches.length === 0) {
        throw new ContextError(
          "Project",
          `No project '${parsed.projectSlug}' found in any accessible organization.\n\n` +
            `Try: sentry log list <org>/${parsed.projectSlug}`
        );
      }

      if (matches.length > 1) {
        const options = matches
          .map((m) => `  sentry log list ${m.orgSlug}/${m.slug}`)
          .join("\n");
        throw new ContextError(
          "Project",
          `Found '${parsed.projectSlug}' in ${matches.length} organizations. Please specify:\n${options}`
        );
      }

      // Safe: we checked matches.length === 1 above, so first element exists
      const match = matches[0] as (typeof matches)[number];
      return { org: match.orgSlug, project: match.slug };
    }

    case "auto-detect": {
      const resolved = await resolveOrgAndProject({
        cwd,
        usageHint: USAGE_HINT,
      });
      if (!resolved) {
        throw new ContextError("Organization and project", USAGE_HINT);
      }
      return { org: resolved.org, project: resolved.project };
    }

    default: {
      const _exhaustiveCheck: never = parsed;
      throw new Error(`Unexpected parsed type: ${_exhaustiveCheck}`);
    }
  }
}

export const listCommand = buildCommand({
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
      "  sentry log list -f                 # Stream logs in real-time\n" +
      "  sentry log list --tail 50          # Show last 50 logs\n" +
      "  sentry log list -q 'level:error'   # Filter to errors only\n" +
      "  sentry log list -f --tail 200      # Show last 200, then stream",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "target",
          brief: "Target: <org>/<project> or <project>",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      tail: {
        kind: "parsed",
        parse: validateTail,
        brief: `Number of log entries (${MIN_ROWS}-${MAX_ROWS})`,
        default: String(DEFAULT_TAIL),
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Filter query (Sentry search syntax)",
        optional: true,
      },
      follow: {
        kind: "boolean",
        brief: "Stream logs in real-time",
        default: false,
      },
      pollInterval: {
        kind: "parsed",
        parse: validatePollInterval,
        brief: "Poll interval in seconds (only with --follow)",
        default: String(DEFAULT_POLL_INTERVAL),
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
    aliases: {
      n: "tail",
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
    const { org, project } = await resolveLogTarget(target, cwd);
    setContext([org], [project]);

    if (flags.follow) {
      await executeFollowMode({ stdout, stderr, org, project, flags });
    } else {
      await executeSingleFetch(stdout, org, project, flags);
    }
  },
});
