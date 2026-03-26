/**
 * sentry alert metrics list
 *
 * List metric alert rules for a Sentry organization with cursor-based pagination.
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
  buildPaginationContextKey,
  hasPreviousPage,
  resolveCursor,
} from "../../../lib/db/pagination.js";
import { ContextError } from "../../../lib/errors.js";
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
} from "../../../lib/list-command.js";
import { withProgress } from "../../../lib/polling.js";
import { resolveOrg } from "../../../lib/resolve-target.js";
import { buildMetricAlertsUrl } from "../../../lib/sentry-urls.js";
import { setOrgProjectContext } from "../../../lib/telemetry.js";
import type { Writer } from "../../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "alert-metrics-list";

type ListFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly json: boolean;
  readonly fields?: string[];
};

type MetricAlertListResult = {
  rules: MetricAlertRule[];
  orgSlug: string;
  hasMore: boolean;
  hasPrev?: boolean;
  nextCursor?: string;
};

// Human output

/** Format metric alert status: 0 = active, 1 = disabled */
function formatMetricStatus(status: number): string {
  return status === 0
    ? colorTag("green", "active")
    : colorTag("muted", "disabled");
}

function formatMetricAlertListHuman(result: MetricAlertListResult): string {
  if (result.rules.length === 0) {
    return "No metric alert rules found.";
  }

  type Row = {
    id: string;
    name: string;
    aggregate: string;
    dataset: string;
    timeWindow: string;
    environment: string;
    status: string;
  };

  const url = buildMetricAlertsUrl(result.orgSlug);
  const rows: Row[] = result.rules.map((r) => ({
    id: r.id,
    name: `${escapeMarkdownCell(r.name)}\n${colorTag("muted", url)}`,
    aggregate: r.aggregate,
    dataset: r.dataset,
    timeWindow: `${r.timeWindow}m`,
    environment: r.environment ?? "all",
    status: formatMetricStatus(r.status),
  }));

  const columns: Column<Row>[] = [
    { header: "ID", value: (r) => r.id },
    { header: "NAME", value: (r) => r.name },
    { header: "AGGREGATE", value: (r) => r.aggregate },
    { header: "DATASET", value: (r) => r.dataset },
    { header: "WINDOW", value: (r) => r.timeWindow },
    { header: "ENVIRONMENT", value: (r) => r.environment },
    { header: "STATUS", value: (r) => r.status },
  ];

  const parts: string[] = [];
  const buffer: Writer = { write: (s) => parts.push(s) };
  writeTable(buffer, rows, columns);

  return parts.join("").trimEnd();
}

// JSON transform

function jsonTransformMetricAlertList(
  result: MetricAlertListResult,
  fields?: string[]
): unknown {
  const items =
    fields && fields.length > 0
      ? result.rules.map((r) => filterFields(r, fields))
      : result.rules;

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

// Fetch

async function fetchMetricAlerts(
  orgSlug: string,
  opts: {
    limit: number;
    perPage: number;
    cursor: string | undefined;
  }
): Promise<{ rules: MetricAlertRule[]; cursorToStore: string | undefined }> {
  let serverCursor = opts.cursor;
  const results: MetricAlertRule[] = [];

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await listMetricAlertsPaginated(orgSlug, {
      perPage: opts.perPage,
      cursor: serverCursor,
    });

    for (const rule of data) {
      results.push(rule);
      if (results.length >= opts.limit) {
        return {
          rules: results,
          cursorToStore: nextCursor ?? undefined,
        };
      }
    }

    if (!nextCursor) {
      return { rules: results, cursorToStore: undefined };
    }
    serverCursor = nextCursor;
  }

  return { rules: results, cursorToStore: undefined };
}

// Hint

function buildHint(result: MetricAlertListResult): string | undefined {
  const navRaw = paginationHint({
    hasPrev: !!result.hasPrev,
    hasMore: result.hasMore,
    prevHint: `sentry alert metrics list ${result.orgSlug}/ -c prev`,
    nextHint: `sentry alert metrics list ${result.orgSlug}/ -c next`,
  });
  const nav = navRaw ? ` ${navRaw}` : "";
  const url = buildMetricAlertsUrl(result.orgSlug);

  if (result.rules.length === 0) {
    return nav ? `No metric alert rules found.${nav}` : undefined;
  }

  return `Showing ${result.rules.length} rule(s).${nav}\nMetric alerts: ${url}`;
}

// Org resolution (metric alerts are org-scoped)

async function resolveOrgFromTarget(
  target: string | undefined,
  cwd: string
): Promise<string> {
  const parsed = parseOrgProjectArg(target);
  switch (parsed.type) {
    case "explicit":
    case "org-all":
      setOrgProjectContext([parsed.org], []);
      return parsed.org;
    case "project-search":
    case "auto-detect": {
      const resolved = await resolveOrg({ cwd });
      if (!resolved) {
        throw new ContextError(
          "Organization",
          "sentry alert metrics list <org>/"
        );
      }
      return resolved.org;
    }
    default: {
      const _exhaustive: never = parsed;
      throw new Error(
        `Unexpected parsed type: ${(_exhaustive as { type: string }).type}`
      );
    }
  }
}

// Command

export const listCommand = buildListCommand("alert", {
  docs: {
    brief: "List metric alert rules",
    fullDescription:
      "List metric alert rules for a Sentry organization.\n\n" +
      "Metric alerts trigger notifications when a metric query crosses a threshold.\n\n" +
      "Examples:\n" +
      "  sentry alert metrics list my-org/   # explicit org\n" +
      "  sentry alert metrics list           # auto-detect\n" +
      "  sentry alert metrics list -c next   # next page\n" +
      "  sentry alert metrics list --json    # JSON output\n" +
      "  sentry alert metrics list --web     # open in browser",
  },
  output: {
    human: formatMetricAlertListHuman,
    jsonTransform: jsonTransformMetricAlertList,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/",
          brief: "<org>/ or omit to auto-detect",
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
      limit: buildListLimitFlag("metric alert rules"),
    },
    aliases: { w: "web", n: "limit" },
  },
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    const { cwd } = this;

    const orgSlug = await resolveOrgFromTarget(target, cwd);

    if (flags.web) {
      await openInBrowser(buildMetricAlertsUrl(orgSlug), "metric alert rules");
      return;
    }

    const contextKey = buildPaginationContextKey("alert-metrics", orgSlug, {});
    const { cursor: rawCursor, direction } = resolveCursor(
      flags.cursor,
      PAGINATION_KEY,
      contextKey
    );

    const perPage = Math.min(flags.limit, API_MAX_PER_PAGE);

    const { rules, cursorToStore } = await withProgress(
      {
        message: `Fetching metric alert rules for ${orgSlug}...`,
        json: flags.json,
      },
      () =>
        fetchMetricAlerts(orgSlug, {
          limit: flags.limit,
          perPage,
          cursor: rawCursor ?? undefined,
        })
    );

    advancePaginationState(
      PAGINATION_KEY,
      contextKey,
      direction,
      cursorToStore
    );

    const hasMore = !!cursorToStore;
    const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);

    const outputData: MetricAlertListResult = {
      rules,
      orgSlug,
      hasMore,
      hasPrev: hasPrev || undefined,
      nextCursor: cursorToStore,
    };
    yield new CommandOutput(outputData);

    return { hint: buildHint(outputData) };
  },
});
