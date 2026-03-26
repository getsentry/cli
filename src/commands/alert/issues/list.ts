/**
 * sentry alert issues list
 *
 * List issue alert rules for one or more Sentry projects.
 *
 * Supports the same target resolution as `sentry issue list`:
 * - auto-detect  → DSN detection / config defaults (may resolve multiple projects)
 * - explicit     → single org/project
 * - org-all      → all projects in an org (trailing slash required)
 * - project-search → find project by slug across all orgs
 */

import type { SentryContext } from "../../../context.js";
import type { IssueAlertRule } from "../../../lib/api/alerts.js";
import { MAX_PAGINATION_PAGES } from "../../../lib/api/infrastructure.js";
import {
  API_MAX_PER_PAGE,
  listIssueAlertsPaginated,
} from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { openInBrowser } from "../../../lib/browser.js";
import {
  advancePaginationState,
  buildMultiTargetContextKey,
  buildPaginationContextKey,
  decodeCompoundCursor,
  encodeCompoundCursor,
  hasPreviousPage,
  resolveCursor,
} from "../../../lib/db/pagination.js";
import { ApiError, ContextError } from "../../../lib/errors.js";
import { filterFields } from "../../../lib/formatters/json.js";
import {
  colorTag,
  escapeMarkdownCell,
} from "../../../lib/formatters/markdown.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { type Column, writeTable } from "../../../lib/formatters/table.js";
import {
  buildListCommand,
  buildListLimitFlag,
  paginationHint,
  targetPatternExplanation,
} from "../../../lib/list-command.js";
import { logger } from "../../../lib/logger.js";
import { withProgress } from "../../../lib/polling.js";
import {
  type ResolvedTarget,
  resolveTargetsFromParsedArg,
} from "../../../lib/resolve-target.js";
import { buildIssueAlertsUrl } from "../../../lib/sentry-urls.js";
import type { Writer } from "../../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "alert-issues-list";

const USAGE_HINT = "sentry alert issues list <org>/<project>";

type ListFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly json: boolean;
  readonly fields?: string[];
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

type AlertRuleWithTarget = {
  rule: IssueAlertRule;
  target: ResolvedTarget;
};

type IssueAlertListResult = {
  rulesWithTargets: AlertRuleWithTarget[];
  isMultiProject: boolean;
  hasMore: boolean;
  hasPrev?: boolean;
  nextCursor?: string;
  /** Used only in single-target mode for hint/URL */
  singleTarget?: ResolvedTarget;
  footer?: string;
};

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

type FetchForTargetResult =
  | { success: true; rules: IssueAlertRule[]; nextCursor?: string }
  | { success: false; error: Error };

async function fetchRulesForTarget(
  target: ResolvedTarget,
  opts: { limit: number; cursor?: string }
): Promise<FetchForTargetResult> {
  try {
    const results: IssueAlertRule[] = [];
    let serverCursor = opts.cursor;

    for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
      const { data, nextCursor } = await listIssueAlertsPaginated(
        target.org,
        target.project,
        {
          perPage: Math.min(opts.limit - results.length, API_MAX_PER_PAGE),
          cursor: serverCursor,
        }
      );

      for (const rule of data) {
        results.push(rule);
        if (results.length >= opts.limit) {
          return { success: true, rules: results, nextCursor };
        }
      }

      if (!nextCursor) {
        return { success: true, rules: results };
      }
      serverCursor = nextCursor;
    }

    return { success: true, rules: results };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

// ---------------------------------------------------------------------------
// Human output
// ---------------------------------------------------------------------------

function formatIssueAlertListHuman(result: IssueAlertListResult): string {
  if (result.rulesWithTargets.length === 0) {
    const base = result.footer
      ? `No issue alert rules found.\n\n${result.footer}`
      : "No issue alert rules found.";
    return base;
  }

  type Row = {
    id: string;
    name: string;
    project?: string;
    conditions: string;
    actions: string;
    environment: string;
    status: string;
  };

  const rows: Row[] = result.rulesWithTargets.map(({ rule: r, target }) => ({
    id: r.id,
    name: escapeMarkdownCell(r.name),
    ...(result.isMultiProject && {
      project: `${target.org}/${target.project}`,
    }),
    conditions: String(r.conditions.length),
    actions: String(r.actions.length),
    environment: r.environment ?? "all",
    status:
      r.status === "active"
        ? colorTag("green", "active")
        : colorTag("muted", r.status),
  }));

  const columns: Column<Row>[] = [
    { header: "ID", value: (r) => r.id },
    { header: "NAME", value: (r) => r.name },
    ...(result.isMultiProject
      ? [{ header: "PROJECT", value: (r: Row) => r.project ?? "" }]
      : []),
    { header: "CONDITIONS", value: (r) => r.conditions },
    { header: "ACTIONS", value: (r) => r.actions },
    { header: "ENVIRONMENT", value: (r) => r.environment },
    { header: "STATUS", value: (r) => r.status },
  ];

  const parts: string[] = [];
  const buffer: Writer = { write: (s) => parts.push(s) };
  writeTable(buffer, rows, columns);

  return parts.join("").trimEnd();
}

// ---------------------------------------------------------------------------
// JSON transform
// ---------------------------------------------------------------------------

function jsonTransformIssueAlertList(
  result: IssueAlertListResult,
  fields?: string[]
): unknown {
  const rules = result.rulesWithTargets.map(({ rule }) => rule);
  const items =
    fields && fields.length > 0
      ? rules.map((r) => filterFields(r, fields))
      : rules;

  const envelope: Record<string, unknown> = {
    data: items,
    hasMore: result.hasMore,
    hasPrev: !!result.hasPrev,
  };
  if (result.nextCursor) {
    envelope.nextCursor = result.nextCursor;
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Hint
// ---------------------------------------------------------------------------

function buildHint(result: IssueAlertListResult): string | undefined {
  const { singleTarget } = result;

  const navRaw =
    singleTarget &&
    paginationHint({
      hasPrev: !!result.hasPrev,
      hasMore: result.hasMore,
      prevHint: `sentry alert issues list ${singleTarget.org}/${singleTarget.project} -c prev`,
      nextHint: `sentry alert issues list ${singleTarget.org}/${singleTarget.project} -c next`,
    });
  const nav = navRaw ? ` ${navRaw}` : "";

  const count = result.rulesWithTargets.length;
  if (count === 0) {
    return nav ? `No issue alert rules found.${nav}` : undefined;
  }

  const parts: string[] = [`Showing ${count} rule(s).${nav}`];
  if (result.footer) {
    parts.push(result.footer);
  }
  if (singleTarget) {
    parts.push(
      `Alert rules: ${buildIssueAlertsUrl(singleTarget.org, singleTarget.project)}`
    );
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Multi-target fetch
// ---------------------------------------------------------------------------

/**
 * Fetch alert rules from all targets in parallel with compound cursor support.
 *
 * Uses a two-phase strategy:
 * 1. Phase 1: distribute `ceil(limit / activeTargets)` quota per target in parallel.
 * 2. Phase 2: if total fetched < limit and some targets have more, redistribute
 *    the surplus among expandable targets and fetch one more page each.
 *
 * For multi-target mode, cursors are stored as a pipe-separated compound cursor
 * so `-c next` / `-c prev` advances each project independently.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inherent multi-target fetch with compound cursor, Phase 2, and failure handling
async function fetchAllTargets(
  targets: ResolvedTarget[],
  flags: ListFlags
): Promise<{
  rulesWithTargets: AlertRuleWithTarget[];
  cursorToStore: string | undefined;
  contextKey: string;
  direction: "next" | "prev" | "first";
}> {
  const isSingleTarget = targets.length === 1;
  // biome-ignore lint/style/noNonNullAssertion: guarded by isSingleTarget
  const singleTarget = isSingleTarget ? targets[0]! : undefined;

  // Build the context key — single uses the project-scoped key, multi uses a
  // fingerprint of all target org/project pairs so cursors are never crossed.
  const contextKey =
    isSingleTarget && singleTarget
      ? buildPaginationContextKey("alert-issues", singleTarget.org, {
          project: singleTarget.project,
        })
      : buildMultiTargetContextKey(targets);

  // Sorted target keys must match the order used in buildMultiTargetContextKey.
  const sortedTargetKeys = targets.map((t) => `${t.org}/${t.project}`).sort();

  // Resolve stored cursor (handles --cursor flag and DB lookup).
  const { cursor: rawCursor, direction } = resolveCursor(
    flags.cursor,
    PAGINATION_KEY,
    contextKey
  );

  // Decode per-target start cursors from the compound cursor.
  const startCursors = new Map<string, string>();
  const exhaustedTargets = new Set<string>();
  if (rawCursor) {
    if (isSingleTarget && singleTarget) {
      startCursors.set(
        `${singleTarget.org}/${singleTarget.project}`,
        rawCursor
      );
    } else {
      const decoded = decodeCompoundCursor(rawCursor);
      for (let i = 0; i < decoded.length && i < sortedTargetKeys.length; i++) {
        const cursor = decoded[i];
        // biome-ignore lint/style/noNonNullAssertion: i is within bounds
        const key = sortedTargetKeys[i]!;
        if (cursor) {
          startCursors.set(key, cursor);
        } else {
          // null = project was exhausted on the previous page — skip entirely
          exhaustedTargets.add(key);
        }
      }
    }
  }

  // Skip targets that were exhausted on the previous page.
  const activeTargets =
    exhaustedTargets.size > 0
      ? targets.filter((t) => !exhaustedTargets.has(`${t.org}/${t.project}`))
      : targets;

  const quota = Math.max(1, Math.ceil(flags.limit / activeTargets.length));
  const message =
    activeTargets.length > 1
      ? `Fetching issue alert rules from ${activeTargets.length} projects...`
      : `Fetching issue alert rules for ${singleTarget?.org}/${singleTarget?.project}...`;

  // Phase 1: fetch quota from each active target in parallel.
  const phase1 = await withProgress({ message, json: flags.json }, () =>
    Promise.all(
      activeTargets.map((t) =>
        fetchRulesForTarget(t, {
          limit: quota,
          cursor: startCursors.get(`${t.org}/${t.project}`),
        })
      )
    )
  );

  let totalFetched = phase1.reduce(
    (sum, r) => sum + (r.success ? r.rules.length : 0),
    0
  );

  // Phase 2: redistribute surplus among targets that still have more pages.
  const surplus = flags.limit - totalFetched;
  if (surplus > 0) {
    const expandableIndices: number[] = [];
    for (let i = 0; i < phase1.length; i++) {
      const r = phase1[i];
      if (r?.success && r.rules.length >= quota && r.nextCursor) {
        expandableIndices.push(i);
      }
    }
    if (expandableIndices.length > 0) {
      const extraQuota = Math.max(
        1,
        Math.ceil(surplus / expandableIndices.length)
      );
      const phase2 = await Promise.all(
        expandableIndices.map((i) => {
          // biome-ignore lint/style/noNonNullAssertion: guaranteed by expandableIndices filter
          const t = activeTargets[i]!;
          const r = phase1[i] as {
            success: true;
            rules: IssueAlertRule[];
            nextCursor?: string;
          };
          // biome-ignore lint/style/noNonNullAssertion: expandableIndices only contains indices with a nextCursor
          const cursor = r.nextCursor!;
          return fetchRulesForTarget(t, { limit: extraQuota, cursor });
        })
      );
      for (let j = 0; j < expandableIndices.length; j++) {
        // biome-ignore lint/style/noNonNullAssertion: j is within expandableIndices bounds
        const i = expandableIndices[j]!;
        const p2 = phase2[j];
        const p1 = phase1[i];
        if (p1?.success && p2?.success) {
          p1.rules.push(...p2.rules);
          p1.nextCursor = p2.nextCursor;
          totalFetched += p2.rules.length;
        }
      }
    }
  }

  // Build the cursor to store for `-c next`.
  // Index into sortedTargetKeys to keep compound cursor aligned.
  const phase1ByKey = new Map<string, FetchForTargetResult>();
  for (let i = 0; i < activeTargets.length; i++) {
    const t = activeTargets[i];
    const r = phase1[i];
    if (t && r) {
      phase1ByKey.set(`${t.org}/${t.project}`, r);
    }
  }

  let cursorToStore: string | undefined;
  if (isSingleTarget) {
    const r = phase1[0];
    cursorToStore = r?.success ? (r.nextCursor ?? undefined) : undefined;
  } else {
    const cursorValues: (string | null)[] = sortedTargetKeys.map((key) => {
      if (exhaustedTargets.has(key)) {
        return null;
      }
      const result = phase1ByKey.get(key);
      if (result?.success) {
        return result.nextCursor ?? null;
      }
      // Failed fetch: preserve the start cursor so the next `-c next` retries
      // from the same position rather than restarting from scratch.
      return startCursors.get(key) ?? null;
    });
    const hasAnyCursor = cursorValues.some((c) => c !== null);
    cursorToStore = hasAnyCursor
      ? encodeCompoundCursor(cursorValues)
      : undefined;
  }

  // Surface total failure; log partial failures.
  const failureIndices = phase1
    .map((r, i) => (r.success ? -1 : i))
    .filter((i) => i !== -1);

  if (failureIndices.length > 0) {
    if (failureIndices.length === phase1.length) {
      const first = phase1[0];
      const err =
        first && !first.success ? first.error : new Error("All fetches failed");
      throw err instanceof ApiError ? err : new Error(err.message);
    }
    const names = failureIndices
      // biome-ignore lint/style/noNonNullAssertion: index within bounds
      .map((i) => `${activeTargets[i]!.org}/${activeTargets[i]!.project}`)
      .join(", ");
    logger.warn(
      `Failed to fetch alert rules from ${names}. Showing results from remaining projects.`
    );
  }

  // Combine valid results, sorted by name.
  const rulesWithTargets: AlertRuleWithTarget[] = [];
  for (let i = 0; i < phase1.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i is within bounds
    const r = phase1[i]!;
    // biome-ignore lint/style/noNonNullAssertion: i is within bounds
    const t = activeTargets[i]!;
    if (r.success) {
      for (const rule of r.rules) {
        rulesWithTargets.push({ rule, target: t });
      }
    }
  }
  rulesWithTargets.sort((a, b) => a.rule.name.localeCompare(b.rule.name));

  return { rulesWithTargets, cursorToStore, contextKey, direction };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const listCommand = buildListCommand("alert", {
  docs: {
    brief: "List issue alert rules",
    fullDescription:
      "List issue alert rules for one or more Sentry projects.\n\n" +
      "Issue alerts trigger notifications when error events match conditions.\n\n" +
      "Target patterns:\n" +
      "  sentry alert issues list                     # auto-detect from DSN or config\n" +
      "  sentry alert issues list <org>/<project>     # explicit org and project\n" +
      "  sentry alert issues list <org>/              # all projects in org\n" +
      "  sentry alert issues list <project>           # find project across all orgs\n\n" +
      `${targetPatternExplanation()}\n\n` +
      "In monorepos with multiple Sentry projects, shows alert rules from all detected projects.",
  },
  output: {
    human: formatIssueAlertListHuman,
    jsonTransform: jsonTransformIssueAlertList,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/project",
          brief:
            "<org>/<project>, <org>/ (all), <project> (search), or omit to auto-detect",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      limit: buildListLimitFlag("issue alert rules"),
    },
    aliases: { w: "web", n: "limit" },
  },
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    const { cwd } = this;

    const parsed = parseOrgProjectArg(target);

    const { targets, footer } = await withProgress(
      { message: "Resolving targets...", json: flags.json },
      () => resolveTargetsFromParsedArg(parsed, { cwd, usageHint: USAGE_HINT })
    );

    if (targets.length === 0) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    const singleTarget = targets.length === 1 ? targets[0] : undefined;

    if (flags.web && singleTarget) {
      await openInBrowser(
        buildIssueAlertsUrl(singleTarget.org, singleTarget.project),
        "issue alert rules"
      );
      return;
    }

    const { rulesWithTargets, cursorToStore, contextKey, direction } =
      await fetchAllTargets(targets, flags);

    advancePaginationState(
      PAGINATION_KEY,
      contextKey,
      direction,
      cursorToStore
    );

    const hasMore = !!cursorToStore;
    const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);

    const outputData: IssueAlertListResult = {
      rulesWithTargets: rulesWithTargets.slice(0, flags.limit),
      isMultiProject: targets.length > 1,
      hasMore,
      hasPrev: hasPrev || undefined,
      nextCursor: cursorToStore,
      singleTarget,
      footer,
    };
    yield new CommandOutput(outputData);

    return { hint: buildHint(outputData) };
  },
});
