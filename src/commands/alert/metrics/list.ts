/**
 * sentry alert metrics list
 *
 * List metric alert rules for one or more Sentry organizations.
 *
 * Metric alerts are org-scoped. Supports all four target modes:
 * - auto-detect  → DSN detection / config defaults (may resolve multiple orgs)
 * - explicit     → single org/project (project part ignored, metric alerts are org-scoped)
 * - org-all      → all metric alert rules for the specified org (cursor-paginated)
 * - project-search → find project across orgs, use its org
 */

import type { SentryContext } from "../../../context.js";
import type { MetricAlertRule } from "../../../lib/api/alerts.js";
import { MAX_PAGINATION_PAGES } from "../../../lib/api/infrastructure.js";
import {
  API_MAX_PER_PAGE,
  listMetricAlertsPaginated,
} from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { openInBrowser } from "../../../lib/browser.js";
import {
  advancePaginationState,
  buildOrgContextKey,
  buildPaginationContextKey,
  CURSOR_SEP,
  decodeCompoundCursor,
  encodeCompoundCursor,
  escapeContextKeyValue,
  hasPreviousPage,
  resolveCursor,
} from "../../../lib/db/pagination.js";
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
  paginationHint,
  parseCursorFlag,
  targetPatternExplanation,
} from "../../../lib/list-command.js";
import { logger } from "../../../lib/logger.js";
import {
  dispatchOrgScopedList,
  jsonTransformListResult,
  type ListCommandMeta,
  type ListResult,
  type ModeHandler,
} from "../../../lib/org-list.js";
import { withProgress } from "../../../lib/polling.js";
import {
  type ResolvedTarget,
  resolveTargetsFromParsedArg,
} from "../../../lib/resolve-target.js";
import { buildMetricAlertsUrl } from "../../../lib/sentry-urls.js";
import type { Writer } from "../../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "alert-metrics-list";

const USAGE_HINT = "sentry alert metrics list <org>/";

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

/** Per-org fetch result */
type MetricRuleFetchResult = {
  orgSlug: string;
  rules: MetricAlertRule[];
  hasMore?: boolean;
  nextCursor?: string;
};

/** Success/failure wrapper for per-org fetches */
type FetchResult =
  | { success: true; data: MetricRuleFetchResult }
  | { success: false; error: Error };

/** Display row carrying per-rule org context for the human formatter. */
type MetricAlertRow = { rule: MetricAlertRule; orgSlug: string };

/**
 * Extended result type: raw rules in `items` (for JSON), display rows in
 * `displayRows` (for human output).
 */
type MetricAlertListResult = ListResult<MetricAlertRule> & {
  displayRows?: MetricAlertRow[];
  title?: string;
  footerMode?: "single" | "multi" | "none";
  moreHint?: string;
  footer?: string;
};

const metricAlertListMeta: ListCommandMeta = {
  paginationKey: PAGINATION_KEY,
  entityName: "metric alert rule",
  entityPlural: "metric alert rules",
  commandPrefix: "sentry alert metrics list",
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch metric alert rules for one org with auth guard.
 * Paginates locally up to the given limit.
 */
async function fetchRulesForOrg(
  orgSlug: string,
  options: { limit: number; startCursor?: string }
): Promise<FetchResult> {
  const result = await withAuthGuard(async () => {
    const rules: MetricAlertRule[] = [];
    let serverCursor = options.startCursor;

    for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
      const { data, nextCursor } = await listMetricAlertsPaginated(orgSlug, {
        perPage: Math.min(options.limit - rules.length, API_MAX_PER_PAGE),
        cursor: serverCursor,
      });

      for (const rule of data) {
        rules.push(rule);
        if (rules.length >= options.limit) {
          return {
            orgSlug,
            rules,
            hasMore: true,
            nextCursor: nextCursor ?? undefined,
          };
        }
      }

      if (!nextCursor) {
        return { orgSlug, rules, hasMore: false };
      }
      serverCursor = nextCursor;
    }

    return { orgSlug, rules, hasMore: false };
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
 * Execute Phase 2: redistribute surplus budget to expandable orgs.
 */
async function runPhase2(
  orgs: string[],
  phase1: FetchResult[],
  expandableIndices: number[],
  surplus: number
): Promise<void> {
  const extraQuota = Math.max(1, Math.ceil(surplus / expandableIndices.length));

  const phase2 = await Promise.all(
    expandableIndices.map((i) => {
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by expandableIndices filter
      const org = orgs[i]!;
      const r = phase1[i] as { success: true; data: MetricRuleFetchResult };
      // biome-ignore lint/style/noNonNullAssertion: same guarantee
      const cursor = r.data.nextCursor!;
      return fetchRulesForOrg(org, { limit: extraQuota, startCursor: cursor });
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
 * Fetch metric alert rules from multiple orgs within a global limit budget.
 *
 * Phase 1: distribute quota per org, fetch in parallel.
 * Phase 2: redistribute surplus to expandable orgs.
 */
async function fetchWithBudget(
  orgs: string[],
  options: { limit: number; startCursors?: Map<string, string> },
  onProgress: (fetched: number) => void
): Promise<{ results: FetchResult[]; hasMore: boolean }> {
  const { limit, startCursors } = options;
  const quota = Math.max(1, Math.ceil(limit / orgs.length));

  const phase1 = await Promise.all(
    orgs.map((org) =>
      fetchRulesForOrg(org, {
        limit: quota,
        startCursor: startCursors?.get(org),
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

  await runPhase2(orgs, phase1, expandableIndices, surplus);

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
 * per org (when possible).
 */
function trimWithOrgGuarantee(
  rows: MetricAlertRow[],
  limit: number
): MetricAlertRow[] {
  if (rows.length <= limit) {
    return rows;
  }

  const seenOrgs = new Set<string>();
  const guaranteed = new Set<number>();

  for (let i = 0; i < rows.length && guaranteed.size < limit; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i is within bounds
    if (!seenOrgs.has(rows[i]!.orgSlug)) {
      // biome-ignore lint/style/noNonNullAssertion: i is within bounds
      seenOrgs.add(rows[i]!.orgSlug);
      guaranteed.add(i);
    }
  }

  const selected = new Set<number>(guaranteed);
  for (let i = 0; i < rows.length && selected.size < limit; i++) {
    selected.add(i);
  }

  return rows.filter((_, i) => selected.has(i));
}

/**
 * Build a compound context key for multi-org pagination.
 * Encodes the sorted org set and optional query so cursors from different
 * searches are never reused.
 */
function buildMultiOrgContextKey(
  orgs: string[],
  query: string | undefined
): string {
  const sortedOrgs = [...orgs].sort().map(escapeContextKeyValue).join(",");
  return buildPaginationContextKey("multi-org", sortedOrgs, { q: query });
}

// ---------------------------------------------------------------------------
// Mode handlers
// ---------------------------------------------------------------------------

type ResolvedOrgsOptions = {
  parsed: ReturnType<typeof parseOrgProjectArg>;
  flags: ListFlags;
  cwd: string;
};

/**
 * Handle auto-detect, explicit, and project-search modes.
 *
 * All three share the same flow: resolve targets → deduplicate to unique orgs
 * → fetch within budget → compound cursor per org → display.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inherent multi-org resolution, compound cursor, error handling, and display logic
async function handleResolvedOrgs(
  options: ResolvedOrgsOptions
): Promise<MetricAlertListResult> {
  const { parsed, flags, cwd } = options;

  const { targets, footer } = await resolveTargetsFromParsedArg(parsed, {
    cwd,
    usageHint: USAGE_HINT,
  });

  if (targets.length === 0) {
    throw new ContextError("Organization", USAGE_HINT);
  }

  const uniqueOrgs = [...new Set(targets.map((t: ResolvedTarget) => t.org))];

  const contextKey = buildMultiOrgContextKey(uniqueOrgs, flags.query);
  const sortedOrgKeys = [...uniqueOrgs].sort();

  const startCursors = new Map<string, string>();
  const exhaustedOrgs = new Set<string>();
  const { cursor: rawCursor, direction } = resolveCursor(
    flags.cursor,
    PAGINATION_KEY,
    contextKey
  );
  if (rawCursor) {
    const decoded = decodeCompoundCursor(rawCursor);
    for (let i = 0; i < decoded.length && i < sortedOrgKeys.length; i++) {
      const cursor = decoded[i];
      // biome-ignore lint/style/noNonNullAssertion: i is within bounds
      const key = sortedOrgKeys[i]!;
      if (cursor) {
        startCursors.set(key, cursor);
      } else {
        exhaustedOrgs.add(key);
      }
    }
  }

  const activeOrgs =
    exhaustedOrgs.size > 0
      ? uniqueOrgs.filter((org) => !exhaustedOrgs.has(org))
      : uniqueOrgs;

  const orgCount = activeOrgs.length;
  const baseMessage =
    orgCount > 1
      ? `Fetching metric alert rules from ${orgCount} organizations`
      : "Fetching metric alert rules";

  const { results, hasMore } = await withProgress(
    { message: `${baseMessage} (up to ${flags.limit})...`, json: flags.json },
    (setMessage) =>
      fetchWithBudget(
        activeOrgs,
        { limit: flags.limit, startCursors },
        (fetched) => {
          setMessage(
            `${baseMessage}, ${fetched} and counting (up to ${flags.limit})...`
          );
        }
      )
  );

  const cursorValues: (string | null)[] = sortedOrgKeys.map((key) => {
    if (exhaustedOrgs.has(key)) {
      return null;
    }
    const result = results.find((r) => r.success && r.data.orgSlug === key);
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

  const validResults: MetricRuleFetchResult[] = [];
  const failures: { orgSlug: string; error: Error }[] = [];

  for (let i = 0; i < results.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    const result = results[i]!;
    if (result.success) {
      validResults.push(result.data);
    } else {
      // biome-ignore lint/style/noNonNullAssertion: index within bounds
      failures.push({ orgSlug: activeOrgs[i]!, error: result.error });
    }
  }

  if (validResults.length === 0 && failures.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by failures.length > 0
    const { error: first } = failures[0]!;
    throw new Error(
      `Failed to fetch metric alert rules from ${uniqueOrgs.length} organization(s): ${first.message}`
    );
  }

  if (failures.length > 0) {
    const failedNames = failures.map(({ orgSlug }) => orgSlug).join(", ");
    logger.warn(
      `Failed to fetch metric alert rules from ${failedNames}. Showing results from ${validResults.length} organization(s).`
    );
  }

  const isMultiOrg = validResults.length > 1;
  const isSingleOrg = validResults.length === 1;
  const firstOrg = validResults[0]?.orgSlug;

  // Apply client-side name filter
  const allRows: MetricAlertRow[] = validResults.flatMap((r) =>
    r.rules.map((rule) => ({ rule, orgSlug: r.orgSlug }))
  );
  const filteredRows = flags.query
    ? allRows.filter((row) =>
        row.rule.name.toLowerCase().includes(flags.query?.toLowerCase() ?? "")
      )
    : allRows;

  const displayRows = trimWithOrgGuarantee(filteredRows, flags.limit);
  const trimmed = displayRows.length < filteredRows.length;
  const hasMoreToShow = hasMore || hasAnyCursor || trimmed;
  const canPaginate = hasAnyCursor;

  const allRules = displayRows.map((r) => r.rule);

  if (displayRows.length === 0) {
    const hint = footer
      ? `No metric alert rules found.\n\n${footer}`
      : "No metric alert rules found.";
    return { items: [], hint, hasMore: false, hasPrev };
  }

  const title =
    isSingleOrg && firstOrg
      ? `Metric alert rules in ${firstOrg}`
      : `Metric alert rules from ${validResults.length} organizations`;

  let footerMode: "single" | "multi" | "none" = "none";
  if (isMultiOrg) {
    footerMode = "multi";
  } else if (isSingleOrg) {
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

/**
 * Handle org-all mode: cursor-paginated listing of all metric alert rules in an org.
 *
 * Metric alerts are org-scoped, so this uses a single org-level cursor (not
 * compound) with full bidirectional navigation.
 */
async function handleOrgAllMetricAlerts(
  org: string,
  flags: ListFlags
): Promise<MetricAlertListResult> {
  const contextKey = buildOrgContextKey(org);
  const { cursor: startCursor, direction } = resolveCursor(
    flags.cursor,
    PAGINATION_KEY,
    contextKey
  );

  const fetchResult = await withProgress(
    { message: `Fetching metric alert rules for ${org}...`, json: flags.json },
    () => fetchRulesForOrg(org, { limit: flags.limit, startCursor })
  );

  if (!fetchResult.success) {
    throw fetchResult.error;
  }

  const { rules, nextCursor } = fetchResult.data;

  advancePaginationState(PAGINATION_KEY, contextKey, direction, nextCursor);
  const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);

  const filteredRows: MetricAlertRow[] = flags.query
    ? rules
        .filter((rule) =>
          rule.name.toLowerCase().includes(flags.query?.toLowerCase() ?? "")
        )
        .map((rule) => ({ rule, orgSlug: org }))
    : rules.map((rule) => ({ rule, orgSlug: org }));

  const nav = paginationHint({
    hasPrev,
    hasMore: !!nextCursor,
    prevHint: `sentry alert metrics list ${org}/ -c prev`,
    nextHint: `sentry alert metrics list ${org}/ -c next`,
  });

  if (filteredRows.length === 0) {
    const hintParts: string[] = [`No metric alert rules found in '${org}'.`];
    if (nav) {
      hintParts.push(nav);
    }
    return {
      items: [],
      hasMore: !!nextCursor,
      hasPrev,
      hint: hintParts.join("\n"),
    };
  }

  const hintParts: string[] = [
    `Showing ${filteredRows.length} rule(s)${nextCursor ? " (more available)" : ""}.`,
    `Metric alerts: ${buildMetricAlertsUrl(org)}`,
  ];
  if (nav) {
    hintParts.push(nav);
  }

  return {
    items: filteredRows.map((r) => r.rule),
    displayRows: filteredRows,
    hasMore: !!nextCursor,
    hasPrev,
    nextCursor,
    title: `Metric alert rules in ${org}`,
    footerMode: "single",
    hint: hintParts.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Human output
// ---------------------------------------------------------------------------

/** Format metric alert status: 0 = active, 1 = disabled */
function formatMetricStatus(status: number): string {
  return status === 0
    ? colorTag("green", "active")
    : colorTag("muted", "disabled");
}

function formatMetricAlertListHuman(result: MetricAlertListResult): string {
  if (result.items.length === 0) {
    return result.hint ?? "No metric alert rules found.";
  }

  const rows = result.displayRows ?? [];
  const uniqueOrgs = new Set(rows.map((r) => r.orgSlug));
  const isMultiOrg = uniqueOrgs.size > 1;

  type Row = {
    id: string;
    name: string;
    org?: string;
    aggregate: string;
    dataset: string;
    timeWindow: string;
    environment: string;
    status: string;
  };

  const tableRows: Row[] = rows.map(({ rule: r, orgSlug }) => ({
    id: r.id,
    name: escapeMarkdownCell(r.name),
    ...(isMultiOrg && { org: orgSlug }),
    aggregate: r.aggregate,
    dataset: r.dataset,
    timeWindow: `${r.timeWindow}m`,
    environment: r.environment ?? "all",
    status: formatMetricStatus(r.status),
  }));

  const columns: Column<Row>[] = [
    { header: "ID", value: (r) => r.id },
    { header: "NAME", value: (r) => r.name },
    ...(isMultiOrg ? [{ header: "ORG", value: (r: Row) => r.org ?? "" }] : []),
    { header: "AGGREGATE", value: (r) => r.aggregate },
    { header: "DATASET", value: (r) => r.dataset },
    { header: "WINDOW", value: (r) => r.timeWindow },
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

const jsonTransformMetricAlertList = jsonTransformListResult;

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const listCommand = buildListCommand("alert", {
  docs: {
    brief: "List metric alert rules",
    fullDescription:
      "List metric alert rules for one or more Sentry organizations.\n\n" +
      "Metric alerts trigger notifications when a metric query crosses a threshold.\n\n" +
      "Target patterns:\n" +
      "  sentry alert metrics list                     # auto-detect from DSN or config\n" +
      "  sentry alert metrics list <org>/              # explicit org (paginated)\n" +
      "  sentry alert metrics list <org>/<project>     # explicit org (project ignored)\n" +
      "  sentry alert metrics list <project>           # find project across all orgs\n\n" +
      `${targetPatternExplanation()}\n\n` +
      "Metric alert rules are org-scoped; the project part is ignored when provided.\n\n" +
      "Use --cursor / -c next / -c prev to paginate through larger result sets.",
  },
  output: {
    human: formatMetricAlertListHuman,
    jsonTransform: jsonTransformMetricAlertList,
  },
  parameters: {
    positional: LIST_TARGET_POSITIONAL,
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      limit: buildListLimitFlag("metric alert rules"),
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

    // --web: open browser when org is known from the target arg
    if (
      flags.web &&
      (parsed.type === "explicit" || parsed.type === "org-all")
    ) {
      await openInBrowser(
        buildMetricAlertsUrl(parsed.org),
        "metric alert rules"
      );
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: shared handler accepts any mode variant
    const resolveAndHandle: ModeHandler<any> = (ctx) =>
      handleResolvedOrgs({ ...ctx, flags });

    const result = (await dispatchOrgScopedList({
      config: metricAlertListMeta,
      cwd,
      flags,
      parsed,
      orgSlugMatchBehavior: "redirect",
      // Multi-org modes handle compound cursor pagination via handleResolvedOrgs
      allowCursorInModes: ["auto-detect", "explicit", "project-search"],
      overrides: {
        "auto-detect": resolveAndHandle,
        explicit: resolveAndHandle,
        "project-search": resolveAndHandle,
        "org-all": (ctx) => handleOrgAllMetricAlerts(ctx.parsed.org, flags),
      },
    })) as MetricAlertListResult;

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
  trimWithOrgGuarantee,
  encodeCompoundCursor,
  decodeCompoundCursor,
  buildMultiOrgContextKey,
  CURSOR_SEP,
  MAX_LIMIT,
};
