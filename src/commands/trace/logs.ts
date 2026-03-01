/**
 * sentry trace logs
 *
 * View logs associated with a distributed trace.
 */

import type { SentryContext } from "../../context.js";
import { listTraceLogs } from "../../lib/api-client.js";
import { validateLimit } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import {
  formatTraceLogTable,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { buildTraceUrl } from "../../lib/sentry-urls.js";

type LogsFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly period: string;
  readonly limit: number;
  readonly query?: string;
};

/** Maximum allowed value for --limit flag */
const MAX_LIMIT = 1000;

/** Minimum allowed value for --limit flag */
const MIN_LIMIT = 1;

/** Default number of log entries to show */
const DEFAULT_LIMIT = 100;

/**
 * Default time period for the trace-logs API.
 * The API requires statsPeriod — without it the response may be empty even
 * when logs exist for the trace.
 */
const DEFAULT_PERIOD = "14d";

/** Usage hint shown in error messages */
const USAGE_HINT = "sentry trace logs [<org>] <trace-id>";

/** Regex for a valid 32-character hexadecimal trace ID */
const TRACE_ID_RE = /^[0-9a-f]{32}$/i;

/**
 * Parse --limit flag, delegating range validation to shared utility.
 */
function parseLimit(value: string): number {
  return validateLimit(value, MIN_LIMIT, MAX_LIMIT);
}

/**
 * Validate that a string looks like a 32-character hex trace ID.
 *
 * @throws {ValidationError} If the trace ID format is invalid
 */
function validateTraceId(traceId: string): void {
  if (!TRACE_ID_RE.test(traceId)) {
    throw new ValidationError(
      `Invalid trace ID "${traceId}". Expected a 32-character hexadecimal string.\n\n` +
        "Example: sentry trace logs abc123def456abc123def456abc123de"
    );
  }
}

/**
 * Parse positional arguments for trace logs.
 *
 * Accepted forms:
 * - `<trace-id>`              → auto-detect org
 * - `<org> <trace-id>`        → explicit org (space-separated)
 * - `<org>/<trace-id>`        → explicit org (slash-separated, one arg)
 *
 * @param args - Positional arguments from CLI
 * @returns Parsed trace ID and optional explicit org slug
 * @throws {ContextError} If no arguments are provided
 * @throws {ValidationError} If trace ID format is invalid
 */
export function parsePositionalArgs(args: string[]): {
  traceId: string;
  orgArg: string | undefined;
} {
  if (args.length === 0) {
    throw new ContextError("Trace ID", USAGE_HINT);
  }

  if (args.length === 1) {
    const first = args[0];
    if (first === undefined) {
      throw new ContextError("Trace ID", USAGE_HINT);
    }

    // Check for "org/traceId" slash-separated form
    const slashIdx = first.indexOf("/");
    if (slashIdx !== -1) {
      const orgArg = first.slice(0, slashIdx);
      const traceId = first.slice(slashIdx + 1);

      if (!orgArg) {
        throw new ContextError("Organization", USAGE_HINT);
      }
      if (!traceId) {
        throw new ContextError("Trace ID", USAGE_HINT);
      }

      validateTraceId(traceId);
      return { traceId, orgArg };
    }

    // Plain trace ID — org will be auto-detected
    validateTraceId(first);
    return { traceId: first, orgArg: undefined };
  }

  // Two or more args — first is org, second is trace ID
  const orgArg = args[0];
  const traceId = args[1];

  if (orgArg === undefined || traceId === undefined) {
    throw new ContextError("Trace ID", USAGE_HINT);
  }

  validateTraceId(traceId);
  return { traceId, orgArg };
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
      "  sentry trace logs <org> <trace-id>    # explicit org\n" +
      "  sentry trace logs <org>/<trace-id>    # slash-separated\n\n" +
      "The trace ID is the 32-character hexadecimal identifier.\n\n" +
      "Examples:\n" +
      "  sentry trace logs abc123def456abc123def456abc123de\n" +
      "  sentry trace logs myorg abc123def456abc123def456abc123de\n" +
      "  sentry trace logs --period 7d abc123def456abc123def456abc123de\n" +
      "  sentry trace logs --json abc123def456abc123def456abc123de",
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "args",
        brief: "[<org>] <trace-id> - Optional org and required trace ID",
        parse: String,
      },
    },
    flags: {
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
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
        brief: `Number of log entries (${MIN_LIMIT}-${MAX_LIMIT})`,
        default: String(DEFAULT_LIMIT),
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Additional filter query (Sentry search syntax)",
        optional: true,
      },
    },
    aliases: { w: "web", t: "period", n: "limit", q: "query" },
  },
  async func(
    this: SentryContext,
    flags: LogsFlags,
    ...args: string[]
  ): Promise<void> {
    const { stdout, cwd, setContext } = this;

    const { traceId, orgArg } = parsePositionalArgs(args);

    // Resolve org — trace-logs is org-scoped, no project needed
    const resolved = await resolveOrg({ org: orgArg, cwd });
    if (!resolved) {
      throw new ContextError("Organization", USAGE_HINT, [
        "Set a default org with 'sentry org list', or specify one explicitly",
        `Example: sentry trace logs myorg ${traceId}`,
      ]);
    }

    const { org } = resolved;
    setContext([org], []);

    if (flags.web) {
      await openInBrowser(stdout, buildTraceUrl(org, traceId), "trace");
      return;
    }

    const logs = await listTraceLogs(org, traceId, {
      statsPeriod: flags.period,
      limit: flags.limit,
      query: flags.query,
    });

    if (flags.json) {
      writeJson(stdout, logs);
      return;
    }

    if (logs.length === 0) {
      stdout.write(
        `No logs found for trace ${traceId} in the last ${flags.period}.\n\n` +
          `Try a longer period: sentry trace logs --period 30d ${traceId}\n`
      );
      return;
    }

    // API returns newest-first; reverse for chronological display
    const chronological = [...logs].reverse();

    stdout.write(formatTraceLogTable(chronological));

    const hasMore = logs.length >= flags.limit;
    const countText = `Showing ${logs.length} log${logs.length === 1 ? "" : "s"} for trace ${traceId}.`;
    const tip = hasMore ? " Use --limit to show more." : "";
    writeFooter(stdout, `${countText}${tip}`);
  },
});
