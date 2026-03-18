/**
 * sentry log view
 *
 * View detailed information about one or more Sentry log entries.
 */

import { isatty } from "node:tty";

import type { SentryContext } from "../../context.js";
import { getLogs } from "../../lib/api-client.js";
import {
  looksLikeIssueShortId,
  parseOrgProjectArg,
  parseSlashSeparatedArg,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { formatLogDetails } from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { validateHexId } from "../../lib/hex-id.js";
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
import { buildLogsUrl } from "../../lib/sentry-urls.js";
import type { DetailedSentryLog } from "../../types/index.js";

const log = logger.withTag("log-view");

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry log view <org>/<project> <log-id> [<log-id>...]";

/** Matches a string of all digits (numeric project ID) */
const ALL_DIGITS_RE = /^\d+$/;

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
 * - `<target> <log-id> [<log-id>...]` — explicit target + one or more log IDs
 * - `<org>/<project>/<log-id>` — single slash-separated arg
 *
 * When two or more args are provided, the first is always treated as the
 * target (org/project specifier) and the rest as log IDs.
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
  /** Suggestion when first arg looks like an issue short ID */
  suggestion?: string;
} {
  if (args.length === 0) {
    throw new ContextError("Log ID", USAGE_HINT, []);
  }

  const first = args[0];
  if (first === undefined) {
    throw new ContextError("Log ID", USAGE_HINT, []);
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
      throw new ContextError("Log ID", USAGE_HINT, []);
    }
    return { logIds, targetArg };
  }

  // Two or more args — first is target, rest are log IDs.
  // Each arg may contain newlines (split them).
  const rawIds = args.slice(1).flatMap(splitLogIds);
  const logIds = rawIds.map((v) => validateHexId(v, "log ID"));
  if (logIds.length === 0) {
    throw new ContextError("Log ID", USAGE_HINT, []);
  }
  // Swap detection is not useful here: validateHexId above rejects non-hex
  // log IDs (which include any containing "/"), so detectSwappedViewArgs
  // (which checks for "/" in the second arg) can never trigger.
  // We still check for issue short IDs in the first (target) position.
  const suggestion = looksLikeIssueShortId(first)
    ? `Did you mean: sentry issue view ${first}`
    : undefined;

  return { logIds, targetArg: first, suggestion };
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
 * @returns Resolved target, or null if resolution produced nothing
 * @throws {ContextError} If org-all mode is used (requires specific project)
 */
async function resolveTarget(
  parsed: ReturnType<typeof parseOrgProjectArg>,
  logIds: string[],
  cwd: string
): Promise<ResolvedLogTarget | null> {
  switch (parsed.type) {
    case "explicit":
      return { org: parsed.org, project: parsed.project };

    case "project-search": {
      const result = await resolveProjectBySlug(
        parsed.projectSlug,
        USAGE_HINT,
        `sentry log view <org>/${parsed.projectSlug} ${logIds.join(" ")}`
      );
      if (
        ALL_DIGITS_RE.test(parsed.projectSlug) &&
        result.project !== parsed.projectSlug
      ) {
        log.info(
          `Tip: Resolved project ID ${parsed.projectSlug} to ${result.org}/${result.project}. ` +
            "Use the slug form for faster lookups."
        );
      }
      return result;
    }

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
 * Handle --web flag: open log URLs in the browser.
 * Prompts for confirmation in interactive mode when multiple IDs are given.
 * Aborts in non-interactive mode with a warning.
 *
 * @param orgSlug - Organization slug for URL building
 * @param logIds - Log IDs to open
 */
async function handleWebOpen(orgSlug: string, logIds: string[]): Promise<void> {
  if (logIds.length > 1) {
    if (!isatty(0)) {
      log.warn(
        `Refusing to open ${logIds.length} browser tabs in non-interactive mode. ` +
          "Pass a single log ID or run interactively."
      );
      return;
    }
    const confirmed = await log.prompt(`Open ${logIds.length} browser tabs?`, {
      type: "confirm",
      initial: false,
    });
    // consola prompt returns Symbol(clack:cancel) on Ctrl+C — a truthy value.
    // Strictly check for `true` to avoid opening tabs on cancel.
    if (confirmed !== true) {
      return;
    }
  }
  for (const id of logIds) {
    await openInBrowser(buildLogsUrl(orgSlug, id), "log");
  }
}

/**
 * Throw a descriptive error when no logs were found.
 *
 * @param logIds - Requested IDs
 * @param org - Organization slug
 * @param project - Project slug
 * @throws {ValidationError} Always
 */
function throwNotFoundError(
  logIds: string[],
  org: string,
  project: string
): never {
  const idList = formatIdList(logIds);
  throw new ValidationError(
    logIds.length === 1
      ? `No log found with ID "${logIds[0]}" in ${org}/${project}.\n\n` +
          "Make sure the log ID is correct and the log was sent within the last 90 days."
      : `No logs found with any of the following IDs in ${org}/${project}:\n${idList}\n\n` +
          "Make sure the log IDs are correct and the logs were sent within the last 90 days."
  );
}

/**
 * Data returned by the log view command.
 * Used by both JSON and human output paths.
 */
type LogViewData = {
  /** Retrieved log entries */
  logs: DetailedSentryLog[];
  /** Org slug — needed by human formatter for trace URLs, also useful context in JSON */
  orgSlug: string;
};

/**
 * Format log view data as human-readable output.
 *
 * Each log entry is formatted with full details. Multiple entries
 * are separated by horizontal rules.
 *
 * @param data - Log view data with entries and org slug
 * @returns Formatted string for terminal output
 */
function formatLogViewHuman(data: LogViewData): string {
  const parts: string[] = [];
  for (const entry of data.logs) {
    if (parts.length > 0) {
      parts.push("\n---\n");
    }
    parts.push(formatLogDetails(entry, data.orgSlug));
  }
  return parts.join("\n");
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
  output: {
    renderHuman: formatLogViewHuman,
    // Preserve original JSON contract: bare array of log entries.
    // orgSlug exists only for the human formatter (trace URLs).
    jsonTransform: (data: LogViewData, fields) =>
      fields && fields.length > 0
        ? data.logs.map((entry) => filterFields(entry, fields))
        : data.logs,
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
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES, w: "web" },
  },
  async *func(this: SentryContext, flags: ViewFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd, setContext } = this;
    const cmdLog = logger.withTag("log.view");

    // Parse positional args
    const { logIds, targetArg, suggestion } = parsePositionalArgs(args);
    if (suggestion) {
      cmdLog.warn(suggestion);
    }
    const parsed = parseOrgProjectArg(targetArg);

    const target = await resolveTarget(parsed, logIds, cwd);

    if (!target) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    // Set telemetry context
    setContext([target.org], [target.project]);

    if (flags.web) {
      await handleWebOpen(target.org, logIds);
      return;
    }

    // Fetch all requested log entries
    const logs = await getLogs(target.org, target.project, logIds);

    if (logs.length === 0) {
      throwNotFoundError(logIds, target.org, target.project);
    }

    warnMissingIds(logIds, logs);

    const hint = target.detectedFrom
      ? `Detected from ${target.detectedFrom}`
      : undefined;

    yield new CommandOutput({ logs, orgSlug: target.org });
    return { hint };
  },
});
