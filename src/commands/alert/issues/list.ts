/**
 * sentry alert issues list
 *
 * List issue alert rules for one or more Sentry projects.
 *
 * Issue alerts are project-scoped. Supports all four target modes:
 * - auto-detect  → DSN detection / config defaults (may resolve multiple projects)
 * - explicit     → single org/project
 * - org-all      → all projects in an org (all their alert rules combined)
 * - project-search → find project by slug across all orgs
 */

import type { SentryContext } from "../../../context.js";
import { buildProjectAliasMap } from "../../../lib/alias.js";
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
  CURSOR_SEP,
  decodeCompoundCursor,
  encodeCompoundCursor,
  hasPreviousPage,
  resolveCursor,
} from "../../../lib/db/pagination.js";
import {
  clearProjectAliases,
  setProjectAliases,
} from "../../../lib/db/project-aliases.js";
import { createDsnFingerprint } from "../../../lib/dsn/index.js";
import { ContextError, withAuthGuard } from "../../../lib/errors.js";
import {
  colorTag,
  escapeMarkdownCell,
} from "../../../lib/formatters/markdown.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { type Column, writeTable } from "../../../lib/formatters/table.js";
import {
  buildListCommand,
  buildListLimitFlag,
  LIST_BASE_ALIASES,
  LIST_TARGET_POSITIONAL,
  parseCursorFlag,
  targetPatternExplanation,
} from "../../../lib/list-command.js";
import { logger } from "../../../lib/logger.js";
import {
  dispatchOrgScopedList,
  type FetchResult as FetchResultOf,
  jsonTransformListResult,
  type ListCommandMeta,
  type ListResult,
  type ModeHandler,
  trimWithGroupGuarantee,
} from "../../../lib/org-list.js";
import { withProgress } from "../../../lib/polling.js";
import {
  type ResolvedTarget,
  resolveTargetsFromParsedArg,
} from "../../../lib/resolve-target.js";
import { buildIssueAlertsUrl } from "../../../lib/sentry-urls.js";
import type { ProjectAliasEntry, Writer } from "../../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "alert-issues-list";

const USAGE_HINT = "sentry alert issues list <org>/<project>";

const MAX_LIMIT = 1000;

type ListFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly json: boolean;
  readonly fields?: string[];
  readonly query?: string;
};

/** Per-target fetch result */
type AlertRuleListFetchResult = {
  target: ResolvedTarget;
  rules: IssueAlertRule[];
  hasMore?: boolean;
  nextCursor?: string;
};

/** Success/failure wrapper for per-target fetches */
type FetchResult = FetchResultOf<AlertRuleListFetchResult>;

/** Display row carrying per-rule project context for the human formatter. */
type AlertRuleRow = { rule: IssueAlertRule; target: ResolvedTarget };

/**
 * Extended result type: raw rules in `items` (for JSON), display rows in
 * `displayRows` (for human output).
 */
type IssueAlertListResult = ListResult<IssueAlertRule> & {
  displayRows?: AlertRuleRow[];
  title?: string;
  footerMode?: "single" | "multi" | "none";
  moreHint?: string;
  footer?: string;
};

const issueAlertListMeta: ListCommandMeta = {
  paginationKey: PAGINATION_KEY,
  entityName: "issue alert rule",
  entityPlural: "issue alert rules",
  commandPrefix: "sentry alert issues list",
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch issue alert rules for a single target project with auth guard.
 * Paginates locally up to the given limit.
 */
async function fetchRulesForTarget(
  target: ResolvedTarget,
  options: { limit: number; startCursor?: string }
): Promise<FetchResult> {
  const result = await withAuthGuard(async () => {
    const rules: IssueAlertRule[] = [];
    let serverCursor = options.startCursor;

    for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
      const { data, nextCursor } = await listIssueAlertsPaginated(
        target.org,
        target.project,
        {
          perPage: Math.min(options.limit - rules.length, API_MAX_PER_PAGE),
          cursor: serverCursor,
        }
      );

      for (const rule of data) {
        rules.push(rule);
        if (rules.length >= options.limit) {
          return {
            target,
            rules,
            hasMore: true,
            nextCursor: nextCursor ?? undefined,
          };
        }
      }

      if (!nextCursor) {
        return { target, rules, hasMore: false };
      }
      serverCursor = nextCursor;
    }

    return { target, rules, hasMore: false };
  });

  if (!result.ok) {
    const error =
      result.error instanceof Error
        ? result.error
        : new Error(String(result.error));
    return { success: false, error };
  }
  return { success: true, data: result.value };
}

/**
 * Execute Phase 2: redistribute surplus budget to expandable targets.
 */
async function runPhase2(
  targets: ResolvedTarget[],
  phase1: FetchResult[],
  expandableIndices: number[],
  context: {
    surplus: number;
    options: { limit: number };
  }
): Promise<void> {
  const { surplus } = context;
  const extraQuota = Math.max(1, Math.ceil(surplus / expandableIndices.length));

  const phase2 = await Promise.all(
    expandableIndices.map((i) => {
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by expandableIndices filter
      const target = targets[i]!;
      const r = phase1[i] as { success: true; data: AlertRuleListFetchResult };
      // biome-ignore lint/style/noNonNullAssertion: same guarantee
      const cursor = r.data.nextCursor!;
      return fetchRulesForTarget(target, {
        limit: extraQuota,
        startCursor: cursor,
      });
    })
  );

  for (let j = 0; j < expandableIndices.length; j++) {
    // biome-ignore lint/style/noNonNullAssertion: j is within expandableIndices bounds
    const i = expandableIndices[j]!;
    const p2 = phase2[j];
    const p1 = phase1[i];
    if (p1?.success && p2?.success) {
      p1.data.rules.push(...p2.data.rules);
      p1.data.hasMore = p2.data.hasMore;
      p1.data.nextCursor = p2.data.nextCursor;
    }
  }
}

/**
 * Fetch alert rules from multiple targets within a global limit budget.
 *
 * Phase 1: distribute quota per target, fetch in parallel.
 * Phase 2: redistribute surplus to expandable targets.
 */
async function fetchWithBudget(
  targets: ResolvedTarget[],
  options: { limit: number; startCursors?: Map<string, string> },
  onProgress: (fetched: number) => void
): Promise<{ results: FetchResult[]; hasMore: boolean }> {
  const { limit, startCursors } = options;
  const quota = Math.max(1, Math.ceil(limit / targets.length));

  const phase1 = await Promise.all(
    targets.map((t) =>
      fetchRulesForTarget(t, {
        limit: quota,
        startCursor: startCursors?.get(`${t.org}/${t.project}`),
      })
    )
  );

  let totalFetched = 0;
  for (const r of phase1) {
    if (r.success) {
      totalFetched += r.data.rules.length;
    }
  }
  onProgress(totalFetched);

  const surplus = limit - totalFetched;
  if (surplus <= 0) {
    return {
      results: phase1,
      hasMore: phase1.some((r) => r.success && r.data.hasMore),
    };
  }

  const expandableIndices: number[] = [];
  for (let i = 0; i < phase1.length; i++) {
    const r = phase1[i];
    if (r?.success && r.data.rules.length >= quota && r.data.nextCursor) {
      expandableIndices.push(i);
    }
  }

  if (expandableIndices.length === 0) {
    return { results: phase1, hasMore: false };
  }

  await runPhase2(targets, phase1, expandableIndices, { surplus, options });

  totalFetched = 0;
  for (const r of phase1) {
    if (r.success) {
      totalFetched += r.data.rules.length;
    }
  }
  onProgress(totalFetched);

  return {
    results: phase1,
    hasMore: phase1.some((r) => r.success && r.data.hasMore),
  };
}

/**
 * Trim display rows to the global limit while guaranteeing at least one row
 * per project (when possible).
 */
function trimWithProjectGuarantee(
  rows: AlertRuleRow[],
  limit: number
): AlertRuleRow[] {
  return trimWithGroupGuarantee(
    rows,
    limit,
    (r) => `${r.target.org}/${r.target.project}`
  );
}

// ---------------------------------------------------------------------------
// Mode handler
// ---------------------------------------------------------------------------

type ResolvedTargetsOptions = {
  parsed: ReturnType<typeof parseOrgProjectArg>;
  flags: ListFlags;
  cwd: string;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inherent multi-target resolution, compound cursor, error handling, and display logic
async function handleResolvedTargets(
  options: ResolvedTargetsOptions
): Promise<IssueAlertListResult> {
  const { parsed, flags, cwd } = options;

  const { targets, footer, detectedDsns } = await resolveTargetsFromParsedArg(
    parsed,
    { cwd, usageHint: USAGE_HINT }
  );

  if (targets.length === 0) {
    throw new ContextError("Organization and project", USAGE_HINT);
  }

  const contextKey = buildMultiTargetContextKey(targets, {
    query: flags.query,
  });

  const sortedTargetKeys = targets.map((t) => `${t.org}/${t.project}`).sort();
  const startCursors = new Map<string, string>();
  const exhaustedTargets = new Set<string>();
  const { cursor: rawCursor, direction } = resolveCursor(
    flags.cursor,
    PAGINATION_KEY,
    contextKey
  );
  if (rawCursor) {
    const decoded = decodeCompoundCursor(rawCursor);
    for (let i = 0; i < decoded.length && i < sortedTargetKeys.length; i++) {
      const cursor = decoded[i];
      // biome-ignore lint/style/noNonNullAssertion: i is within bounds
      const key = sortedTargetKeys[i]!;
      if (cursor) {
        startCursors.set(key, cursor);
      } else {
        exhaustedTargets.add(key);
      }
    }
  }

  const activeTargets =
    exhaustedTargets.size > 0
      ? targets.filter((t) => !exhaustedTargets.has(`${t.org}/${t.project}`))
      : targets;

  const targetCount = activeTargets.length;
  const baseMessage =
    targetCount > 1
      ? `Fetching issue alert rules from ${targetCount} projects`
      : "Fetching issue alert rules";

  const { results, hasMore } = await withProgress(
    { message: `${baseMessage} (up to ${flags.limit})...`, json: flags.json },
    (setMessage) =>
      fetchWithBudget(
        activeTargets,
        { limit: flags.limit, startCursors },
        (fetched) => {
          setMessage(
            `${baseMessage}, ${fetched} and counting (up to ${flags.limit})...`
          );
        }
      )
  );

  const cursorValues: (string | null)[] = sortedTargetKeys.map((key) => {
    if (exhaustedTargets.has(key)) {
      return null;
    }
    const result = results.find((r) => {
      if (!r.success) {
        return false;
      }
      return `${r.data.target.org}/${r.data.target.project}` === key;
    });
    if (result?.success) {
      return result.data.nextCursor ?? null;
    }
    return startCursors.get(key) ?? null;
  });
  const hasAnyCursor = cursorValues.some((c) => c !== null);
  const compoundNextCursor = hasAnyCursor
    ? encodeCompoundCursor(cursorValues)
    : undefined;
  advancePaginationState(
    PAGINATION_KEY,
    contextKey,
    direction,
    compoundNextCursor
  );
  const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);

  const validResults: AlertRuleListFetchResult[] = [];
  const failures: { target: ResolvedTarget; error: Error }[] = [];

  for (let i = 0; i < results.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    const result = results[i]!;
    if (result.success) {
      validResults.push(result.data);
    } else {
      // biome-ignore lint/style/noNonNullAssertion: index within bounds
      failures.push({ target: activeTargets[i]!, error: result.error });
    }
  }

  if (validResults.length === 0 && failures.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by failures.length > 0
    const { error: first } = failures[0]!;
    throw new Error(
      `Failed to fetch alert rules from ${targets.length} project(s): ${first.message}`
    );
  }

  if (failures.length > 0) {
    const failedNames = failures
      .map(({ target: t }) => `${t.org}/${t.project}`)
      .join(", ");
    logger.warn(
      `Failed to fetch alert rules from ${failedNames}. Showing results from ${validResults.length} project(s).`
    );
  }

  const isMultiProject = validResults.length > 1;
  const isSingleProject = validResults.length === 1;
  const firstTarget = validResults[0]?.target;

  const { entries } = isMultiProject
    ? buildProjectAliasMap(validResults)
    : { entries: {} as Record<string, ProjectAliasEntry> };

  if (isMultiProject) {
    const fingerprint = createDsnFingerprint(detectedDsns ?? []);
    setProjectAliases(entries, fingerprint);
  } else {
    clearProjectAliases();
  }

  // Apply client-side name filter
  const allRows: AlertRuleRow[] = validResults.flatMap((r) =>
    r.rules.map((rule) => ({ rule, target: r.target }))
  );
  const filteredRows = flags.query
    ? allRows.filter((row) =>
        row.rule.name.toLowerCase().includes(flags.query?.toLowerCase() ?? "")
      )
    : allRows;

  const displayRows = trimWithProjectGuarantee(filteredRows, flags.limit);
  const trimmed = displayRows.length < filteredRows.length;
  const hasMoreToShow = hasMore || hasAnyCursor || trimmed;
  const canPaginate = hasAnyCursor;

  const allRules = displayRows.map((r) => r.rule);

  if (displayRows.length === 0) {
    const hint = footer
      ? `No issue alert rules found.\n\n${footer}`
      : "No issue alert rules found.";
    return { items: [], hint, hasMore: false, hasPrev };
  }

  const title =
    isSingleProject && firstTarget
      ? `Issue alert rules in ${firstTarget.orgDisplay}/${firstTarget.projectDisplay}`
      : `Issue alert rules from ${validResults.length} projects`;

  let footerMode: "single" | "multi" | "none" = "none";
  if (isMultiProject) {
    footerMode = "multi";
  } else if (isSingleProject) {
    footerMode = "single";
  }

  let moreHint: string | undefined;
  if (hasMoreToShow) {
    const higherLimit = Math.min(flags.limit * 2, MAX_LIMIT);
    const canIncreaseLimit = higherLimit > flags.limit;
    const actionParts: string[] = [];
    if (canIncreaseLimit) {
      actionParts.push(`-n ${higherLimit}`);
    }
    if (canPaginate) {
      actionParts.push("-c next");
    }
    if (actionParts.length > 0) {
      moreHint = `More alert rules available — use ${actionParts.join(" or ")} for more.`;
    }
  }
  if (hasPrev) {
    const prevPart = "Prev: -c prev";
    moreHint = moreHint ? `${moreHint}\n${prevPart}` : prevPart;
  }

  return {
    items: allRules,
    hasMore: hasMoreToShow,
    hasPrev,
    displayRows,
    title,
    footerMode,
    moreHint,
    footer,
  };
}

// ---------------------------------------------------------------------------
// Human output
// ---------------------------------------------------------------------------

function formatIssueAlertListHuman(result: IssueAlertListResult): string {
  if (result.items.length === 0) {
    return result.hint ?? "No issue alert rules found.";
  }

  const rows = result.displayRows ?? [];
  const uniqueProjects = new Set(
    rows.map((r) => `${r.target.org}/${r.target.project}`)
  );
  const isMultiProject = uniqueProjects.size > 1;

  type Row = {
    id: string;
    name: string;
    project?: string;
    conditions: string;
    actions: string;
    environment: string;
    status: string;
  };

  const tableRows: Row[] = rows.map(({ rule: r, target }) => ({
    id: r.id,
    name: escapeMarkdownCell(r.name),
    ...(isMultiProject && {
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
    ...(isMultiProject
      ? [{ header: "PROJECT", value: (r: Row) => r.project ?? "" }]
      : []),
    { header: "CONDITIONS", value: (r) => r.conditions },
    { header: "ACTIONS", value: (r) => r.actions },
    { header: "ENVIRONMENT", value: (r) => r.environment },
    { header: "STATUS", value: (r) => r.status },
  ];

  const parts: string[] = [];
  const buffer: Writer = { write: (s) => parts.push(s) };

  if (result.title) {
    parts.push(`${result.title}:\n\n`);
  }

  writeTable(buffer, tableRows, columns);

  return parts.join("").trimEnd();
}

const jsonTransformIssueAlertList = jsonTransformListResult;

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
      "In monorepos with multiple Sentry projects, shows alert rules from all detected projects.\n\n" +
      "Use --cursor / -c next / -c prev to paginate through larger result sets.",
  },
  output: {
    human: formatIssueAlertListHuman,
    jsonTransform: jsonTransformIssueAlertList,
  },
  parameters: {
    positional: LIST_TARGET_POSITIONAL,
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      limit: buildListLimitFlag("issue alert rules"),
      query: {
        kind: "parsed",
        parse: String,
        brief: "Filter rules by name",
        optional: true,
      },
      cursor: {
        kind: "parsed",
        parse: parseCursorFlag,
        brief:
          'Pagination cursor (use "next" for next page, "prev" for previous)',
        optional: true,
      },
    },
    aliases: { ...LIST_BASE_ALIASES, w: "web", q: "query" },
  },
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    const { cwd } = this;
    const parsed = parseOrgProjectArg(target);

    // --web: open browser when org and project are known from the target arg
    if (flags.web && parsed.type === "explicit") {
      await openInBrowser(
        buildIssueAlertsUrl(parsed.org, parsed.project),
        "issue alert rules"
      );
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: shared handler accepts any mode variant
    const resolveAndHandle: ModeHandler<any> = (ctx) =>
      handleResolvedTargets({ ...ctx, flags });

    const result = (await dispatchOrgScopedList({
      config: issueAlertListMeta,
      cwd,
      flags,
      parsed,
      orgSlugMatchBehavior: "redirect",
      // All modes use per-project fetching with compound cursor support
      allowCursorInModes: [
        "auto-detect",
        "explicit",
        "project-search",
        "org-all",
      ],
      overrides: {
        "auto-detect": resolveAndHandle,
        explicit: resolveAndHandle,
        "project-search": resolveAndHandle,
        "org-all": resolveAndHandle,
      },
    })) as IssueAlertListResult;

    let combinedHint: string | undefined;
    if (result.items.length > 0) {
      const hintParts: string[] = [];
      if (result.moreHint) {
        hintParts.push(result.moreHint);
      }
      if (result.footer) {
        hintParts.push(result.footer);
      }
      combinedHint = hintParts.length > 0 ? hintParts.join("\n") : result.hint;
    }

    yield new CommandOutput(result);
    return { hint: combinedHint };
  },
});

/** @internal Exported for testing only. */
export const __testing = {
  trimWithProjectGuarantee,
  encodeCompoundCursor,
  decodeCompoundCursor,
  buildMultiTargetContextKey,
  buildProjectAliasMap,
  CURSOR_SEP,
  MAX_LIMIT,
};
