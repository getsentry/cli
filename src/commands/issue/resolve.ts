/**
 * sentry issue resolve
 *
 * Mark an issue as resolved, optionally tied to a release, commit, or the
 * next release. Mirrors the "Resolve" dropdown in the Sentry web UI.
 *
 * ## Flow
 *
 * 1. Parse positional issue arg (same formats as `issue view`)
 * 2. Resolve to numeric group ID + org via `resolveIssue`
 * 3. Parse `--in` spec into `statusDetails` (release / commit / next)
 * 4. `updateIssueStatus(issueId, "resolved", { statusDetails, orgSlug })`
 * 5. Emit the updated issue
 */

import type { SentryContext } from "../../context.js";
import {
  parseResolveSpec,
  RESOLVE_NEXT_RELEASE_SENTINEL,
  type ResolveStatusDetails,
  updateIssueStatus,
} from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { formatIssueDetails, muted } from "../../lib/formatters/index.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import type { SentryIssue } from "../../types/index.js";
import { issueIdPositional, resolveIssue } from "./utils.js";

const log = logger.withTag("issue.resolve");

/** Subcommand name passed to resolveIssue for error-hint construction. */
const COMMAND = "resolve";

type ResolveFlags = {
  readonly json: boolean;
  readonly fields?: string[];
  readonly in?: string;
};

/**
 * Wrapped result emitted by the command — carries the `in` spec so the
 * human formatter can surface it ("Resolved in 0.26.1", "Resolved in next
 * release", etc.) without re-parsing.
 */
type ResolveResult = {
  issue: SentryIssue;
  spec: ResolveStatusDetails | null;
};

/** Describe the resolution spec for the human-readable output footer. */
function describeSpec(spec: ResolveStatusDetails | null): string {
  if (!spec) {
    return "immediately";
  }
  if ("inRelease" in spec) {
    return `in release '${spec.inRelease}'`;
  }
  return "in the next release";
}

function formatResolved(result: ResolveResult): string {
  const { issue, spec } = result;
  const head = `${muted("Resolved")} ${describeSpec(spec)}`;
  return `${head}\n\n${formatIssueDetails(issue)}`;
}

function jsonTransform(result: ResolveResult): unknown {
  return { ...result.issue, resolved_in: result.spec ?? undefined };
}

export const resolveCommand = buildCommand({
  docs: {
    brief: "Mark an issue as resolved",
    fullDescription:
      "Resolve an issue, optionally tied to a release.\n\n" +
      "Resolution spec (--in / -i):\n" +
      `  ${RESOLVE_NEXT_RELEASE_SENTINEL}              Resolve in the next release (tied to HEAD)\n` +
      "  <version>          Resolve in this specific release (e.g., 0.26.1)\n" +
      "  (omitted)          Resolve immediately (no regression tracking)\n\n" +
      "Examples:\n" +
      "  sentry issue resolve CLI-12Z\n" +
      "  sentry issue resolve CLI-12Z --in 0.26.1\n" +
      "  sentry issue resolve CLI-196 --in @next\n" +
      "  sentry issue resolve my-org/CLI-AB",
  },
  output: {
    human: formatResolved,
    jsonTransform,
  },
  parameters: {
    positional: issueIdPositional,
    flags: {
      in: {
        kind: "parsed",
        parse: String,
        brief: `Resolve in a release ('<version>' or '${RESOLVE_NEXT_RELEASE_SENTINEL}')`,
        optional: true,
      },
    },
    aliases: {
      i: "in",
    },
  },
  async *func(this: SentryContext, flags: ResolveFlags, issueArg: string) {
    const { cwd } = this;
    const spec = parseResolveSpec(flags.in);

    const { org, issue } = await resolveIssue({
      issueArg,
      cwd,
      command: COMMAND,
    });

    const updated = await updateIssueStatus(issue.id, "resolved", {
      statusDetails: spec ?? undefined,
      orgSlug: org,
    });

    log.debug(`Resolved ${updated.shortId} ${describeSpec(spec)}`);
    yield new CommandOutput<ResolveResult>({ issue: updated, spec });
  },
});
