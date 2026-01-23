/**
 * sentry issue get
 *
 * Get detailed information about a Sentry issue.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import {
  getIssue,
  getIssueByShortId,
  getLatestEvent,
} from "../../lib/api-client.js";
import { getProjectByAlias } from "../../lib/config.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatEventDetails,
  formatIssueDetails,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  expandToFullShortId,
  isShortId,
  isShortSuffix,
  parseAliasSuffix,
} from "../../lib/issue-id.js";
import { resolveOrg, resolveOrgAndProject } from "../../lib/resolve-target.js";
import type { SentryEvent, SentryIssue, Writer } from "../../types/index.js";

type GetFlags = {
  readonly org?: string;
  readonly project?: string;
  readonly json: boolean;
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

export const getCommand = buildCommand({
  docs: {
    brief: "Get details of a specific issue",
    fullDescription:
      "Retrieve detailed information about a Sentry issue by its ID or short ID. " +
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
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief:
            "Issue ID, short ID, suffix, or alias-suffix (e.g., 123456, CRAFT-G, G, or f-g)",
          parse: String,
        },
      ],
    },
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief:
          "Organization slug (required for short IDs if not auto-detected)",
        optional: true,
      },
      project: {
        kind: "parsed",
        parse: String,
        brief:
          "Project slug (required for short suffixes if not auto-detected)",
        optional: true,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(
    this: SentryContext,
    flags: GetFlags,
    issueId: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    let issue: SentryIssue;
    let orgSlug: string | undefined;
    let resolvedShortId = issueId;

    // Check if input matches alias-suffix pattern (e.g., "f-g", "fr-a3")
    // and if the alias exists in the cache
    const aliasSuffix = parseAliasSuffix(issueId);
    const projectEntry = aliasSuffix
      ? await getProjectByAlias(aliasSuffix.alias)
      : null;

    if (aliasSuffix && projectEntry) {
      // Valid alias found - expand suffix using the aliased project
      resolvedShortId = expandToFullShortId(
        aliasSuffix.suffix,
        projectEntry.projectSlug
      );
      orgSlug = projectEntry.orgSlug;
      issue = await getIssueByShortId(orgSlug, resolvedShortId);
    } else if (isShortSuffix(issueId)) {
      // Short suffix - try to expand if project context is available
      const target = await resolveOrgAndProject({
        org: flags.org,
        project: flags.project,
        cwd,
      });

      if (target) {
        // Expand suffix to full short ID (e.g., "12" → "CRAFT-12")
        resolvedShortId = expandToFullShortId(issueId, target.project);
        orgSlug = target.org;
        issue = await getIssueByShortId(orgSlug, resolvedShortId);
      } else {
        // No project context - treat as numeric ID (will fail if not numeric)
        issue = await getIssue(issueId);
      }
    } else if (isShortId(issueId)) {
      // Full short ID (e.g., "CRAFT-G") - normalize to uppercase
      resolvedShortId = issueId.toUpperCase();
      const resolved = await resolveOrg({ org: flags.org, cwd });
      if (!resolved) {
        throw new ContextError(
          "Organization",
          `sentry issue get ${issueId} --org <org-slug>`
        );
      }
      orgSlug = resolved.org;
      issue = await getIssueByShortId(orgSlug, resolvedShortId);
    } else {
      // Numeric ID can be fetched directly
      issue = await getIssue(issueId);
      // Try to resolve org for event fetching
      const resolved = await resolveOrg({ org: flags.org, cwd });
      orgSlug = resolved?.org;
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
  },
});
