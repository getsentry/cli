/**
 * sentry log view
 *
 * View detailed information about a Sentry log entry.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getLog } from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { formatLogDetails, writeJson } from "../../lib/formatters/index.js";
import {
  resolveOrgAndProject,
  resolveProjectBySlug,
} from "../../lib/resolve-target.js";
import { buildLogsUrl } from "../../lib/sentry-urls.js";
import type { DetailedSentryLog, Writer } from "../../types/index.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry log view <org>/<project> <log-id>";

/**
 * Parse positional arguments for log view.
 * Handles: `<log-id>` or `<target> <log-id>`
 *
 * @param args - Positional arguments from CLI
 * @returns Parsed log ID and optional target arg
 * @throws {ContextError} If no arguments provided
 */
export function parsePositionalArgs(args: string[]): {
  logId: string;
  targetArg: string | undefined;
} {
  if (args.length === 0) {
    throw new ContextError("Log ID", USAGE_HINT);
  }

  const first = args[0];
  if (first === undefined) {
    throw new ContextError("Log ID", USAGE_HINT);
  }

  if (args.length === 1) {
    // Single arg - must be log ID
    return { logId: first, targetArg: undefined };
  }

  const second = args[1];
  if (second === undefined) {
    return { logId: first, targetArg: undefined };
  }

  // Two or more args - first is target, second is log ID
  return { logId: second, targetArg: first };
}

/**
 * Resolved target type for log commands.
 * @internal Exported for testing
 */
export type ResolvedLogTarget = {
  org: string;
  project: string;
  detectedFrom?: string;
};

/**
 * Write human-readable log output to stdout.
 *
 * @param stdout - Output stream
 * @param log - The log entry to display
 * @param orgSlug - Organization slug for trace URLs
 * @param detectedFrom - Optional context detection source to display
 */
function writeHumanOutput(
  stdout: Writer,
  log: DetailedSentryLog,
  orgSlug: string,
  detectedFrom?: string
): void {
  const lines = formatLogDetails(log, orgSlug);
  stdout.write(`${lines.join("\n")}\n`);

  if (detectedFrom) {
    stdout.write(`\nDetected from ${detectedFrom}\n`);
  }
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a specific log entry",
    fullDescription:
      "View detailed information about a Sentry log entry by its ID.\n\n" +
      "Target specification:\n" +
      "  sentry log view <log-id>              # auto-detect from DSN or config\n" +
      "  sentry log view <org>/<proj> <log-id> # explicit org and project\n" +
      "  sentry log view <project> <log-id>    # find project across all orgs\n\n" +
      "The log ID is the 32-character hexadecimal identifier shown in log listings.",
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "args",
        brief:
          "[<org>/<project>] <log-id> - Target (optional) and log ID (required)",
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
    const { logId, targetArg } = parsePositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);

    let target: ResolvedLogTarget | null = null;

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
          `sentry log view <org>/${parsed.projectSlug} ${logId}`
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
      await openInBrowser(stdout, buildLogsUrl(target.org, logId), "log");
      return;
    }

    // Fetch the log entry
    const log = await getLog(target.org, target.project, logId);

    if (!log) {
      throw new ValidationError(
        `No log found with ID "${logId}" in ${target.org}/${target.project}.\n\n` +
          "Make sure the log ID is correct and the log was sent within the last 90 days."
      );
    }

    if (flags.json) {
      writeJson(stdout, log);
      return;
    }

    writeHumanOutput(stdout, log, target.org, target.detectedFrom);
  },
});
