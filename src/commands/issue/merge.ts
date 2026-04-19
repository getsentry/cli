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
import { muted, warning } from "../../lib/formatters/index.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import { buildIssueUrl } from "../../lib/sentry-urls.js";
import type { SentryIssue } from "../../types/index.js";
import { resolveIssue } from "./utils.js";

const log = logger.withTag("issue.merge");

const COMMAND = "merge";
/** Full command path for error messages (this one isn't passed to resolveIssue). */
const COMMAND_PATH = "issue merge";

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
  const url = buildIssueUrl(result.org, result.raw.parent);
  return `${head}\n${children}\n\nSee: ${url}`;
}

function jsonTransform(result: MergeCommandResult): unknown {
  return {
    org: result.org,
    parent: {
      shortId: result.parentShortId,
      id: result.raw.parent,
      url: buildIssueUrl(result.org, result.raw.parent),
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
      })
    )
  );

  // Every resolved issue must have a concrete org slug — otherwise we
  // can't safely decide whether a merge is cross-org. A bare numeric ID
  // that couldn't pick up an org from DSN/env/config would return
  // `org: undefined`; those must error before we proceed.
  const missingOrg = resolved.filter((r) => !r.org);
  if (missingOrg.length > 0) {
    const badIds = missingOrg.map((r) => r.issue.shortId).join(", ");
    throw new ValidationError(
      `Could not determine the organization for: ${badIds}.\n\n` +
        "Provide the org explicitly (e.g. <org>/<issue>) so the merge\n" +
        "can verify all issues belong to the same organization."
    );
  }

  // Collect the fully-resolved orgs and require a single one.
  const orgs = new Set(resolved.map((r) => r.org as string));
  if (orgs.size > 1) {
    throw new ValidationError(
      `Cannot merge issues across organizations (${Array.from(orgs).join(", ")}).\n\n` +
        "All issues must belong to the same organization."
    );
  }

  const [org] = orgs;
  if (!org) {
    // Unreachable — resolved.length >= 1 (callers guard for <2) and we
    // just asserted every entry has a non-empty org.
    throw new CliError("Internal error: resolved issue missing org slug.");
  }
  return { org, issues: resolved.map((r) => r.issue) };
}

/**
 * Sort issues so that the one matching `into` is first. Sentry's merge
 * endpoint picks the parent by size; pre-sorting nudges the tie-break
 * toward the caller's preference for typical cases.
 *
 * Accepts the same formats as the positional args — bare short ID,
 * numeric group ID, org-qualified short ID, or project-alias suffix
 * (`f-g`, `fr-a3`, etc). Aliases are resolved by running the input
 * through `resolveIssue` and comparing the resulting numeric ID against
 * the already-resolved issues.
 *
 * Fast path: try a direct string match first (avoids an API call when
 * the user passes the canonical form). Fall back to `resolveIssue` only
 * when the direct match misses, then look up by numeric ID.
 *
 * When `into` doesn't match any issue in the list, that's a user error —
 * we throw so the user can correct the mistake instead of silently getting
 * a different parent.
 */
async function orderForMerge(
  issues: SentryIssue[],
  into: string | undefined,
  cwd: string
): Promise<SentryIssue[]> {
  if (!into) {
    return issues;
  }
  const normalized = into.trim();
  // Fast path: direct match on shortId / id (bare or org-qualified form).
  // The Sentry API's `shortId` field is always the bare short ID.
  const lastSlash = normalized.lastIndexOf("/");
  const bare = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const direct = issues.find(
    (i) =>
      i.shortId === bare ||
      i.id === bare ||
      i.shortId === normalized ||
      i.id === normalized
  );
  if (direct) {
    return [direct, ...issues.filter((i) => i !== direct)];
  }

  // Fallback: resolve `into` through the same pipeline as positional args
  // (handles project-alias suffixes like `f-g`, URLs, @selectors, etc).
  // This adds a second API round trip in the alias-only case, but avoids
  // reimplementing the alias lookup logic here.
  let resolvedId: string | undefined;
  try {
    const { issue: resolvedIssue } = await resolveIssue({
      issueArg: normalized,
      cwd,
      command: "merge",
    });
    resolvedId = resolvedIssue.id;
  } catch {
    // Resolution failed — fall through to the not-found error below.
  }

  if (resolvedId) {
    const match = issues.find((i) => i.id === resolvedId);
    if (match) {
      return [match, ...issues.filter((i) => i !== match)];
    }
  }

  throw new ValidationError(
    `--into '${into}' did not match any of the provided issues.\n\n` +
      `Provided: ${issues.map((i) => i.shortId).join(", ")}`,
    "into"
  );
}

export const mergeCommand = buildCommand({
  docs: {
    brief: "Merge 2+ issues into a single canonical group",
    fullDescription:
      "Consolidate multiple issues into one. Useful when the same logical\n" +
      "error was split into separate groups (e.g. by Sentry's default\n" +
      "stack-trace grouping before fingerprint rules were applied).\n\n" +
      "Sentry picks the canonical parent based on event count — typically\n" +
      "the largest group. --into is a preference, not a guarantee: if your\n" +
      "choice has fewer events, Sentry may still pick a different parent,\n" +
      "in which case a warning is printed to stderr.\n\n" +
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
          "Prefer this issue as the canonical parent (must match one of the provided IDs)",
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
        `'sentry ${COMMAND_PATH}' needs at least 2 issue IDs (got ${args.length}).\n\n` +
          "Example: sentry issue merge CLI-K9 CLI-15H CLI-15N"
      );
    }

    const { org, issues } = await resolveAllIssues(args, cwd);
    const ordered = await orderForMerge(issues, flags.into, cwd);
    const groupIds = ordered.map((i) => i.id);
    // `--into` is a preference, not a guarantee — track it so we can warn
    // if Sentry picks a different parent (typically the largest by event
    // count takes precedence over the requested ordering).
    const requestedParentId = flags.into ? groupIds[0] : undefined;

    log.debug(
      `Merging ${groupIds.length} issues in ${org}: ${ordered.map((i) => i.shortId).join(", ")}`
    );

    const raw = await mergeIssues(org, groupIds);

    // Map numeric IDs back to short IDs for display.
    const idToShort = new Map(ordered.map((i) => [i.id, i.shortId]));
    const parentShortId = idToShort.get(raw.parent) ?? raw.parent;
    const childShortIds = raw.children.map((id) => idToShort.get(id) ?? id);

    if (requestedParentId && requestedParentId !== raw.parent) {
      const requestedShortId = idToShort.get(requestedParentId) ?? flags.into;
      this.stderr.write(
        `${warning("Warning:")} --into '${requestedShortId}' was a preference, not a guarantee. ` +
          `Sentry selected ${parentShortId} as the canonical parent based on event count.\n`
      );
    }

    yield new CommandOutput<MergeCommandResult>({
      org,
      parentShortId,
      childShortIds,
      raw,
    });
  },
});
