/**
 * sentry trace view
 *
 * View detailed information about a distributed trace.
 */

import type { SentryContext } from "../../context.js";
import { getDetailedTrace } from "../../lib/api-client.js";
import {
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
  resolveOrgAndProject,
  resolveProjectBySlug,
} from "../../lib/resolve-target.js";
import { buildTraceUrl } from "../../lib/sentry-urls.js";
import type { Writer } from "../../types/index.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly spans: number;
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry trace view <org>/<project> <trace-id>";

/**
 * Parse positional arguments for trace view.
 * Handles: `<trace-id>` or `<target> <trace-id>`
 *
 * @param args - Positional arguments from CLI
 * @returns Parsed trace ID and optional target arg
 * @throws {ContextError} If no arguments provided
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
    const { id: traceId, targetArg } = parseSlashSeparatedArg(
      first,
      "Trace ID",
      USAGE_HINT
    );
    return { traceId, targetArg };
  }

  const second = args[1];
  if (second === undefined) {
    return { traceId: first, targetArg: undefined };
  }

  // Two or more args - first is target, second is trace ID
  return { traceId: second, targetArg: first };
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
    summaryLines: string[];
    spanTreeLines?: string[];
  }
): void {
  const { summaryLines, spanTreeLines } = options;

  stdout.write(`${summaryLines.join("\n")}\n`);

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
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      ...spansFlag,
    },
    aliases: { w: "web" },
  },
  async func(
    this: SentryContext,
    flags: ViewFlags,
    ...args: string[]
  ): Promise<void> {
    const { stdout, cwd, setContext } = this;

    // Parse positional args
    const { traceId, targetArg } = parsePositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);

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
      writeJson(stdout, { summary, spans });
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
