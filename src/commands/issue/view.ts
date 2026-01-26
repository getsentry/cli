/**
 * sentry issue view
 *
 * View detailed information about a Sentry issue.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import {
  getIssue,
  getIssueByShortId,
  getLatestEvent,
} from "../../lib/api-client.js";
import { openInBrowser } from "../../lib/browser.js";
import { getProjectByAlias } from "../../lib/config.js";
import { createDsnFingerprint, detectAllDsns } from "../../lib/dsn/index.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatEventDetails,
  formatIssueDetails,
  writeFooter,
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

type ViewFlags = {
  readonly org?: string;
  readonly project?: string;
  readonly json: boolean;
  readonly web: boolean;
};

/** Result of resolving an issue ID */
type ResolvedIssue = {
  issue: SentryIssue;
  orgSlug?: string;
};

/**
 * Resolve an alias-suffix format issue ID (e.g., "f-g").
 * Returns null if the alias is not found in cache or fingerprint doesn't match.
 *
 * @param alias - The project alias from the alias-suffix format
 * @param suffix - The issue suffix
 * @param cwd - Current working directory for DSN detection
 */
async function resolveAliasSuffixId(
  alias: string,
  suffix: string,
  cwd: string
): Promise<ResolvedIssue | null> {
  // Detect DSNs to create fingerprint for validation
  const detection = await detectAllDsns(cwd);
  const fingerprint = createDsnFingerprint(detection.all);
  const projectEntry = await getProjectByAlias(alias, fingerprint);
  if (!projectEntry) {
    return null;
  }

  const resolvedShortId = expandToFullShortId(suffix, projectEntry.projectSlug);
  const issue = await getIssueByShortId(projectEntry.orgSlug, resolvedShortId);
  return { issue, orgSlug: projectEntry.orgSlug };
}

/**
 * Resolve a short suffix format issue ID (e.g., "G", "12").
 * Requires project context from flags or DSN detection.
 */
async function resolveShortSuffixId(
  issueId: string,
  flags: ViewFlags,
  cwd: string
): Promise<ResolvedIssue> {
  const target = await resolveOrgAndProject({
    org: flags.org,
    project: flags.project,
    cwd,
  });

  if (target) {
    const resolvedShortId = expandToFullShortId(issueId, target.project);
    const issue = await getIssueByShortId(target.org, resolvedShortId);
    return { issue, orgSlug: target.org };
  }

  // No project context - treat as numeric ID
  const issue = await getIssue(issueId);
  return { issue };
}

/**
 * Resolve a full short ID format (e.g., "CRAFT-G").
 * Requires organization context.
 */
async function resolveFullShortId(
  issueId: string,
  flags: ViewFlags,
  cwd: string
): Promise<ResolvedIssue> {
  const resolved = await resolveOrg({ org: flags.org, cwd });
  if (!resolved) {
    throw new ContextError(
      "Organization",
      `sentry issue view ${issueId} --org <org-slug>`
    );
  }

  const normalizedId = issueId.toUpperCase();
  const issue = await getIssueByShortId(resolved.org, normalizedId);
  return { issue, orgSlug: resolved.org };
}

/**
 * Resolve a numeric issue ID.
 * Optionally resolves org for event fetching.
 */
async function resolveNumericId(
  issueId: string,
  flags: ViewFlags,
  cwd: string
): Promise<ResolvedIssue> {
  const issue = await getIssue(issueId);
  const resolved = await resolveOrg({ org: flags.org, cwd });
  return { issue, orgSlug: resolved?.org };
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

    // Resolve issue based on ID format
    let resolved: ResolvedIssue;
    const aliasSuffix = parseAliasSuffix(issueId);

    if (aliasSuffix) {
      const aliasResult = await resolveAliasSuffixId(
        aliasSuffix.alias,
        aliasSuffix.suffix,
        cwd
      );
      resolved =
        aliasResult ?? (await resolveShortSuffixId(issueId, flags, cwd));
    } else if (isShortSuffix(issueId)) {
      resolved = await resolveShortSuffixId(issueId, flags, cwd);
    } else if (isShortId(issueId)) {
      resolved = await resolveFullShortId(issueId, flags, cwd);
    } else {
      resolved = await resolveNumericId(issueId, flags, cwd);
    }

    const { issue, orgSlug } = resolved;

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
