/**
 * sentry trace view
 *
 * View detailed information about a distributed trace.
 */

import type { SentryContext } from "../../context.js";
import {
  getDetailedTrace,
  getIssueByShortId,
  getLatestEvent,
} from "../../lib/api-client.js";
import {
  detectSwappedViewArgs,
  looksLikeIssueShortId,
  spansFlag,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import {
  computeTraceSummary,
  formatSimpleSpanTree,
  formatTraceSummary,
} from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { buildTraceUrl } from "../../lib/sentry-urls.js";
import { setOrgProjectContext } from "../../lib/telemetry.js";
import {
  parseTraceTarget,
  resolveTraceOrgProject,
  warnIfNormalized,
} from "../../lib/trace-target.js";
import type { TraceSpan } from "../../types/index.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly spans: number;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry trace view [<org>/<project>/]<trace-id>";

/**
 * Standard field names in trace view output (summary keys + "spans").
 *
 * When `--fields` includes names beyond these, the extras are forwarded
 * to the API as `additional_attributes` so the server populates them on
 * each span.
 */
const STANDARD_TRACE_VIEW_FIELDS = new Set([
  "traceId",
  "duration",
  "spanCount",
  "projects",
  "rootTransaction",
  "rootOp",
  "startTimestamp",
  "spans",
  "spanTreeLines",
]);

/**
 * Extract non-standard field names from `--fields` to pass as
 * `additional_attributes` to the trace detail API.
 *
 * Standard fields (summary keys, "spans") are filtered out because
 * they are already present in the response. Only extra names that
 * correspond to span attributes need to be requested from the API.
 *
 * @param fields - Parsed `--fields` value (may be undefined)
 * @returns Attribute names to request, or undefined when none are needed
 */
export function extractAdditionalAttributes(
  fields: string[] | undefined
): string[] | undefined {
  if (!fields || fields.length === 0) {
    return;
  }
  const extra = fields.filter((f) => !STANDARD_TRACE_VIEW_FIELDS.has(f));
  return extra.length > 0 ? extra : undefined;
}

/**
 * Detect UX issues in raw positional args before trace-target parsing.
 *
 * - **Single-arg issue short ID**: first arg looks like `CAM-82X` with no
 *   second arg → sets `issueShortId` for auto-recovery (resolve issue → trace).
 * - **Swapped args**: user typed `<trace-id> <org>/<project>` instead of
 *   `<org>/<project> <trace-id>`. If detected, swaps them silently and warns.
 * - **Two-arg issue short ID**: first arg looks like `CAM-82X` with a second
 *   arg → suggests `sentry issue view` (ambiguous intent, no auto-recovery).
 *
 * Returns corrected args and optional warnings to emit.
 *
 * @internal Exported for testing
 */
export function preProcessArgs(args: string[]): {
  correctedArgs: string[];
  warning?: string;
  suggestion?: string;
  /** Issue short ID detected for auto-recovery (single-arg only) */
  issueShortId?: string;
} {
  if (args.length === 0) {
    return { correctedArgs: args };
  }

  const first = args[0];
  if (!first) {
    return { correctedArgs: args };
  }

  // Single-arg issue short ID → auto-recover by resolving issue → trace
  if (args.length === 1 && looksLikeIssueShortId(first)) {
    return {
      correctedArgs: args,
      issueShortId: first,
    };
  }

  if (args.length < 2) {
    return { correctedArgs: args };
  }

  const second = args[1];
  if (!second) {
    return { correctedArgs: args };
  }

  // Detect swapped args: user put ID first and target second
  const swapWarning = detectSwappedViewArgs(first, second);
  if (swapWarning) {
    // Swap them: put target first, trace ID second
    return {
      correctedArgs: [second, first, ...args.slice(2)],
      warning: swapWarning,
    };
  }

  // Detect issue short ID passed as first arg (two-arg case — ambiguous)
  const suggestion = looksLikeIssueShortId(first)
    ? `Did you mean: sentry issue view ${first}`
    : undefined;

  return { correctedArgs: args, suggestion };
}

/**
 * Return type for trace view — includes all data both renderers need.
 * @internal Exported for testing
 */
export type TraceViewData = {
  summary: ReturnType<typeof computeTraceSummary>;
  spans: unknown[];
  /** Pre-formatted span tree lines for human output (not serialized) */
  spanTreeLines?: string[];
};

/**
 * Count spans in the tree that have non-empty `additional_attributes`.
 * Walks the nested children structure recursively.
 */
function countSpansWithAdditionalAttrs(spans: unknown[]): number {
  let count = 0;
  for (const raw of spans) {
    const span = raw as TraceSpan;
    const attrs = span.additional_attributes;
    if (attrs && Object.keys(attrs).length > 0) {
      count += 1;
    }
    if (span.children) {
      count += countSpansWithAdditionalAttrs(span.children);
    }
  }
  return count;
}

/**
 * Format trace view data for human-readable terminal output.
 *
 * Renders trace summary and optional span tree.
 * When spans carry `additional_attributes` (requested via `--fields`),
 * a note is appended indicating how many spans have extra data.
 *
 * @internal Exported for testing
 */
export function formatTraceView(data: TraceViewData): string {
  const parts: string[] = [];

  parts.push(formatTraceSummary(data.summary));

  if (data.spanTreeLines && data.spanTreeLines.length > 0) {
    parts.push(data.spanTreeLines.join("\n"));
  }

  const attrsCount = countSpansWithAdditionalAttrs(data.spans);
  if (attrsCount > 0) {
    const spanWord = attrsCount === 1 ? "span has" : "spans have";
    parts.push(
      `\n${attrsCount} ${spanWord} additional attributes. Use --json to see them.`
    );
  }

  return parts.join("\n");
}

/**
 * Return a copy of the span with zero-valued measurements removed.
 *
 * The Sentry trace detail API returns `measurements` on every span with
 * zero-valued web vitals (CLS, FCP, INP, LCP, TTFB, etc.) even for
 * non-browser spans. This adds ~40% noise to JSON output. This helper
 * strips entries where the value is exactly `0`, and omits the
 * `measurements` field entirely when all values are zero. Non-zero
 * measurements (e.g., on root `pageload` spans) are preserved.
 *
 * Processes children recursively so the entire span tree is cleaned.
 */
function filterSpanMeasurements(span: TraceSpan): TraceSpan {
  const { measurements, children, ...rest } = span;

  let cleanedMeasurements: Record<string, number> | undefined;
  if (measurements) {
    const nonZero = Object.fromEntries(
      Object.entries(measurements).filter(([, v]) => v !== 0)
    );
    if (Object.keys(nonZero).length > 0) {
      cleanedMeasurements = nonZero;
    }
  }

  return {
    ...rest,
    ...(cleanedMeasurements ? { measurements: cleanedMeasurements } : {}),
    ...(children ? { children: children.map(filterSpanMeasurements) } : {}),
  };
}

/**
 * Transform trace view data for JSON output.
 *
 * Flattens the summary as the primary object so that `--fields traceId,duration`
 * works directly on summary properties. The raw `spans` array is preserved as
 * a nested key, accessible via `--fields spans`.
 *
 * Without this transform, `--fields traceId` would return `{}` because
 * the raw yield shape is `{ summary, spans }` and `traceId` lives inside `summary`.
 *
 * Zero-valued measurements are filtered from each span to reduce noise
 * from the API (which returns zero web vitals on non-browser spans).
 */
function jsonTransformTraceView(
  data: TraceViewData,
  fields?: string[]
): unknown {
  const { summary, spans } = data;
  const cleanedSpans = (spans as TraceSpan[]).map(filterSpanMeasurements);
  const result: Record<string, unknown> = { ...summary, spans: cleanedSpans };
  if (fields && fields.length > 0) {
    return filterFields(result, fields);
  }
  return result;
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a specific trace",
    fullDescription:
      "View detailed information about a distributed trace by its ID.\n\n" +
      "Target specification:\n" +
      "  sentry trace view <trace-id>                       # auto-detect from DSN or config\n" +
      "  sentry trace view <org>/<project>/<trace-id>       # explicit org and project\n" +
      "  sentry trace view <project> <trace-id>             # find project across all orgs\n\n" +
      "The trace ID is the 32-character hexadecimal identifier.",
  },
  output: {
    human: formatTraceView,
    jsonTransform: jsonTransformTraceView,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/project/trace-id",
        brief:
          "[<org>/<project>/]<trace-id> - Target (optional) and trace ID (required)",
        parse: String,
      },
    },
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      ...spansFlag,
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES, w: "web" },
  },
  async *func(this: SentryContext, flags: ViewFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd } = this;
    const log = logger.withTag("trace.view");

    // Pre-process: detect swapped args and issue short IDs
    const { correctedArgs, warning, suggestion, issueShortId } =
      preProcessArgs(args);
    if (warning) {
      log.warn(warning);
    }
    if (suggestion) {
      log.warn(suggestion);
    }

    let traceId: string;
    let org: string;

    if (issueShortId) {
      // Auto-recover: user passed an issue short ID instead of a trace ID.
      // Resolve the issue → get its latest event → extract trace ID.
      log.warn(
        `'${issueShortId}' is an issue short ID, not a trace ID. Looking up the issue's trace.`
      );

      const resolved = await resolveOrg({ cwd });
      if (!resolved) {
        throw new ContextError(
          "Organization",
          `sentry issue view ${issueShortId}`
        );
      }
      org = resolved.org;

      const issue = await getIssueByShortId(org, issueShortId);
      // Enrich telemetry with the issue's project (resolveOrg only sets sentry.org)
      if (issue.project?.slug) {
        setOrgProjectContext([org], [issue.project.slug]);
      }
      const event = await getLatestEvent(org, issue.id);
      const eventTraceId = event?.contexts?.trace?.trace_id;
      if (!eventTraceId) {
        throw new ValidationError(
          `Could not find a trace for issue '${issueShortId}'. The latest event has no trace context.\n\n` +
            `Try: sentry issue view ${issueShortId}`
        );
      }
      traceId = eventTraceId;
    } else {
      // Normal flow: parse and resolve org/project/trace-id
      const parsed = parseTraceTarget(correctedArgs, USAGE_HINT);
      warnIfNormalized(parsed, "trace.view");
      const resolved = await resolveTraceOrgProject(parsed, cwd, USAGE_HINT);
      traceId = resolved.traceId;
      org = resolved.org;
    }

    if (flags.web) {
      await openInBrowser(buildTraceUrl(org, traceId), "trace");
      return;
    }

    // Forward non-standard --fields as additional_attributes so the
    // trace API populates them on each span for JSON consumers.
    const additionalAttributes = extractAdditionalAttributes(flags.fields);

    // The trace API requires a timestamp to help locate the trace data.
    // Use current time - the API will search around this timestamp.
    const timestamp = Math.floor(Date.now() / 1000);
    const spans = await getDetailedTrace(
      org,
      traceId,
      timestamp,
      additionalAttributes
    );

    if (spans.length === 0) {
      throw new ValidationError(
        `No trace found with ID "${traceId}".\n\n` +
          "Make sure the trace ID is correct and the trace was sent recently."
      );
    }

    const summary = computeTraceSummary(traceId, spans);

    // Format span tree (unless disabled with --spans 0 or --spans no)
    const spanTreeLines =
      flags.spans > 0
        ? formatSimpleSpanTree(traceId, spans, flags.spans)
        : undefined;

    yield new CommandOutput({ summary, spans, spanTreeLines });
    return {
      hint: `Tip: Open in browser with 'sentry trace view --web ${traceId}'`,
    };
  },
});
