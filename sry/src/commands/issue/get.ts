/**
 * sry issue get
 *
 * Get detailed information about a Sentry issue.
 */

import { buildCommand } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { getIssue, getLatestEvent } from "../../lib/api-client.js";
import {
  formatEventDetails,
  formatIssueDetails,
} from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import type { SentryEvent, SentryIssue } from "../../types/index.js";

type GetFlags = {
  readonly json: boolean;
  readonly event: boolean;
};

/**
 * Try to fetch the latest event for an issue
 */
async function tryGetLatestEvent(
  issueId: string
): Promise<SentryEvent | undefined> {
  try {
    return await getLatestEvent(issueId);
  } catch {
    // Event fetch might fail, continue without it
    return;
  }
}

/**
 * Write human-readable issue output
 */
function writeHumanOutput(
  stdout: NodeJS.WriteStream,
  issue: SentryIssue,
  event?: SentryEvent
): void {
  const issueLines = formatIssueDetails(issue);
  stdout.write(`${issueLines.join("\n")}\n`);

  if (event) {
    const eventLines = formatEventDetails(event);
    stdout.write(`${eventLines.join("\n")}\n`);
  }
}

export const getCommand = buildCommand({
  docs: {
    brief: "Get details of a specific issue",
    fullDescription:
      "Retrieve detailed information about a Sentry issue by its ID or short ID. " +
      "Use --event to also fetch the latest event details.",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Issue ID or short ID (e.g., JAVASCRIPT-ABC or 123456)",
          parse: String,
        },
      ],
    },
    flags: {
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      event: {
        kind: "boolean",
        brief: "Also fetch the latest event",
        default: false,
      },
    },
  },
  async func(
    this: SryContext,
    flags: GetFlags,
    issueId: string
  ): Promise<void> {
    const { process } = this;
    const { stdout, stderr } = process;

    try {
      const issue = await getIssue(issueId);

      const event = flags.event ? await tryGetLatestEvent(issueId) : undefined;

      if (flags.json) {
        const output = event ? { issue, event } : { issue };
        writeJson(stdout, output);
        return;
      }

      writeHumanOutput(stdout, issue, event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Error fetching issue: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
