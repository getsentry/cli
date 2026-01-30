/**
 * sentry issue view
 *
 * View detailed information about a Sentry issue.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getDetailedTrace, getLatestEvent } from "../../lib/api-client.js";
import { openInBrowser } from "../../lib/browser.js";
import {
  formatEventDetails,
  formatIssueDetails,
  formatSimpleSpanTree,
  muted,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import type { SentryEvent, SentryIssue, Writer } from "../../types/index.js";
import {
  buildCommandHint,
  type IssueIdFlags,
  issueIdFlags,
  issueIdPositional,
  resolveIssue,
} from "./utils.js";

interface ViewFlags extends IssueIdFlags {
  readonly json: boolean;
  readonly web: boolean;
  readonly spans?: number;
}

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

type HumanOutputOptions = {
  issue: SentryIssue;
  event?: SentryEvent;
};

/**
 * Write human-readable issue output
 */
function writeHumanOutput(stdout: Writer, options: HumanOutputOptions): void {
  const { issue, event } = options;

  const issueLines = formatIssueDetails(issue);
  stdout.write(`${issueLines.join("\n")}\n`);

  if (event) {
    // Pass issue permalink for constructing replay links
    const eventLines = formatEventDetails(
      event,
      "Latest Event",
      issue.permalink
    );
    stdout.write(`${eventLines.join("\n")}\n`);
  }
}

/**
 * Display the span tree for an event.
 * Shows ONLY the tree structure, no issue/event details.
 *
 * @param stdout - Output writer
 * @param orgSlug - Organization slug
 * @param event - The event to get trace from
 * @param maxDepth - Maximum nesting depth to display
 * @returns true if successfully displayed, false if missing data
 */
async function displaySpanTree(
  stdout: Writer,
  orgSlug: string,
  event: SentryEvent,
  maxDepth: number
): Promise<boolean> {
  const traceId = event.contexts?.trace?.trace_id;
  const dateCreated = (event as { dateCreated?: string }).dateCreated;
  const timestamp = dateCreated
    ? new Date(dateCreated).getTime() / 1000
    : undefined;

  if (!(traceId && timestamp)) {
    stdout.write(muted("No trace data available for this event.\n"));
    return false;
  }

  try {
    const spans = await getDetailedTrace(orgSlug, traceId, timestamp);
    const lines = formatSimpleSpanTree(traceId, spans, maxDepth);
    stdout.write(`${lines.join("\n")}\n`);
    return true;
  } catch {
    stdout.write(muted("Unable to fetch span tree for this event.\n"));
    return false;
  }
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a specific issue",
    fullDescription:
      "View detailed information about a Sentry issue by its ID or short ID. " +
      "The latest event is automatically included for full context.\n\n" +
      "You can use just the unique suffix (e.g., 'G' instead of 'CRAFT-G') when " +
      "project context is available from DSN detection or flags.\n\n" +
      "In multi-project mode (after 'issue list'), use alias-suffix format (e.g., 'f-g' " +
      "where 'f' is the project alias shown in the list).\n\n" +
      "For short IDs, the organization is resolved from:\n" +
      "  1. --org flag\n" +
      "  2. Config defaults\n" +
      "  3. SENTRY_DSN environment variable",
  },
  parameters: {
    positional: issueIdPositional,
    flags: {
      ...issueIdFlags,
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
      spans: {
        kind: "parsed",
        parse: (input: string) => Number(input === "" ? 1 : input),
        brief: "Show span tree with N levels of nesting depth",
        optional: true,
        inferEmpty: true,
      },
    },
    aliases: { w: "web" },
  },
  async func(
    this: SentryContext,
    flags: ViewFlags,
    issueId: string
  ): Promise<void> {
    const { stdout, cwd, setContext } = this;

    // Resolve issue using shared resolution logic
    const { org: orgSlug, issue } = await resolveIssue({
      issueId,
      org: flags.org,
      project: flags.project,
      cwd,
      commandHint: buildCommandHint("view", issueId),
    });

    // Set telemetry context
    setContext(orgSlug, issue.project?.slug);

    if (flags.web) {
      await openInBrowser(stdout, issue.permalink, "issue");
      return;
    }

    // Fetch the latest event for full context (requires org slug)
    const event = orgSlug
      ? await tryGetLatestEvent(orgSlug, issue.id)
      : undefined;

    if (flags.json) {
      const output = event ? { issue, event } : { issue };
      writeJson(stdout, output);
      return;
    }

    writeHumanOutput(stdout, { issue, event });

    if (flags.spans !== undefined && orgSlug && event) {
      const depth = flags.spans > 0 ? flags.spans : Number.MAX_SAFE_INTEGER;
      stdout.write("\n");
      await displaySpanTree(stdout, orgSlug, event, depth);
    } else if (flags.spans !== undefined && !orgSlug) {
      stdout.write(
        muted("\nOrganization context required to fetch span tree.\n")
      );
    } else if (flags.spans !== undefined && !event) {
      stdout.write(muted("\nCould not fetch event to display span tree.\n"));
    }

    writeFooter(
      stdout,
      `Tip: Use 'sentry issue explain ${issue.shortId}' for AI root cause analysis`
    );
  },
});
