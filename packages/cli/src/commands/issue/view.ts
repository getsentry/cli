/**
 * sentry issue view
 *
 * View detailed information about one or more Sentry issues.
 */

import pLimit from "p-limit";
import type { SentryContext } from "../../context.js";
import {
  getLatestEvent,
  listReplayIdsForIssue,
  ORG_FANOUT_CONCURRENCY,
} from "../../lib/api-client.js";
import { spansFlag, splitNewlineArg } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatEventDetails,
  formatIssueDetails,
  isPlainOutput,
  muted,
  renderMarkdown,
} from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import {
  collectReplayIds,
  getReplayIdFromEvent,
} from "../../lib/replay-search.js";
import { getSpanTreeLines } from "../../lib/span-tree.js";
import type { SentryEvent, SentryIssue } from "../../types/index.js";
import { IssueViewOutputSchema } from "../../types/index.js";
import { resolveIssue } from "./utils.js";

const log = logger.withTag("issue.view");

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry issue view <issue> [<issue>...]";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly spans: number;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/**
 * Try to fetch the latest event for an issue.
 * Returns undefined if the fetch fails (non-blocking).
 *
 * @param orgSlug - Organization slug for API routing
 * @param issueId - Issue ID (numeric)
 */
async function tryGetLatestEvent(
  orgSlug: string,
  issueId: string
): Promise<SentryEvent | undefined> {
  try {
    return await getLatestEvent(orgSlug, issueId);
  } catch (error) {
    log.debug("Failed to fetch latest event for issue", error);
    return;
  }
}

/**
 * Try to fetch replay IDs related to an issue.
 * Returns an empty array if the fetch fails (non-blocking).
 */
async function tryListReplayIdsForIssue(
  orgSlug: string,
  issueId: string
): Promise<string[]> {
  try {
    return await listReplayIdsForIssue(orgSlug, issueId);
  } catch (error) {
    log.debug("Failed to fetch replay IDs for issue", error);
    return [];
  }
}

/** Per-issue payload both renderers need */
type SingleIssueViewData = {
  org: string | null;
  issue: SentryIssue;
  event: SentryEvent | null;
  replayIds: string[];
  trace: { traceId: string; spans: unknown[] } | null;
  /** Pre-formatted span tree lines for human output (not serialized) */
  spanTreeLines?: string[];
};

/**
 * Output type for issue view — supports both single and multi-issue.
 * Multi-issue output occurs when agents pass several IDs or paste
 * newline-separated IDs (same contract as `event view`).
 */
type IssueViewData = {
  issues: SingleIssueViewData[];
  /** Number of issues originally requested (before partial failures) */
  requestedCount: number;
};

const MAX_REPLAY_IDS_SHOWN = 3;

function formatReplaySection(org: string | null, replayIds: string[]): string {
  if (replayIds.length === 0) {
    return "";
  }

  const visibleReplayIds = replayIds.slice(0, MAX_REPLAY_IDS_SHOWN);
  const lines = ["### Related Replays", ""];

  for (const replayId of visibleReplayIds) {
    if (org) {
      lines.push(
        `- \`${replayId}\` (view: \`sentry replay view ${org}/${replayId}\`)`
      );
    } else {
      lines.push(`- \`${replayId}\``);
    }
  }

  const remainingCount = replayIds.length - visibleReplayIds.length;
  if (remainingCount > 0) {
    lines.push(
      `- ${remainingCount} more related replay${remainingCount === 1 ? "" : "s"}`
    );
  }

  return renderMarkdown(lines.join("\n"));
}

/**
 * Format one issue's view data for human-readable terminal output.
 */
function formatSingleIssueView(data: SingleIssueViewData): string {
  const parts: string[] = [];
  const eventReplayId = data.event
    ? getReplayIdFromEvent(data.event)
    : undefined;

  parts.push(formatIssueDetails(data.issue));

  if (data.event) {
    parts.push(
      formatEventDetails(data.event, "Latest Event", data.issue.permalink)
    );
  }

  const additionalReplayIds = eventReplayId
    ? data.replayIds.filter((replayId) => replayId !== eventReplayId)
    : data.replayIds;
  const replaySection = formatReplaySection(data.org, additionalReplayIds);
  if (replaySection) {
    parts.push(replaySection);
  }

  if (data.spanTreeLines && data.spanTreeLines.length > 0) {
    parts.push(data.spanTreeLines.join("\n"));
  }

  return parts.join("\n");
}

/**
 * Format issue view data for human-readable terminal output.
 *
 * Renders issue details, optional latest event, and optional span tree.
 * Multiple issues are separated by horizontal rules.
 */
export function formatIssueView(data: IssueViewData): string {
  const parts: string[] = [];

  for (const entry of data.issues) {
    if (parts.length > 0) {
      parts.push("\n---\n");
    }
    parts.push(formatSingleIssueView(entry));
  }

  return parts.join("\n");
}

function flattenIssueView(
  entry: SingleIssueViewData,
  fields?: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ...entry.issue,
    event: entry.event,
    org: entry.org,
    replayIds: entry.replayIds,
    trace: entry.trace,
  };
  if (fields && fields.length > 0) {
    return filterFields(result, fields) as Record<string, unknown>;
  }
  return result;
}

/**
 * Transform issue view data for JSON output.
 *
 * For single-issue output, flattens the issue as the primary object so that
 * `--fields shortId,title` works directly on issue properties. The `event`,
 * `trace`, `org`, and `replayIds` enrichment data are attached as sibling
 * keys, accessible via `--fields event.id`, `--fields trace.traceId`, or
 * `--fields replayIds`.
 *
 * For multi-issue output, returns an array of flattened issue objects.
 * This preserves backward compatibility: single-issue callers still get
 * a flat object, while multi-issue callers get an array.
 *
 * Use requestedCount (not issues.length) to decide the shape so that
 * partial failures don't non-deterministically switch from array to object.
 */
export function jsonTransformIssueView(
  data: IssueViewData,
  fields?: string[]
): unknown {
  if (data.requestedCount <= 1) {
    const [first] = data.issues;
    if (first) {
      return flattenIssueView(first, fields);
    }
  }
  return data.issues.map((entry) => flattenIssueView(entry, fields));
}

/**
 * Expand positional args by splitting each on newlines.
 *
 * When an agent pastes `"IOS-1\nIOS-2\nIOS-3"` as a single arg, this
 * produces `["IOS-1", "IOS-2", "IOS-3"]`. Commas are left intact —
 * positional values are space-separated, never comma-split.
 */
export function expandNewlineArgs(args: string[]): string[] {
  return args.flatMap(splitNewlineArg);
}

/**
 * Expand newlines and drop duplicate tokens, preserving first-seen order.
 */
export function collectIssueArgs(args: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const arg of expandNewlineArgs(args)) {
    if (!seen.has(arg)) {
      seen.add(arg);
      result.push(arg);
    }
  }
  return result;
}

/**
 * Resolve one issue and attach latest event, replays, and optional span tree.
 */
async function buildSingleIssueViewData(
  issueArg: string,
  cwd: string,
  spans: number
): Promise<SingleIssueViewData> {
  const { org: orgSlug, issue } = await resolveIssue({
    issueArg,
    cwd,
    command: "view",
  });

  const [event, relatedReplayIds] = orgSlug
    ? await Promise.all([
        tryGetLatestEvent(orgSlug, issue.id),
        tryListReplayIdsForIssue(orgSlug, issue.id),
      ])
    : [undefined, []];
  const replayIds = collectReplayIds([
    event ? getReplayIdFromEvent(event) : undefined,
    ...relatedReplayIds,
  ]);

  let spanTreeResult: Awaited<ReturnType<typeof getSpanTreeLines>> | undefined;
  if (orgSlug && event && spans > 0) {
    spanTreeResult = await getSpanTreeLines(orgSlug, event, spans);
  }

  let spanTreeLines: string[] | undefined;
  if (spanTreeResult) {
    spanTreeLines = spanTreeResult.lines;
  } else if (!orgSlug) {
    const msg = "\nOrganization context required to fetch span tree.";
    spanTreeLines = [isPlainOutput() ? msg : muted(msg)];
  } else if (!event) {
    const msg = "\nCould not fetch event to display span tree.";
    spanTreeLines = [isPlainOutput() ? msg : muted(msg)];
  }

  const trace = spanTreeResult?.success
    ? { traceId: spanTreeResult.traceId, spans: spanTreeResult.spans }
    : null;

  return {
    org: orgSlug ?? null,
    issue,
    event: event ?? null,
    replayIds,
    trace,
    spanTreeLines,
  };
}

/** Options for fetching multiple issues in parallel */
type FetchMultipleIssueViewsOptions = {
  /** Issue identifiers as provided on the command line */
  issueArgs: string[];
  /** Working directory for DSN / project detection */
  cwd: string;
  /** Span tree depth (`0` skips the fetch) */
  spans: number;
};

/**
 * Fetch multiple issues with bounded concurrency, collecting successes
 * and warning on failures.
 *
 * Uses {@link ORG_FANOUT_CONCURRENCY} (5) to avoid overwhelming the API
 * when agents paste dozens of IDs. Mirrors `event view`'s fetchMultipleEvents.
 *
 * When all fetches fail, re-throws the error from the primary (first) issue.
 */
export async function fetchMultipleIssueViews(
  options: FetchMultipleIssueViewsOptions
): Promise<SingleIssueViewData[]> {
  const { issueArgs, cwd, spans } = options;
  const limit = pLimit(ORG_FANOUT_CONCURRENCY);

  const results = await Promise.allSettled(
    issueArgs.map((issueArg) =>
      limit(() => buildSingleIssueViewData(issueArg, cwd, spans))
    )
  );

  const views: SingleIssueViewData[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.status === "fulfilled") {
      views.push(result.value);
    } else if (result?.status === "rejected") {
      log.warn(`Failed to fetch issue ${issueArgs[i]}: ${result.reason}`);
    }
  }

  if (views.length === 0) {
    const firstResult = results[0];
    if (firstResult?.status === "rejected") {
      throw firstResult.reason;
    }
  }

  return views;
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of one or more issues",
    fullDescription:
      "View detailed information about Sentry issues by ID or short ID. " +
      "The latest event is automatically included for full context.\n\n" +
      "Issue formats:\n" +
      "  @latest         - Most recent unresolved issue\n" +
      "  @most_frequent  - Issue with highest event frequency\n" +
      "  <org>/ID        - Explicit org: sentry/EXTENSION-7, sentry/cli-G\n" +
      "  <org>/@selector - Selector with org: my-org/@latest\n" +
      "  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y\n" +
      "  ID              - Short ID: CLI-G (searches across orgs)\n" +
      "  suffix          - Suffix only: G (requires DSN context)\n" +
      "  numeric         - Numeric ID: 123456789\n" +
      "  org/project#ID  - GitHub-style: my-org/my-project#PROJ-123\n\n" +
      "Multiple issue IDs can be passed as separate arguments or newline-separated\n" +
      "within a single argument (handy when piping from other commands).\n\n" +
      "In multi-project mode (after 'issue list'), use alias-suffix format (e.g., 'f-g' " +
      "where 'f' is the project alias shown in the list).",
  },
  output: {
    human: formatIssueView,
    jsonTransform: jsonTransformIssueView,
    schema: IssueViewOutputSchema,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "issue",
        brief: "<issue> [<issue>...] - One or more issue IDs",
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

    const issueArgs = collectIssueArgs(args);
    const [primaryArg] = issueArgs;
    if (primaryArg === undefined) {
      throw new ContextError("Issue ID", USAGE_HINT, []);
    }

    if (flags.web) {
      if (issueArgs.length > 1) {
        log.warn(
          "--web only opens the first issue; extra issue IDs are ignored."
        );
      }
      const { issue } = await resolveIssue({
        issueArg: primaryArg,
        cwd,
        command: "view",
      });
      await openInBrowser(issue.permalink, "issue");
      return;
    }

    const views = await fetchMultipleIssueViews({
      issueArgs,
      cwd,
      spans: flags.spans,
    });

    yield new CommandOutput({
      issues: views,
      requestedCount: issueArgs.length,
    });
    return {
      hint: `Tip: Use 'sentry issue explain ${primaryArg}' for AI root cause analysis`,
    };
  },
});
