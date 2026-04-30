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
import { ValidationError } from "../../lib/errors.js";
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
  readonly "until-escalating"?: boolean;
  readonly duration?: number;
  readonly count?: number;
  readonly window?: number;
  readonly users?: number;
  readonly "user-window"?: number;
};

function formatArchived(issue: SentryIssue): string {
  return `${muted("Archived")}\n\n${formatIssueDetails(issue)}`;
}

/** Validate flag dependencies and compute substatus + statusDetails. */
function resolveArchiveOptions(flags: ArchiveFlags): {
  substatus: string;
  statusDetails?: IgnoreStatusDetails;
} {
  if (flags.window !== undefined && flags.count === undefined) {
    throw new ValidationError(
      "--window requires --count (time window is only meaningful with an event count threshold)"
    );
  }
  if (flags["user-window"] !== undefined && flags.users === undefined) {
    throw new ValidationError(
      "--user-window requires --users (time window is only meaningful with a user count threshold)"
    );
  }

  const hasConditionFlags =
    flags.duration !== undefined ||
    flags.count !== undefined ||
    flags.users !== undefined;

  if (flags["until-escalating"] && hasConditionFlags) {
    throw new ValidationError(
      "--until-escalating cannot be combined with --duration, --count, or --users"
    );
  }

  if (flags["until-escalating"]) {
    return { substatus: "archived_until_escalating" };
  }
  if (!hasConditionFlags) {
    return { substatus: "archived_forever" };
  }

  const details: IgnoreStatusDetails = {};
  if (flags.duration !== undefined) {
    details.ignoreDuration = flags.duration;
  }
  if (flags.count !== undefined) {
    details.ignoreCount = flags.count;
  }
  if (flags.window !== undefined) {
    details.ignoreWindow = flags.window;
  }
  if (flags.users !== undefined) {
    details.ignoreUserCount = flags.users;
  }
  if (flags["user-window"] !== undefined) {
    details.ignoreUserWindow = flags["user-window"];
  }
  return { substatus: "archived_until_condition_met", statusDetails: details };
}

export const archiveCommand = buildCommand({
  docs: {
    brief: "Archive (ignore) an issue",
    fullDescription:
      "Archive an issue, suppressing alerts until an optional condition is met.\n\n" +
      "Archive modes:\n" +
      "  (no flags)           Archive forever\n" +
      "  --until-escalating   Archive until a spike in event frequency\n" +
      "  --duration <mins>    Archive for a fixed time period\n" +
      "  --count/--users      Archive until a threshold is reached\n\n" +
      "Examples:\n" +
      "  sentry issue archive CLI-12Z\n" +
      "  sentry issue archive CLI-12Z --until-escalating\n" +
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
      "until-escalating": {
        kind: "boolean",
        brief: "Archive until the issue escalates (spikes in frequency)",
        optional: true,
        default: false,
      },
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
    const { substatus, statusDetails } = resolveArchiveOptions(flags);

    const { org, issue } = await resolveIssue({
      issueArg,
      cwd: this.cwd,
      command: COMMAND,
    });

    const updated = await updateIssueStatus(issue.id, "ignored", {
      ...(statusDetails ? { statusDetails } : {}),
      substatus,
      orgSlug: org,
    });

    log.debug(`Archived ${updated.shortId}`);
    yield new CommandOutput<SentryIssue>(updated);
  },
});
