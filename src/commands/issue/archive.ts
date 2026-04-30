/**
 * sentry issue archive (aliased: ignore)
 *
 * Archive (ignore) an issue, suppressing alerts until an optional
 * condition is met. This maps to the "ignored" status in the Sentry API.
 */

import type { SentryContext } from "../../context.js";
import {
  type IgnoreStatusDetails,
  updateIssueStatus,
} from "../../lib/api-client.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { formatIssueDetails, muted } from "../../lib/formatters/index.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import type { SentryIssue } from "../../types/index.js";
import { issueIdPositional, resolveIssue } from "./utils.js";

const log = logger.withTag("issue.archive");

const COMMAND = "archive";

type ArchiveFlags = {
  readonly json: boolean;
  readonly fields?: string[];
  readonly duration?: number;
  readonly count?: number;
  readonly window?: number;
  readonly users?: number;
  readonly "user-window"?: number;
};

function formatArchived(issue: SentryIssue): string {
  return `${muted("Archived")}\n\n${formatIssueDetails(issue)}`;
}

export const archiveCommand = buildCommand({
  docs: {
    brief: "Archive (ignore) an issue",
    fullDescription:
      "Archive an issue, suppressing alerts until an optional condition is met.\n" +
      "Without any duration/count flags, the issue is archived indefinitely.\n\n" +
      "Examples:\n" +
      "  sentry issue archive CLI-12Z\n" +
      "  sentry issue archive CLI-12Z --duration 60\n" +
      "  sentry issue archive CLI-12Z --count 100 --window 60\n" +
      "  sentry issue archive CLI-12Z --users 10",
  },
  output: {
    human: formatArchived,
  },
  parameters: {
    positional: issueIdPositional,
    flags: {
      duration: {
        kind: "parsed",
        parse: numberParser,
        brief: "Ignore for this many minutes",
        optional: true,
      },
      count: {
        kind: "parsed",
        parse: numberParser,
        brief: "Ignore until this many more events occur",
        optional: true,
      },
      window: {
        kind: "parsed",
        parse: numberParser,
        brief:
          "Time window in minutes for --count (events must occur within this window)",
        optional: true,
      },
      users: {
        kind: "parsed",
        parse: numberParser,
        brief: "Ignore until this many more users are affected",
        optional: true,
      },
      "user-window": {
        kind: "parsed",
        parse: numberParser,
        brief:
          "Time window in minutes for --users (users must be affected within this window)",
        optional: true,
      },
    },
  },
  async *func(this: SentryContext, flags: ArchiveFlags, issueArg: string) {
    const { cwd } = this;

    const { org, issue } = await resolveIssue({
      issueArg,
      cwd,
      command: COMMAND,
    });

    const statusDetails: IgnoreStatusDetails = {};
    if (flags.duration !== undefined) {
      statusDetails.ignoreDuration = flags.duration;
    }
    if (flags.count !== undefined) {
      statusDetails.ignoreCount = flags.count;
    }
    if (flags.window !== undefined) {
      statusDetails.ignoreWindow = flags.window;
    }
    if (flags.users !== undefined) {
      statusDetails.ignoreUserCount = flags.users;
    }
    if (flags["user-window"] !== undefined) {
      statusDetails.ignoreUserWindow = flags["user-window"];
    }

    const hasDetails = Object.keys(statusDetails).length > 0;

    const updated = await updateIssueStatus(issue.id, "ignored", {
      ...(hasDetails ? { statusDetails } : {}),
      orgSlug: org,
    });

    log.debug(`Archived ${updated.shortId}`);
    yield new CommandOutput<SentryIssue>(updated);
  },
});
