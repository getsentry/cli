/**
 * sentry span view
 *
 * View detailed information about one or more spans within a trace.
 */

import type { SentryContext } from "../../context.js";
import { getDetailedTrace } from "../../lib/api-client.js";
import {
  parseOrgProjectArg,
  parseSlashSeparatedArg,
  spansFlag,
} from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import {
  type FoundSpan,
  findSpanById,
  formatSimpleSpanTree,
  formatSpanDetails,
  writeJson,
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

const log = logger.withTag("span.view");

type ViewFlags = {
  readonly trace: string;
  readonly json: boolean;
  readonly spans: number;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Regex for a 16-character hex span ID */
const SPAN_ID_RE = /^[0-9a-f]{16}$/i;

/** Usage hint for ContextError messages */
const USAGE_HINT =
  "sentry span view [<org>/<project>] <span-id> [<span-id>...] --trace <trace-id>";

/**
 * Validate that a string is a 16-character hexadecimal span ID.
 *
 * @param value - The string to validate
 * @returns The trimmed, lowercased span ID
 * @throws {ValidationError} If the format is invalid
 */
export function validateSpanId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!SPAN_ID_RE.test(trimmed)) {
    throw new ValidationError(
      `Invalid span ID "${trimmed}". Expected a 16-character hexadecimal string.\n\n` +
        "Example: a1b2c3d4e5f67890"
    );
  }
  return trimmed;
}

/**
 * Check if a string looks like a 16-char hex span ID.
 * Used to distinguish span IDs from target args without throwing.
 */
function looksLikeSpanId(value: string): boolean {
  return SPAN_ID_RE.test(value.trim());
}

/**
 * Parse positional arguments for span view.
 * Handles:
 * - `<span-id>` — single span ID (auto-detect org/project)
 * - `<span-id> <span-id> ...` — multiple span IDs
 * - `<target> <span-id> [<span-id>...]` — explicit target + span IDs
 *
 * The first arg is treated as a target if it contains "/" or doesn't look
 * like a 16-char hex span ID.
 *
 * @param args - Positional arguments from CLI
 * @returns Parsed span IDs and optional target arg
 * @throws {ContextError} If no arguments provided
 * @throws {ValidationError} If any span ID has an invalid format
 */
export function parsePositionalArgs(args: string[]): {
  spanIds: string[];
  targetArg: string | undefined;
} {
  if (args.length === 0) {
    throw new ContextError("Span ID", USAGE_HINT);
  }

  const first = args[0];
  if (first === undefined) {
    throw new ContextError("Span ID", USAGE_HINT);
  }

  if (args.length === 1) {
    // Single arg — could be slash-separated or a plain span ID
    const { id, targetArg } = parseSlashSeparatedArg(
      first,
      "Span ID",
      USAGE_HINT
    );
    const spanIds = [validateSpanId(id)];
    return { spanIds, targetArg };
  }

  // Multiple args — determine if first is a target or span ID
  if (first.includes("/") || !looksLikeSpanId(first)) {
    // First arg is a target
    const rawIds = args.slice(1);
    const spanIds = rawIds.map((v) => validateSpanId(v));
    if (spanIds.length === 0) {
      throw new ContextError("Span ID", USAGE_HINT);
    }
    return { spanIds, targetArg: first };
  }

  // All args are span IDs
  const spanIds = args.map((v) => validateSpanId(v));
  return { spanIds, targetArg: undefined };
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

/** Resolved target type for span commands. */
type ResolvedSpanTarget = { org: string; project: string };

/**
 * Resolve org/project from the parsed target argument.
 */
async function resolveTarget(
  parsed: ReturnType<typeof parseOrgProjectArg>,
  spanIds: string[],
  traceId: string,
  cwd: string
): Promise<ResolvedSpanTarget | null> {
  switch (parsed.type) {
    case "explicit":
      return { org: parsed.org, project: parsed.project };

    case "project-search":
      return await resolveProjectBySlug(
        parsed.projectSlug,
        USAGE_HINT,
        `sentry span view <org>/${parsed.projectSlug} ${spanIds[0]} --trace ${traceId}`
      );

    case "org-all":
      throw new ContextError("Specific project", USAGE_HINT);

    case "auto-detect":
      return await resolveOrgAndProject({ cwd, usageHint: USAGE_HINT });

    default: {
      const _exhaustiveCheck: never = parsed;
      throw new ValidationError(
        `Invalid target specification: ${_exhaustiveCheck}`
      );
    }
  }
}

/** Resolved span result from tree search. */
type SpanResult = FoundSpan & { spanId: string };

/**
 * Serialize span results for JSON output.
 */
function buildJsonResults(results: SpanResult[], traceId: string): unknown {
  const mapped = results.map((r) => ({
    span_id: r.span.span_id,
    parent_span_id: r.span.parent_span_id,
    trace_id: traceId,
    op: r.span.op || r.span["transaction.op"],
    description: r.span.description || r.span.transaction,
    start_timestamp: r.span.start_timestamp,
    end_timestamp: r.span.end_timestamp || r.span.timestamp,
    duration: r.span.duration,
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
  return mapped.length === 1 ? mapped[0] : mapped;
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of specific spans",
    fullDescription:
      "View detailed information about one or more spans within a trace.\n\n" +
      "Target specification:\n" +
      "  sentry span view <span-id> --trace <trace-id>              # auto-detect\n" +
      "  sentry span view <org>/<proj> <span-id> --trace <trace-id> # explicit\n" +
      "  sentry span view <project> <span-id> --trace <trace-id>    # project search\n\n" +
      "The --trace flag is required to identify which trace contains the span(s).\n" +
      "Multiple span IDs can be passed as separate arguments.\n\n" +
      "Examples:\n" +
      "  sentry span view a1b2c3d4e5f67890 --trace <trace-id>\n" +
      "  sentry span view a1b2c3d4e5f67890 b2c3d4e5f6789012 --trace <trace-id>",
  },
  output: "json",
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "args",
        brief:
          "[<org>/<project>] <span-id> [<span-id>...] - Target (optional) and one or more span IDs",
        parse: String,
      },
    },
    flags: {
      trace: {
        kind: "parsed",
        parse: validateTraceId,
        brief: "Trace ID containing the span(s) (required)",
      },
      ...spansFlag,
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES, t: "trace" },
  },
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: view command with multi-span support
  async func(
    this: SentryContext,
    flags: ViewFlags,
    ...args: string[]
  ): Promise<void> {
    applyFreshFlag(flags);
    const { stdout, cwd, setContext } = this;
    const cmdLog = logger.withTag("span.view");

    const traceId = flags.trace;

    // Parse positional args
    const { spanIds, targetArg } = parsePositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);
    if (parsed.type !== "auto-detect" && parsed.normalized) {
      cmdLog.warn("Normalized slug (Sentry slugs use dashes, not underscores)");
    }

    const target = await resolveTarget(parsed, spanIds, traceId, cwd);

    if (!target) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    setContext([target.org], [target.project]);

    // Fetch trace data (single fetch for all span lookups)
    const timestamp = Math.floor(Date.now() / 1000);
    const spans = await getDetailedTrace(target.org, traceId, timestamp);

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

    if (flags.json) {
      writeJson(stdout, buildJsonResults(results, traceId), flags.fields);
      return;
    }

    // Human output
    let first = true;
    for (const result of results) {
      if (!first) {
        stdout.write("\n---\n\n");
      }
      stdout.write(formatSpanDetails(result.span, result.ancestors, traceId));

      // Show child tree if --spans > 0 and the span has children
      const children = result.span.children ?? [];
      if (flags.spans > 0 && children.length > 0) {
        const treeLines = formatSimpleSpanTree(
          traceId,
          [result.span],
          flags.spans
        );
        if (treeLines.length > 0) {
          stdout.write(`${treeLines.join("\n")}\n`);
        }
      }

      first = false;
    }
  },
});
