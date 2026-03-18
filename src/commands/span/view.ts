/**
 * sentry span view
 *
 * View detailed information about one or more spans within a trace.
 */

import type { SentryContext } from "../../context.js";
import { getDetailedTrace } from "../../lib/api-client.js";
import { spansFlag } from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import {
  type FoundSpan,
  findSpanById,
  formatSimpleSpanTree,
  formatSpanDetails,
} from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { computeSpanDurationMs } from "../../lib/formatters/time-utils.js";
import { validateSpanId } from "../../lib/hex-id.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import {
  parseSlashSeparatedTraceTarget,
  resolveTraceOrgProject,
  warnIfNormalized,
} from "../../lib/trace-target.js";

const log = logger.withTag("span.view");

type ViewFlags = {
  readonly json: boolean;
  readonly spans: number;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Usage hint for ContextError messages */
const USAGE_HINT =
  "sentry span view [<org>/<project>/]<trace-id> <span-id> [<span-id>...]";

/**
 * Parse positional arguments for span view.
 *
 * The first positional is the trace ID (optionally with org/project prefix),
 * parsed via the shared `parseSlashSeparatedTraceTarget`. The remaining
 * positionals are span IDs.
 *
 * @param args - Positional arguments from CLI
 * @returns Parsed trace target and span IDs
 * @throws {ContextError} If insufficient arguments
 * @throws {ValidationError} If any ID has an invalid format
 */
export function parsePositionalArgs(args: string[]): {
  traceTarget: ReturnType<typeof parseSlashSeparatedTraceTarget>;
  spanIds: string[];
} {
  if (args.length === 0) {
    throw new ContextError("Trace ID and span ID", USAGE_HINT, []);
  }

  const first = args[0];
  if (first === undefined) {
    throw new ContextError("Trace ID and span ID", USAGE_HINT, []);
  }

  // First arg is trace target (possibly with org/project prefix)
  const traceTarget = parseSlashSeparatedTraceTarget(first, USAGE_HINT);

  // Remaining args are span IDs
  const rawSpanIds = args.slice(1);
  if (rawSpanIds.length === 0) {
    throw new ContextError("Span ID", USAGE_HINT, [
      `Use 'sentry span list ${first}' to find span IDs within this trace`,
    ]);
  }
  const spanIds = rawSpanIds.map((v) => validateSpanId(v));

  return { traceTarget, spanIds };
}

/**
 * Format a list of span IDs as a markdown bullet list.
 */
function formatIdList(ids: string[]): string {
  return ids.map((id) => ` - \`${id}\``).join("\n");
}

/**
 * Warn about span IDs that weren't found in the trace.
 */
function warnMissingIds(spanIds: string[], foundIds: Set<string>): void {
  const missing = spanIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    log.warn(
      `${missing.length} of ${spanIds.length} span(s) not found in trace:\n${formatIdList(missing)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Output config types and formatters
// ---------------------------------------------------------------------------

/** Resolved span result from tree search. */
type SpanResult = FoundSpan & { spanId: string };

/** Structured data returned by the command for both JSON and human output */
type SpanViewData = {
  /** Found span results with ancestors and depth */
  results: SpanResult[];
  /** The trace ID for context */
  traceId: string;
  /** Maximum child tree depth to display (from --spans flag) */
  spansDepth: number;
};

/**
 * Serialize span results for JSON output.
 */
function buildJsonResults(results: SpanResult[], traceId: string): unknown[] {
  return results.map((r) => ({
    span_id: r.span.span_id,
    parent_span_id: r.span.parent_span_id,
    trace_id: traceId,
    op: r.span.op || r.span["transaction.op"],
    description: r.span.description || r.span.transaction,
    start_timestamp: r.span.start_timestamp,
    end_timestamp: r.span.end_timestamp || r.span.timestamp,
    duration: computeSpanDurationMs(r.span),
    project_slug: r.span.project_slug,
    transaction: r.span.transaction,
    depth: r.depth,
    ancestors: r.ancestors.map((a) => ({
      span_id: a.span_id,
      op: a.op || a["transaction.op"],
      description: a.description || a.transaction,
    })),
    children: (r.span.children ?? []).map((c) => ({
      span_id: c.span_id,
      op: c.op || c["transaction.op"],
      description: c.description || c.transaction,
    })),
  }));
}

/**
 * Format span view data for human-readable terminal output.
 *
 * Renders each span's details (KV table + ancestor chain) and optionally
 * shows the child span tree. Multiple spans are separated by `---`.
 */
function formatSpanViewHuman(data: SpanViewData): string {
  const parts: string[] = [];
  for (let i = 0; i < data.results.length; i++) {
    if (i > 0) {
      parts.push("\n---\n");
    }
    const result = data.results[i];
    if (!result) {
      continue;
    }
    parts.push(formatSpanDetails(result.span, result.ancestors, data.traceId));

    // Show child tree if --spans > 0 and the span has children
    const children = result.span.children ?? [];
    if (data.spansDepth > 0 && children.length > 0) {
      const treeLines = formatSimpleSpanTree(
        data.traceId,
        [result.span],
        data.spansDepth
      );
      if (treeLines.length > 0) {
        parts.push(`${treeLines.join("\n")}\n`);
      }
    }
  }
  return parts.join("");
}

/**
 * Transform span view data for JSON output.
 * Applies `--fields` filtering per element.
 */
function jsonTransformSpanView(data: SpanViewData, fields?: string[]): unknown {
  const mapped = buildJsonResults(data.results, data.traceId);
  if (fields && fields.length > 0) {
    return mapped.map((item) => filterFields(item, fields));
  }
  return mapped;
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of specific spans",
    fullDescription:
      "View detailed information about one or more spans within a trace.\n\n" +
      "Target specification:\n" +
      "  sentry span view <trace-id> <span-id>                        # auto-detect\n" +
      "  sentry span view <org>/<project>/<trace-id> <span-id>        # explicit\n\n" +
      "The first argument is the trace ID (optionally prefixed with org/project),\n" +
      "followed by one or more span IDs.\n\n" +
      "Examples:\n" +
      "  sentry span view <trace-id> a1b2c3d4e5f67890\n" +
      "  sentry span view <trace-id> a1b2c3d4e5f67890 b2c3d4e5f6789012\n" +
      "  sentry span view sentry/my-project/<trace-id> a1b2c3d4e5f67890",
  },
  output: {
    renderHuman: formatSpanViewHuman,
    jsonTransform: jsonTransformSpanView,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "trace-id/span-id",
        brief:
          "[<org>/<project>/]<trace-id> <span-id> [<span-id>...] - Trace ID and one or more span IDs",
        parse: String,
      },
    },
    flags: {
      ...spansFlag,
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES },
  },
  async *func(this: SentryContext, flags: ViewFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd, setContext } = this;

    // Parse positional args: first is trace target, rest are span IDs
    const { traceTarget, spanIds } = parsePositionalArgs(args);
    warnIfNormalized(traceTarget, "span.view");

    // Resolve org/project
    const { traceId, org, project } = await resolveTraceOrgProject(
      traceTarget,
      cwd,
      USAGE_HINT
    );
    setContext([org], [project]);

    // Fetch trace data (single fetch for all span lookups)
    const timestamp = Math.floor(Date.now() / 1000);
    const spans = await getDetailedTrace(org, traceId, timestamp);

    if (spans.length === 0) {
      throw new ValidationError(
        `No trace found with ID "${traceId}".\n\n` +
          "Make sure the trace ID is correct and the trace was sent recently."
      );
    }

    // Find each requested span
    const results: SpanResult[] = [];
    const foundIds = new Set<string>();

    for (const spanId of spanIds) {
      const found = findSpanById(spans, spanId);
      if (found) {
        results.push({
          spanId,
          span: found.span,
          ancestors: found.ancestors,
          depth: found.depth,
        });
        foundIds.add(spanId);
      }
    }

    if (results.length === 0) {
      const idList = formatIdList(spanIds);
      throw new ValidationError(
        spanIds.length === 1
          ? `No span found with ID "${spanIds[0]}" in trace ${traceId}.`
          : `No spans found with any of the following IDs in trace ${traceId}:\n${idList}`
      );
    }

    warnMissingIds(spanIds, foundIds);

    yield new CommandOutput({ results, traceId, spansDepth: flags.spans });
  },
});
