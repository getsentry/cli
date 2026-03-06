/**
 * sentry log view
 *
 * View detailed information about one or more Sentry log entries.
 */

import type { SentryContext } from "../../context.js";
import { getLogs } from "../../lib/api-client.js";
import {
  parseOrgProjectArg,
  parseSlashSeparatedArg,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { formatLogDetails, writeJson } from "../../lib/formatters/index.js";
import { validateHexId } from "../../lib/hex-id.js";
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
const USAGE_HINT = "sentry log view <org>/<project> <log-id> [<log-id>...]";

/**
 * Split a raw argument into individual log IDs.
 * Handles newline-separated IDs within a single argument (common when
 * piping or pasting from other tools).
 *
 * @param arg - Raw positional argument
 * @returns Array of non-empty trimmed strings
 */
function splitLogIds(arg: string): string[] {
  return arg
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse positional arguments for log view.
 * Handles:
 * - `<log-id>` — single log ID (auto-detect org/project)
 * - `<log-id1> <log-id2> ...` — multiple log IDs (auto-detect)
 * - `<target> <log-id> [<log-id>...]` — explicit target + one or more log IDs
 * - `<org>/<project>/<log-id>` — single slash-separated arg
 *
 * Arguments containing newlines are split into multiple IDs.
 *
 * @param args - Positional arguments from CLI
 * @returns Parsed log IDs and optional target arg
 * @throws {ContextError} If no arguments provided
 * @throws {ValidationError} If any log ID has an invalid format
 */
export function parsePositionalArgs(args: string[]): {
  logIds: string[];
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
    // Single arg — could be slash-separated org/project/logId or a plain ID
    // (possibly containing newlines)
    const { id, targetArg } = parseSlashSeparatedArg(
      first,
      "Log ID",
      USAGE_HINT
    );
    const logIds = splitLogIds(id).map((v) => validateHexId(v, "log ID"));
    if (logIds.length === 0) {
      throw new ContextError("Log ID", USAGE_HINT);
    }
    return { logIds, targetArg };
  }

  // Two or more args — first is target, rest are log IDs.
  // Each arg may contain newlines (split them).
  const rawIds = args.slice(1).flatMap(splitLogIds);
  const logIds = rawIds.map((v) => validateHexId(v, "log ID"));
  if (logIds.length === 0) {
    throw new ContextError("Log ID", USAGE_HINT);
  }
  return { logIds, targetArg: first };
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
 * Write human-readable output for one or more logs to stdout.
 *
 * @param stdout - Output stream
 * @param logs - Log entries to display
 * @param orgSlug - Organization slug for trace URLs
 * @param detectedFrom - Optional context detection source to display
 */
function writeHumanOutput(
  stdout: Writer,
  logs: DetailedSentryLog[],
  orgSlug: string,
  detectedFrom?: string
): void {
  let first = true;
  for (const log of logs) {
    if (!first) {
      stdout.write("\n---\n\n");
    }
    stdout.write(`${formatLogDetails(log, orgSlug)}\n`);
    first = false;
  }

  if (detectedFrom) {
    stdout.write(`\nDetected from ${detectedFrom}\n`);
  }
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of one or more log entries",
    fullDescription:
      "View detailed information about Sentry log entries by their IDs.\n\n" +
      "Target specification:\n" +
      "  sentry log view <log-id>                          # auto-detect from DSN or config\n" +
      "  sentry log view <org>/<proj> <log-id> [<id>...]   # explicit org and project\n" +
      "  sentry log view <project> <log-id> [<id>...]      # find project across all orgs\n\n" +
      "Multiple log IDs can be passed as separate arguments or newline-separated\n" +
      "within a single argument (handy when piping from other commands).\n\n" +
      "The log ID is the 32-character hexadecimal identifier shown in log listings.",
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "args",
        brief:
          "[<org>/<project>] <log-id> [<log-id>...] - Target (optional) and one or more log IDs",
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
    const { logIds, targetArg } = parsePositionalArgs(args);
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
          `sentry log view <org>/${parsed.projectSlug} ${logIds[0]}`,
          this.stderr
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
      // --web only opens the first log (browser can only open one meaningfully)
      await openInBrowser(stdout, buildLogsUrl(target.org, logIds[0]), "log");
      return;
    }

    // Fetch all requested log entries
    const logs = await getLogs(target.org, target.project, logIds);

    if (logs.length === 0) {
      const idDisplay =
        logIds.length === 1
          ? `ID "${logIds[0]}"`
          : `IDs ${logIds.map((id) => `"${id}"`).join(", ")}`;
      throw new ValidationError(
        `No logs found with ${idDisplay} in ${target.org}/${target.project}.\n\n` +
          "Make sure the log IDs are correct and the logs were sent within the last 90 days."
      );
    }

    // Warn about any IDs that weren't found
    if (logs.length < logIds.length) {
      const foundIds = new Set(logs.map((l) => l["sentry.item_id"]));
      const missing = logIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        const stderr = this.stderr;
        stderr.write(
          `Warning: ${missing.length} of ${logIds.length} log(s) not found: ${missing.join(", ")}\n`
        );
      }
    }

    if (flags.json) {
      // Single ID: output single object for backward compatibility
      // Multiple IDs: output array
      if (logIds.length === 1 && logs.length === 1) {
        writeJson(stdout, logs[0]);
      } else {
        writeJson(stdout, logs);
      }
      return;
    }

    writeHumanOutput(stdout, logs, target.org, target.detectedFrom);
  },
});
