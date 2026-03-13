/**
 * sentry trace view
 *
 * View detailed information about a distributed trace.
 */

import type { SentryContext } from "../../context.js";
import { getDetailedTrace } from "../../lib/api-client.js";
import {
  detectSwappedViewArgs,
  looksLikeIssueShortId,
  parseOrgProjectArg,
  parseSlashSeparatedArg,
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
import { buildTraceUrl } from "../../lib/sentry-urls.js";
import { validateTraceId } from "../../lib/trace-id.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly spans: number;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry trace view <org>/<project> <trace-id>";

/**
 * Parse positional arguments for trace view.
 * Handles: `<trace-id>` or `<target> <trace-id>`
 *
 * Validates the trace ID format (32-character hex) and silently strips
 * dashes from UUID-format inputs.
 *
 * @param args - Positional arguments from CLI
 * @returns Parsed trace ID and optional target arg
 * @throws {ContextError} If no arguments provided
 * @throws {ValidationError} If the trace ID format is invalid
 */
export function parsePositionalArgs(args: string[]): {
  traceId: string;
  targetArg: string | undefined;
  /** Warning message if arguments appear to be in the wrong order */
  warning?: string;
  /** Suggestion when first arg looks like an issue short ID */
  suggestion?: string;
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

  // Detect swapped args: user put ID first and target second
  const swapWarning = detectSwappedViewArgs(first, second);
  if (swapWarning) {
    return {
      traceId: validateTraceId(first),
      targetArg: second,
      warning: swapWarning,
    };
  }

  // Detect issue short ID passed as first arg (e.g., "CAM-82X some-trace-id")
  const suggestion = looksLikeIssueShortId(first)
    ? `Did you mean: sentry issue view ${first}`
    : undefined;

  // Two or more args - first is target, second is trace ID
  return {
    traceId: validateTraceId(second),
    targetArg: first,
    suggestion,
  };
}

/**
 * Resolved target type for trace commands.
 * @internal Exported for testing
 */
export type ResolvedTraceTarget = {
  org: string;
  project: string;
  detectedFrom?: string;
};

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
 * Format trace view data for human-readable terminal output.
 *
 * Renders trace summary and optional span tree.
 * @internal Exported for testing
 */
export function formatTraceView(data: TraceViewData): string {
  const parts: string[] = [];

  parts.push(formatTraceSummary(data.summary));

  if (data.spanTreeLines && data.spanTreeLines.length > 0) {
    parts.push(data.spanTreeLines.join("\n"));
  }

  return parts.join("\n");
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a specific trace",
    fullDescription:
      "View detailed information about a distributed trace by its ID.\n\n" +
      "Target specification:\n" +
      "  sentry trace view <trace-id>              # auto-detect from DSN or config\n" +
      "  sentry trace view <org>/<proj> <trace-id> # explicit org and project\n" +
      "  sentry trace view <project> <trace-id>    # find project across all orgs\n\n" +
      "The trace ID is the 32-character hexadecimal identifier.",
  },
  output: {
    json: true,
    human: formatTraceView,
    jsonExclude: ["spanTreeLines"],
  },
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
  async func(this: SentryContext, flags: ViewFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd, setContext } = this;
    const log = logger.withTag("trace.view");

    // Parse positional args
    const { traceId, targetArg, warning, suggestion } =
      parsePositionalArgs(args);
    if (warning) {
      log.warn(warning);
    }
    if (suggestion) {
      log.warn(suggestion);
    }
    const parsed = parseOrgProjectArg(targetArg);
    if (parsed.type !== "auto-detect" && parsed.normalized) {
      log.warn("Normalized slug (Sentry slugs use dashes, not underscores)");
    }

    let target: ResolvedTraceTarget | null = null;

    switch (parsed.type) {
      case "explicit":
        target = {
          org: parsed.org,
          project: parsed.project,
        };
        break;

      case "project-search":
        target = await resolveProjectBySlug(
          parsed.projectSlug,
          USAGE_HINT,
          `sentry trace view <org>/${parsed.projectSlug} ${traceId}`
        );
        break;

      case "org-all":
        throw new ContextError("Specific project", USAGE_HINT);

      case "auto-detect":
        target = await resolveOrgAndProject({ cwd, usageHint: USAGE_HINT });
        break;

      default: {
        // Exhaustive check - should never reach here
        const _exhaustiveCheck: never = parsed;
        throw new ValidationError(
          `Invalid target specification: ${_exhaustiveCheck}`
        );
      }
    }

    if (!target) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    // Set telemetry context
    setContext([target.org], [target.project]);

    if (flags.web) {
      await openInBrowser(buildTraceUrl(target.org, traceId), "trace");
      return;
    }

    // The trace API requires a timestamp to help locate the trace data.
    // Use current time - the API will search around this timestamp.
    const timestamp = Math.floor(Date.now() / 1000);
    const spans = await getDetailedTrace(target.org, traceId, timestamp);

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

    return {
      data: { summary, spans, spanTreeLines },
      hint: `Tip: Open in browser with 'sentry trace view --web ${traceId}'`,
    };
  },
});
