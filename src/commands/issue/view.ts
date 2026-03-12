/**
 * sentry issue view
 *
 * View detailed information about a Sentry issue.
 */

import type { SentryContext } from "../../context.js";
import { getLatestEvent } from "../../lib/api-client.js";
import { spansFlag } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import {
  formatEventDetails,
  formatIssueDetails,
  muted,
} from "../../lib/formatters/index.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { getSpanTreeLines } from "../../lib/span-tree.js";
import type { SentryEvent, SentryIssue } from "../../types/index.js";
import { issueIdPositional, resolveIssue } from "./utils.js";

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
  } catch {
    // Non-blocking: event fetch failures shouldn't prevent issue display
    return;
  }
}

/** Return type for issue view — includes all data both renderers need */
type IssueViewData = {
  issue: SentryIssue;
  event: SentryEvent | null;
  trace: { traceId: string; spans: unknown[] } | null;
  /** Pre-formatted span tree lines for human output (not serialized) */
  spanTreeLines?: string[];
};

/**
 * Format issue view data for human-readable terminal output.
 *
 * Renders issue details, optional latest event, and optional span tree.
 */
function formatIssueView(data: IssueViewData): string {
  const parts: string[] = [];

  parts.push(formatIssueDetails(data.issue));

  if (data.event) {
    parts.push(
      formatEventDetails(data.event, "Latest Event", data.issue.permalink)
    );
  }

  if (data.spanTreeLines && data.spanTreeLines.length > 0) {
    parts.push(data.spanTreeLines.join("\n"));
  }

  return parts.join("\n");
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a specific issue",
    fullDescription:
      "View detailed information about a Sentry issue by its ID or short ID. " +
      "The latest event is automatically included for full context.\n\n" +
      "Issue formats:\n" +
      "  @latest         - Most recent unresolved issue\n" +
      "  @most_frequent  - Issue with highest event frequency\n" +
      "  <org>/ID        - Explicit org: sentry/EXTENSION-7, sentry/cli-G\n" +
      "  <org>/@selector - Selector with org: my-org/@latest\n" +
      "  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y\n" +
      "  ID              - Short ID: CLI-G (searches across orgs)\n" +
      "  suffix          - Suffix only: G (requires DSN context)\n" +
      "  numeric         - Numeric ID: 123456789\n\n" +
      "In multi-project mode (after 'issue list'), use alias-suffix format (e.g., 'f-g' " +
      "where 'f' is the project alias shown in the list).",
  },
  output: {
    json: true,
    human: formatIssueView,
    jsonExclude: ["spanTreeLines"],
  },
  parameters: {
    positional: issueIdPositional,
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
  async *func(this: SentryContext, flags: ViewFlags, issueArg: string) {
    applyFreshFlag(flags);
    const { cwd, setContext } = this;

    // Resolve issue using shared resolution logic
    const { org: orgSlug, issue } = await resolveIssue({
      issueArg,
      cwd,
      command: "view",
    });

    // Set telemetry context
    setContext(
      orgSlug ? [orgSlug] : [],
      issue.project?.slug ? [issue.project.slug] : []
    );

    if (flags.web) {
      await openInBrowser(issue.permalink, "issue");
      return;
    }

    // Fetch the latest event for full context (requires org slug)
    const event = orgSlug
      ? await tryGetLatestEvent(orgSlug, issue.id)
      : undefined;

    // Fetch span tree data (for both JSON and human output)
    // Skip when spans=0 (disabled via --spans no or --spans 0)
    let spanTreeResult:
      | Awaited<ReturnType<typeof getSpanTreeLines>>
      | undefined;
    if (orgSlug && event && flags.spans > 0) {
      spanTreeResult = await getSpanTreeLines(orgSlug, event, flags.spans);
    }

    // Prepare span tree lines for human output
    let spanTreeLines: string[] | undefined;
    if (spanTreeResult) {
      spanTreeLines = spanTreeResult.lines;
    } else if (!orgSlug) {
      spanTreeLines = [
        muted("\nOrganization context required to fetch span tree."),
      ];
    } else if (!event) {
      spanTreeLines = [muted("\nCould not fetch event to display span tree.")];
    }

    const trace = spanTreeResult?.success
      ? { traceId: spanTreeResult.traceId, spans: spanTreeResult.spans }
      : null;

    yield {
      data: { issue, event: event ?? null, trace, spanTreeLines },
      hint: `Tip: Use 'sentry issue explain ${issueArg}' for AI root cause analysis`,
    };
    return;
  },
});
