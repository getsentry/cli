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
  writeFooter,
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
import { buildTraceUrl } from "../../lib/sentry-urls.js";
import { validateTraceId } from "../../lib/trace-id.js";
import type { Writer } from "../../types/index.js";

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
 * Validate a trace ID and detect UUID auto-correction.
 *
 * Returns the validated trace ID and an optional warning when dashes were
 * stripped from a UUID-format input (e.g., `ed29abc8-71c4-475b-...`).
 */
function validateAndWarn(raw: string): {
  traceId: string;
  uuidWarning?: string;
} {
  const traceId = validateTraceId(raw);
  const trimmedRaw = raw.trim().toLowerCase();
  const uuidWarning =
    trimmedRaw.includes("-") && trimmedRaw !== traceId
      ? `Auto-corrected trace ID: stripped dashes → ${traceId}`
      : undefined;
  return { traceId, uuidWarning };
}

/**
 * Merge multiple optional warning strings into a single warning, or undefined.
 */
function mergeWarnings(
  ...warnings: (string | undefined)[]
): string | undefined {
  const filtered = warnings.filter(Boolean);
  return filtered.length > 0 ? filtered.join("\n") : undefined;
}

/**
 * Parse positional arguments for trace view.
 * Handles: `<trace-id>` or `<target> <trace-id>`
 *
 * Validates the trace ID format (32-character hex) and auto-corrects
 * UUID-format inputs by stripping dashes.
 *
 * @param args - Positional arguments from CLI
 * @returns Parsed trace ID and optional target arg
 * @throws {ContextError} If no arguments provided
 * @throws {ValidationError} If the trace ID format is invalid
 */
export function parsePositionalArgs(args: string[]): {
  traceId: string;
  targetArg: string | undefined;
  /** Warning message if arguments appear to be in the wrong order or UUID was auto-corrected */
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
    const validated = validateAndWarn(id);
    return {
      traceId: validated.traceId,
      targetArg,
      warning: validated.uuidWarning,
    };
  }

  const second = args[1];
  if (second === undefined) {
    const validated = validateAndWarn(first);
    return {
      traceId: validated.traceId,
      targetArg: undefined,
      warning: validated.uuidWarning,
    };
  }

  // Detect swapped args: user put ID first and target second
  const swapWarning = detectSwappedViewArgs(first, second);
  if (swapWarning) {
    const validated = validateAndWarn(first);
    return {
      traceId: validated.traceId,
      targetArg: second,
      warning: mergeWarnings(swapWarning, validated.uuidWarning),
    };
  }

  // Detect issue short ID passed as first arg (e.g., "CAM-82X some-trace-id")
  const suggestion = looksLikeIssueShortId(first)
    ? `Did you mean: sentry issue view ${first}`
    : undefined;

  // Two or more args - first is target, second is trace ID
  const validated = validateAndWarn(second);
  return {
    traceId: validated.traceId,
    targetArg: first,
    warning: validated.uuidWarning,
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
 * Write human-readable trace output to stdout.
 *
 * @param stdout - Output stream
 * @param options - Output options
 * @internal Exported for testing
 */
export function writeHumanOutput(
  stdout: Writer,
  options: {
    summaryLines: string;
    spanTreeLines?: string[];
  }
): void {
  const { summaryLines, spanTreeLines } = options;

  stdout.write(`${summaryLines}\n`);

  if (spanTreeLines && spanTreeLines.length > 0) {
    stdout.write(`${spanTreeLines.join("\n")}\n`);
  }
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
  async func(
    this: SentryContext,
    flags: ViewFlags,
    ...args: string[]
  ): Promise<void> {
    applyFreshFlag(flags);
    const { stdout, cwd, setContext } = this;
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
      await openInBrowser(stdout, buildTraceUrl(target.org, traceId), "trace");
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

    if (flags.json) {
      writeJson(stdout, { summary, spans }, flags.fields);
      return;
    }

    // Format span tree (unless disabled with --spans 0 or --spans no)
    const spanTreeLines =
      flags.spans > 0
        ? formatSimpleSpanTree(traceId, spans, flags.spans)
        : undefined;

    writeHumanOutput(stdout, {
      summaryLines: formatTraceSummary(summary),
      spanTreeLines,
    });

    writeFooter(
      stdout,
      `Tip: Open in browser with 'sentry trace view --web ${traceId}'`
    );
  },
});
