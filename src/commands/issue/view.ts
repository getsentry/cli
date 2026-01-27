/**
 * sentry issue view
 *
 * View detailed information about a Sentry issue.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getLatestEvent } from "../../lib/api-client.js";
import { openInBrowser } from "../../lib/browser.js";
import {
  formatEventDetails,
  formatIssueDetails,
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
    return;
  }
}

/**
 * Write human-readable issue output
 */
function writeHumanOutput(
  stdout: Writer,
  issue: SentryIssue,
  event?: SentryEvent
): void {
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
    },
    aliases: { w: "web" },
  },
  async func(
    this: SentryContext,
    flags: ViewFlags,
    issueId: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    // Resolve issue using shared resolution logic
    const { org: orgSlug, issue } = await resolveIssue({
      issueId,
      org: flags.org,
      project: flags.project,
      cwd,
      commandHint: buildCommandHint("view", issueId),
    });

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

    writeHumanOutput(stdout, issue, event);
    writeFooter(
      stdout,
      `Tip: Use 'sentry issue explain ${issue.shortId}' for AI root cause analysis`
    );
  },
});
