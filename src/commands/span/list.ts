/**
 * sentry span list
 *
 * List spans in a distributed trace with optional filtering and sorting.
 */

import type { SentryContext } from "../../context.js";
import { listSpans } from "../../lib/api-client.js";
import {
  parseOrgProjectArg,
  parseSlashSeparatedArg,
  validateLimit,
} from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import {
  spanListItemToFlatSpan,
  translateSpanQuery,
  writeFooter,
  writeJsonList,
  writeSpanTable,
} from "../../lib/formatters/index.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import {
  resolveOrgAndProject,
  resolveProjectBySlug,
} from "../../lib/resolve-target.js";
import { validateTraceId } from "../../lib/trace-id.js";

type ListFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly sort: "time" | "duration";
  readonly json: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

type SortValue = "time" | "duration";

/** Accepted values for the --sort flag */
const VALID_SORT_VALUES: SortValue[] = ["time", "duration"];

/** Maximum allowed value for --limit flag */
const MAX_LIMIT = 1000;

/** Minimum allowed value for --limit flag */
const MIN_LIMIT = 1;

/** Default number of spans to show */
const DEFAULT_LIMIT = 25;

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry span list [<org>/<project>] <trace-id>";

/**
 * Parse positional arguments for span list.
 * Handles: `<trace-id>` or `<target> <trace-id>`
 *
 * @param args - Positional arguments from CLI
 * @returns Parsed trace ID and optional target arg
 * @throws {ContextError} If no arguments provided
 * @throws {ValidationError} If the trace ID format is invalid
 */
export function parsePositionalArgs(args: string[]): {
  traceId: string;
  targetArg: string | undefined;
} {
  if (args.length === 0) {
    throw new ContextError("Trace ID", USAGE_HINT);
  }

  const first = args[0];
  if (first === undefined) {
    throw new ContextError("Trace ID", USAGE_HINT);
  }

  if (args.length === 1) {
    const { id, targetArg } = parseSlashSeparatedArg(
      first,
      "Trace ID",
      USAGE_HINT
    );
    return { traceId: validateTraceId(id), targetArg };
  }

  const second = args[1];
  if (second === undefined) {
    return { traceId: validateTraceId(first), targetArg: undefined };
  }

  // Two or more args — first is target, second is trace ID
  return { traceId: validateTraceId(second), targetArg: first };
}

/**
 * Parse --limit flag, delegating range validation to shared utility.
 */
function parseLimit(value: string): number {
  return validateLimit(value, MIN_LIMIT, MAX_LIMIT);
}

/**
 * Parse and validate sort flag value.
 *
 * @throws Error if value is not "time" or "duration"
 */
export function parseSort(value: string): SortValue {
  if (!VALID_SORT_VALUES.includes(value as SortValue)) {
    throw new Error(
      `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
    );
  }
  return value as SortValue;
}

export const listCommand = buildCommand({
  docs: {
    brief: "List spans in a trace",
    fullDescription:
      "List spans in a distributed trace with optional filtering and sorting.\n\n" +
      "Target specification:\n" +
      "  sentry span list <trace-id>              # auto-detect from DSN or config\n" +
      "  sentry span list <org>/<proj> <trace-id> # explicit org and project\n" +
      "  sentry span list <project> <trace-id>    # find project across all orgs\n\n" +
      "The trace ID is the 32-character hexadecimal identifier.\n\n" +
      "Examples:\n" +
      "  sentry span list <trace-id>                      # List spans in trace\n" +
      "  sentry span list <trace-id> --limit 50           # Show more spans\n" +
      '  sentry span list <trace-id> -q "op:db"           # Filter by operation\n' +
      "  sentry span list <trace-id> --sort duration      # Sort by slowest first\n" +
      '  sentry span list <trace-id> -q "duration:>100ms" # Spans slower than 100ms',
  },
  output: "json",
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "args",
        brief:
          "[<org>/<project>] <trace-id> - Target (optional) and trace ID (required)",
        parse: String,
      },
    },
    flags: {
      limit: {
        kind: "parsed",
        parse: parseLimit,
        brief: `Number of spans (${MIN_LIMIT}-${MAX_LIMIT})`,
        default: String(DEFAULT_LIMIT),
      },
      query: {
        kind: "parsed",
        parse: String,
        brief:
          'Filter spans (e.g., "op:db", "duration:>100ms", "project:backend")',
        optional: true,
      },
      sort: {
        kind: "parsed",
        parse: parseSort,
        brief: "Sort by: time (default), duration",
        default: "time" as const,
      },
      fresh: FRESH_FLAG,
    },
    aliases: {
      ...FRESH_ALIASES,
      n: "limit",
      q: "query",
      s: "sort",
    },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    ...args: string[]
  ): Promise<void> {
    applyFreshFlag(flags);
    const { stdout, cwd, setContext } = this;
    const log = logger.withTag("span.list");

    // Parse positional args
    const { traceId, targetArg } = parsePositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);
    if (parsed.type !== "auto-detect" && parsed.normalized) {
      log.warn("Normalized slug (Sentry slugs use dashes, not underscores)");
    }

    // Resolve target
    let target: { org: string; project: string } | null = null;

    switch (parsed.type) {
      case "explicit":
        target = { org: parsed.org, project: parsed.project };
        break;

      case "project-search":
        target = await resolveProjectBySlug(
          parsed.projectSlug,
          USAGE_HINT,
          `sentry span list <org>/${parsed.projectSlug} ${traceId}`
        );
        break;

      case "org-all":
        throw new ContextError("Specific project", USAGE_HINT);

      case "auto-detect":
        target = await resolveOrgAndProject({ cwd, usageHint: USAGE_HINT });
        break;

      default: {
        const _exhaustiveCheck: never = parsed;
        throw new ValidationError(
          `Invalid target specification: ${_exhaustiveCheck}`
        );
      }
    }

    if (!target) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    setContext([target.org], [target.project]);

    // Build server-side query
    const queryParts = [`trace:${traceId}`];
    if (flags.query) {
      queryParts.push(translateSpanQuery(flags.query));
    }
    const apiQuery = queryParts.join(" ");

    // Fetch spans from EAP endpoint
    const { data: spanItems, nextCursor } = await listSpans(
      target.org,
      target.project,
      {
        query: apiQuery,
        sort: flags.sort,
        limit: flags.limit,
      }
    );

    const flatSpans = spanItems.map(spanListItemToFlatSpan);
    const hasMore = nextCursor !== undefined;

    if (flags.json) {
      writeJsonList(stdout, flatSpans, {
        hasMore,
        fields: flags.fields,
      });
      return;
    }

    if (flatSpans.length === 0) {
      stdout.write("No spans matched the query.\n");
      return;
    }

    stdout.write(`Spans in trace ${traceId}:\n\n`);
    writeSpanTable(stdout, flatSpans);

    // Footer
    const countText = `Showing ${flatSpans.length} span${flatSpans.length === 1 ? "" : "s"}.`;

    if (hasMore) {
      writeFooter(stdout, `${countText} Use --limit to see more.`);
    } else {
      writeFooter(
        stdout,
        `${countText} Use 'sentry span view <span-id> --trace ${traceId}' to view span details.`
      );
    }
  },
});
