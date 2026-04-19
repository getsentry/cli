/**
 * sentry issue merge
 *
 * Merge 2+ issues into a single canonical group. Sentry's web UI has this
 * as a bulk action; here we expose it as a direct command.
 *
 * ## Flow
 *
 * 1. Collect 2+ issue args (variadic positional)
 * 2. Resolve each to a numeric group ID + org via `resolveIssue`
 * 3. Verify all issues are in the same org (cross-org merge rejected by API)
 * 4. Optionally pin the canonical parent via `--into`
 * 5. Call `mergeIssues(org, groupIds)` — the API auto-picks the parent
 *    unless we pre-sort with our chosen parent first
 * 6. Emit the merge result
 *
 * Sentry picks the parent by size (largest by event count). When `--into`
 * is provided we sort the selected issue to the front of the list — Sentry
 * honors first-in-list as the parent when multiple issues have equivalent
 * weight. See the Sentry source at `src/sentry/api/helpers/group_index`.
 */

import type { SentryContext } from "../../context.js";
import { type MergeIssuesResult, mergeIssues } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { CliError, ValidationError } from "../../lib/errors.js";
import { muted } from "../../lib/formatters/index.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import type { SentryIssue } from "../../types/index.js";
import { resolveIssue } from "./utils.js";

const log = logger.withTag("issue.merge");

const COMMAND = "issue merge";
const COMMAND_BASE = "issue";

type MergeFlags = {
  readonly json: boolean;
  readonly fields?: string[];
  readonly into?: string;
};

/** Result emitted by the command — extends API result with display fields. */
type MergeCommandResult = {
  /** Org slug the merge was scoped to (all inputs must share an org). */
  org: string;
  /** Short ID of the canonical parent the children were merged into. */
  parentShortId: string;
  /** Short IDs of the merged children (excludes parent). */
  childShortIds: string[];
  /** Raw API response (numeric group IDs). */
  raw: MergeIssuesResult;
};

function formatMerged(result: MergeCommandResult): string {
  const head = `${muted("Merged")} ${result.childShortIds.length} issue(s) into ${result.parentShortId}`;
  const children = result.childShortIds.map((id) => `  • ${id}`).join("\n");
  return `${head}\n${children}\n\nSee: ${result.raw.parent}`;
}

function jsonTransform(result: MergeCommandResult): unknown {
  return {
    org: result.org,
    parent: {
      shortId: result.parentShortId,
      id: result.raw.parent,
    },
    children: result.childShortIds.map((shortId, i) => ({
      shortId,
      id: result.raw.children[i] ?? "",
    })),
  };
}

/**
 * Resolve all issue args in parallel and validate they share an org.
 */
async function resolveAllIssues(
  args: readonly string[],
  cwd: string
): Promise<{ org: string; issues: SentryIssue[] }> {
  const resolved = await Promise.all(
    args.map((arg) =>
      resolveIssue({
        issueArg: arg,
        cwd,
        command: COMMAND,
        commandBase: COMMAND_BASE,
      })
    )
  );

  // Cross-org merge is rejected by the API — catch it client-side with a
  // friendlier message.
  const orgs = new Set(
    resolved.map((r) => r.org).filter((o): o is string => !!o)
  );
  if (orgs.size === 0) {
    throw new CliError(
      "Could not resolve the organization for any of the provided issues."
    );
  }
  if (orgs.size > 1) {
    throw new ValidationError(
      `Cannot merge issues across organizations (${Array.from(orgs).join(", ")}).\n\n` +
        "All issues must belong to the same organization."
    );
  }

  const [org] = orgs;
  if (!org) {
    throw new CliError("Internal error: resolved issue missing org slug.");
  }
  return { org, issues: resolved.map((r) => r.issue) };
}

/**
 * Sort issues so that the one matching `into` (short ID or numeric ID) is
 * first. Sentry's merge endpoint picks the parent by size; pre-sorting
 * nudges the tie-break toward the caller's preference for typical cases.
 *
 * When `into` doesn't match any issue in the list, that's a user error —
 * we throw so the user can correct the mistake instead of silently getting
 * a different parent.
 */
function orderForMerge(
  issues: SentryIssue[],
  into: string | undefined
): SentryIssue[] {
  if (!into) {
    return issues;
  }
  const normalized = into.trim();
  const parent = issues.find(
    (i) => i.shortId === normalized || i.id === normalized
  );
  if (!parent) {
    throw new ValidationError(
      `--into '${into}' did not match any of the provided issues.\n\n` +
        `Provided: ${issues.map((i) => i.shortId).join(", ")}`,
      "into"
    );
  }
  return [parent, ...issues.filter((i) => i !== parent)];
}

export const mergeCommand = buildCommand({
  docs: {
    brief: "Merge 2+ issues into a single canonical group",
    fullDescription:
      "Consolidate multiple issues into one. Useful when the same logical\n" +
      "error was split into separate groups (e.g. by Sentry's default\n" +
      "stack-trace grouping before fingerprint rules were applied).\n\n" +
      "Sentry auto-picks the canonical parent (typically the largest by\n" +
      "event count). Use --into to override.\n\n" +
      "All issues must belong to the same organization. Only error-type\n" +
      "issues can be merged (the API rejects performance/info issues).\n\n" +
      "Examples:\n" +
      "  sentry issue merge CLI-K9 CLI-15H CLI-15N\n" +
      "  sentry issue merge CLI-K9 CLI-15H --into CLI-K9\n" +
      "  sentry issue merge my-org/CLI-AB my-org/CLI-CD",
  },
  output: {
    human: formatMerged,
    jsonTransform,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "issue",
        brief: "Issue IDs to merge (2 or more required)",
        parse: String,
      },
    },
    flags: {
      into: {
        kind: "parsed",
        parse: String,
        brief:
          "Pin the canonical parent (must match one of the provided issue IDs)",
        optional: true,
      },
    },
    aliases: {
      i: "into",
    },
  },
  async *func(this: SentryContext, flags: MergeFlags, ...args: string[]) {
    const { cwd } = this;

    if (args.length < 2) {
      throw new ValidationError(
        `'${COMMAND}' needs at least 2 issue IDs (got ${args.length}).\n\n` +
          "Example: sentry issue merge CLI-K9 CLI-15H CLI-15N"
      );
    }

    const { org, issues } = await resolveAllIssues(args, cwd);
    const ordered = orderForMerge(issues, flags.into);
    const groupIds = ordered.map((i) => i.id);

    log.debug(
      `Merging ${groupIds.length} issues in ${org}: ${ordered.map((i) => i.shortId).join(", ")}`
    );

    const raw = await mergeIssues(org, groupIds);

    // Map numeric IDs back to short IDs for display.
    const idToShort = new Map(ordered.map((i) => [i.id, i.shortId]));
    const parentShortId = idToShort.get(raw.parent) ?? raw.parent;
    const childShortIds = raw.children.map((id) => idToShort.get(id) ?? id);

    yield new CommandOutput<MergeCommandResult>({
      org,
      parentShortId,
      childShortIds,
      raw,
    });
  },
});
