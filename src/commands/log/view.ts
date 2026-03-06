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
import { logger } from "../../lib/logger.js";
import {
  resolveOrgAndProject,
  resolveProjectBySlug,
} from "../../lib/resolve-target.js";
import { buildLogsUrl } from "../../lib/sentry-urls.js";
import type { DetailedSentryLog, Writer } from "../../types/index.js";

const log = logger.withTag("log-view");

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
 * Resolve the target org/project from the parsed arg.
 *
 * @param parsed - Result of `parseOrgProjectArg`
 * @param logIds - Parsed log IDs (used for usage hints)
 * @param cwd - Current working directory
 * @param stderr - Stderr stream for diagnostics
 * @returns Resolved target, or null if resolution produced nothing
 * @throws {ContextError} If org-all mode is used (requires specific project)
 */
function resolveTarget(
  parsed: ReturnType<typeof parseOrgProjectArg>,
  logIds: string[],
  cwd: string,
  stderr: Writer
): Promise<ResolvedLogTarget | null> | ResolvedLogTarget {
  switch (parsed.type) {
    case "explicit":
      return { org: parsed.org, project: parsed.project };

    case "project-search":
      return resolveProjectBySlug(
        parsed.projectSlug,
        USAGE_HINT,
        `sentry log view <org>/${parsed.projectSlug} ${logIds.join(" ")}`,
        stderr
      );

    case "org-all":
      throw new ContextError("Specific project", USAGE_HINT);

    case "auto-detect":
      return resolveOrgAndProject({ cwd, usageHint: USAGE_HINT });

    default: {
      const _exhaustiveCheck: never = parsed;
      throw new ValidationError(
        `Invalid target specification: ${_exhaustiveCheck}`
      );
    }
  }
}

/**
 * Format a list of log IDs as a markdown bullet list.
 *
 * @param ids - Log IDs to format
 * @returns Markdown list string with each ID on its own line
 */
function formatIdList(ids: string[]): string {
  return ids.map((id) => ` - \`${id}\``).join("\n");
}

/**
 * Warn about IDs that weren't found in the API response.
 * Uses the consola logger for structured output to stderr.
 *
 * @param logIds - All requested IDs
 * @param logs - Logs actually returned by the API
 */
function warnMissingIds(logIds: string[], logs: DetailedSentryLog[]): void {
  if (logs.length >= logIds.length) {
    return;
  }
  const foundIds = new Set(logs.map((l) => l["sentry.item_id"]));
  const missing = logIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    log.warn(
      `${missing.length} of ${logIds.length} log(s) not found:\n${formatIdList(missing)}`
    );
  }
}

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
  for (const entry of logs) {
    if (!first) {
      stdout.write("\n---\n\n");
    }
    stdout.write(`${formatLogDetails(entry, orgSlug)}\n`);
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

    const target = await resolveTarget(parsed, logIds, cwd, this.stderr);

    if (!target) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    // Set telemetry context
    setContext([target.org], [target.project]);

    if (flags.web) {
      if (logIds.length > 1) {
        log.warn(`Opening ${logIds.length} browser tabs…`);
      }
      for (const id of logIds) {
        await openInBrowser(stdout, buildLogsUrl(target.org, id), "log");
      }
      return;
    }

    // Fetch all requested log entries
    const logs = await getLogs(target.org, target.project, logIds);

    if (logs.length === 0) {
      const idList = formatIdList(logIds);
      throw new ValidationError(
        logIds.length === 1
          ? `No log found with ID "${logIds[0]}" in ${target.org}/${target.project}.\n\n` +
              "Make sure the log ID is correct and the log was sent within the last 90 days."
          : `No logs found with any of the following IDs in ${target.org}/${target.project}:\n${idList}\n\n` +
              "Make sure the log IDs are correct and the logs were sent within the last 90 days."
      );
    }

    warnMissingIds(logIds, logs);

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
