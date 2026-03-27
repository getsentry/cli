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
  hasPreviousPage,
  resolveCursor,
} from "../../../lib/db/pagination.js";
import { ContextError } from "../../../lib/errors.js";
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
  targetPatternExplanation,
} from "../../../lib/list-command.js";
import {
  dispatchOrgScopedList,
  jsonTransformListResult,
  type ListCommandMeta,
  type ListResult,
} from "../../../lib/org-list.js";
import { withProgress } from "../../../lib/polling.js";
import { resolveTargetsFromParsedArg } from "../../../lib/resolve-target.js";
import { buildMetricAlertsUrl } from "../../../lib/sentry-urls.js";
import type { Writer } from "../../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "alert-metrics-list";

const USAGE_HINT = "sentry alert metrics list <org>/";

type ListFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly json: boolean;
  readonly fields?: string[];
  readonly query?: string;
};

/** Display row carrying per-rule org context for the human formatter. */
type MetricAlertRow = { rule: MetricAlertRule; orgSlug: string };

/**
 * Extended result type: raw rules in `items` (for JSON), display rows in
 * `displayRows` (for human output). Mirrors the IssueListResult pattern.
 */
type MetricAlertListResult = ListResult<MetricAlertRule> & {
  displayRows?: MetricAlertRow[];
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
 * Fetch metric alert rules for one org starting from an optional cursor,
 * fetching multiple API pages until `limit` is reached or no more pages exist.
 */
async function fetchMetricRulesPage(
  orgSlug: string,
  opts: { limit: number; cursor?: string }
): Promise<{ rules: MetricAlertRule[]; nextCursor?: string }> {
  const rules: MetricAlertRule[] = [];
  let serverCursor = opts.cursor;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await listMetricAlertsPaginated(orgSlug, {
      perPage: Math.min(opts.limit - rules.length, API_MAX_PER_PAGE),
      cursor: serverCursor,
    });

    for (const rule of data) {
      rules.push(rule);
      if (rules.length >= opts.limit) {
        return { rules, nextCursor: nextCursor ?? undefined };
      }
    }

    if (!nextCursor) {
      return { rules };
    }
    serverCursor = nextCursor;
  }

  return { rules };
}

/**
 * Fetch metric alert rules from multiple orgs in parallel and combine.
 * Used by auto-detect and project-search modes.
 */
async function fetchFromOrgs(
  orgs: string[],
  limit: number,
  json: boolean
): Promise<MetricAlertRow[]> {
  const results = await withProgress(
    {
      message:
        orgs.length > 1
          ? `Fetching metric alert rules from ${orgs.length} organizations...`
          : `Fetching metric alert rules for ${orgs[0]}...`,
      json,
    },
    () =>
      Promise.all(
        orgs.map(async (org) => {
          const { rules } = await fetchMetricRulesPage(org, { limit });
          return rules.map((rule) => ({ rule, orgSlug: org }));
        })
      )
  );
  return results.flat().slice(0, limit);
}

/** Client-side name filter applied after fetch (API has no query param). */
function applyQueryFilter(
  rows: MetricAlertRow[],
  query: string | undefined
): MetricAlertRow[] {
  if (!query) {
    return rows;
  }
  const q = query.toLowerCase();
  return rows.filter((r) => r.rule.name.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Mode handlers
// ---------------------------------------------------------------------------

async function handleAutoDetectMetricAlerts(
  cwd: string,
  flags: ListFlags
): Promise<MetricAlertListResult> {
  const { targets, footer } = await withProgress(
    { message: "Resolving targets...", json: flags.json },
    () =>
      resolveTargetsFromParsedArg(
        { type: "auto-detect" },
        { cwd, usageHint: USAGE_HINT }
      )
  );
  if (targets.length === 0) {
    throw new ContextError("Organization", USAGE_HINT);
  }
  const uniqueOrgs = [...new Set(targets.map((t) => t.org))];
  const displayRows = applyQueryFilter(
    await fetchFromOrgs(uniqueOrgs, flags.limit, flags.json),
    flags.query
  );
  return {
    items: displayRows.map((r) => r.rule),
    displayRows,
    hasMore: false,
    hint: footer,
  };
}

async function handleExplicitMetricAlerts(
  org: string,
  flags: ListFlags
): Promise<MetricAlertListResult> {
  const { rules } = await withProgress(
    { message: `Fetching metric alert rules for ${org}...`, json: flags.json },
    () => fetchMetricRulesPage(org, { limit: flags.limit })
  );
  const displayRows = applyQueryFilter(
    rules.map((rule) => ({ rule, orgSlug: org })),
    flags.query
  );
  return {
    items: displayRows.map((r) => r.rule),
    displayRows,
    hasMore: false,
    hint: `Metric alerts: ${buildMetricAlertsUrl(org)}`,
  };
}

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

  const { rules, nextCursor } = await withProgress(
    { message: `Fetching metric alert rules for ${org}...`, json: flags.json },
    () => fetchMetricRulesPage(org, { limit: flags.limit, cursor: startCursor })
  );

  advancePaginationState(PAGINATION_KEY, contextKey, direction, nextCursor);
  const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);

  const displayRows = applyQueryFilter(
    rules.map((rule) => ({ rule, orgSlug: org })),
    flags.query
  );

  const nav = paginationHint({
    hasPrev,
    hasMore: !!nextCursor,
    prevHint: `sentry alert metrics list ${org}/ -c prev`,
    nextHint: `sentry alert metrics list ${org}/ -c next`,
  });

  const hintParts: string[] = [];
  if (displayRows.length === 0) {
    hintParts.push(`No metric alert rules found in '${org}'.`);
  } else {
    hintParts.push(
      `Showing ${displayRows.length} rule(s)${nextCursor ? " (more available)" : ""}.`
    );
    hintParts.push(`Metric alerts: ${buildMetricAlertsUrl(org)}`);
  }
  if (nav) {
    hintParts.push(nav);
  }

  return {
    items: displayRows.map((r) => r.rule),
    displayRows,
    hasMore: !!nextCursor,
    hasPrev,
    nextCursor,
    hint: hintParts.join("\n"),
  };
}

async function handleProjectSearchMetricAlerts(
  projectSlug: string,
  cwd: string,
  flags: ListFlags
): Promise<MetricAlertListResult> {
  const { targets } = await withProgress(
    { message: `Searching for project '${projectSlug}'...`, json: flags.json },
    () =>
      resolveTargetsFromParsedArg(
        { type: "project-search", projectSlug },
        { cwd, usageHint: USAGE_HINT }
      )
  );
  const uniqueOrgs = [...new Set(targets.map((t) => t.org))];
  const displayRows = applyQueryFilter(
    await fetchFromOrgs(uniqueOrgs, flags.limit, flags.json),
    flags.query
  );
  return { items: displayRows.map((r) => r.rule), displayRows, hasMore: false };
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
  writeTable(buffer, tableRows, columns);

  return parts.join("").trimEnd();
}

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
      "Metric alert rules are org-scoped; the project part is ignored when provided.",
  },
  output: {
    human: formatMetricAlertListHuman,
    jsonTransform: jsonTransformListResult,
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

    const result = (await dispatchOrgScopedList({
      config: metricAlertListMeta,
      cwd,
      flags,
      parsed,
      orgSlugMatchBehavior: "redirect",
      overrides: {
        "auto-detect": (ctx) => handleAutoDetectMetricAlerts(ctx.cwd, flags),
        explicit: (ctx) => handleExplicitMetricAlerts(ctx.parsed.org, flags),
        "org-all": (ctx) => handleOrgAllMetricAlerts(ctx.parsed.org, flags),
        "project-search": (ctx) =>
          handleProjectSearchMetricAlerts(
            ctx.parsed.projectSlug,
            ctx.cwd,
            flags
          ),
      },
    })) as MetricAlertListResult;

    yield new CommandOutput(result);
    return { hint: result.hint };
  },
});
