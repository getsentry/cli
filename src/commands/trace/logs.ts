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
import { ContextError } from "../../lib/errors.js";
import { displayTraceLogs } from "../../lib/formatters/index.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { buildTraceUrl } from "../../lib/sentry-urls.js";
import { validateTraceId } from "../../lib/trace-id.js";

type LogsFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly period: string;
  readonly limit: number;
  readonly query?: string;
  readonly fresh: boolean;
  readonly fields?: string[];
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

/**
 * Parse --limit flag, delegating range validation to shared utility.
 */
function parseLimit(value: string): number {
  return validateLimit(value, MIN_LIMIT, MAX_LIMIT);
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

      return { traceId: validateTraceId(traceId), orgArg };
    }

    // Plain trace ID — org will be auto-detected
    return { traceId: validateTraceId(first), orgArg: undefined };
  }

  // Two or more args — first is org, second is trace ID
  const orgArg = args[0];
  const traceId = args[1];

  if (orgArg === undefined || traceId === undefined) {
    throw new ContextError("Trace ID", USAGE_HINT);
  }

  return { traceId: validateTraceId(traceId), orgArg };
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
  output: "json",
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
      fresh: FRESH_FLAG,
    },
    aliases: {
      ...FRESH_ALIASES,
      w: "web",
      t: "period",
      n: "limit",
      q: "query",
    },
  },
  async func(
    this: SentryContext,
    flags: LogsFlags,
    ...args: string[]
  ): Promise<void> {
    applyFreshFlag(flags);
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

    displayTraceLogs({
      stdout,
      logs,
      traceId,
      limit: flags.limit,
      asJson: flags.json,
      fields: flags.fields,
      emptyMessage:
        `No logs found for trace ${traceId} in the last ${flags.period}.\n\n` +
        `Try a longer period: sentry trace logs --period 30d ${traceId}\n`,
    });
  },
});
