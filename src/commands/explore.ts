/**
 * sentry explore
 *
 * Query aggregate event data using the Sentry Explore/Events API.
 * Supports arbitrary fields, aggregates, and datasets for spike analysis
 * and ad-hoc event queries.
 */

import type { SentryContext } from "../context.js";
import { queryEvents } from "../lib/api-client.js";
import {
  buildProjectQuery,
  parseOrgProjectArg,
  validateLimit,
} from "../lib/arg-parsing.js";
import {
  advancePaginationState,
  buildPaginationContextKey,
  hasPreviousPage,
  resolveCursor,
} from "../lib/db/pagination.js";
import { ContextError, ValidationError } from "../lib/errors.js";
import { filterFields } from "../lib/formatters/json.js";
import { escapeMarkdownCell } from "../lib/formatters/markdown.js";
import { appendUnitSuffix, formatNumber } from "../lib/formatters/numbers.js";
import { CommandOutput } from "../lib/formatters/output.js";
import { type Column, formatTable } from "../lib/formatters/table.js";
import {
  buildListCommand,
  LIST_MAX_LIMIT,
  PERIOD_ALIASES,
  paginationHint,
} from "../lib/list-command.js";
import { logger } from "../lib/logger.js";
import { withProgress } from "../lib/polling.js";
import { resolveOrg, resolveProjectBySlug } from "../lib/resolve-target.js";
import { sanitizeQuery } from "../lib/search-query.js";
import {
  appendPeriodHint,
  PERIOD_BRIEF,
  parsePeriod,
  serializeTimeRange,
  type TimeRange,
  timeRangeToApiParams,
} from "../lib/time-range.js";

const log = logger.withTag("explore");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default fields when none specified — top errors view */
const DEFAULT_FIELDS = ["title", "count()"];

/** Default dataset */
const DEFAULT_DATASET = "errors";

/** Default time period */
const DEFAULT_PERIOD = "24h";

/** Command key for pagination cursor storage */
const PAGINATION_KEY = "explore";

/** Valid dataset values and their API-level names */
const DATASET_ALIASES: Record<string, string> = {
  errors: "errors",
  error: "errors",
  transactions: "transactions",
  transaction: "transactions",
  spans: "spans",
  span: "spans",
  metrics: "metricsEnhanced",
  discover: "discover",
};

/** Canonical dataset names for display */
const VALID_DATASETS = [
  "errors",
  "transactions",
  "spans",
  "metrics",
  "discover",
];

/** Sentry field types that should be right-aligned and formatted as numbers */
const NUMERIC_FIELD_TYPES = new Set([
  "integer",
  "number",
  "duration",
  "percentage",
  "size",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExploreFlags = {
  readonly field: string[];
  readonly dataset: string;
  readonly query?: string;
  readonly sort?: string;
  readonly period: TimeRange;
  readonly limit: number;
  readonly cursor?: string;
  readonly json: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Data yielded by the explore command for both JSON and human output */
type ExploreData = {
  data: Record<string, unknown>[];
  meta?: {
    fields?: Record<string, string>;
    units?: Record<string, string | null>;
  };
  hasMore: boolean;
  hasPrev: boolean;
  nextCursor?: string | null;
  dataset: string;
  org: string;
  /** Project filter, when target was `org/project` */
  project?: string;
  /** The fields the user requested, in their original order — drives column order */
  requestedFields: string[];
};

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

/**
 * Parse and validate dataset flag value.
 * Accepts canonical names and common aliases.
 */
function parseDataset(value: string): string {
  const lower = value.toLowerCase();
  const resolved = DATASET_ALIASES[lower];
  if (!resolved) {
    throw new ValidationError(
      `Invalid dataset "${value}". Must be one of: ${VALID_DATASETS.join(", ")}`,
      "dataset"
    );
  }
  return resolved;
}

/** Parse --limit flag with range validation */
function parseLimit(value: string): number {
  return validateLimit(value, 1, LIST_MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a cell value based on its type metadata.
 *
 * Uses type hints from the API response `meta.fields` to apply appropriate
 * formatting: numbers with grouping, durations with units, etc.
 */
function formatCellValue(
  value: unknown,
  fieldType?: string,
  unit?: string | null
): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "number") {
    if (fieldType === "duration" || fieldType === "size") {
      return appendUnitSuffix(formatNumber(value), unit);
    }
    if (fieldType === "percentage") {
      return `${formatNumber(value * 100)}%`;
    }
    return formatNumber(value);
  }
  return escapeMarkdownCell(String(value));
}

/**
 * Build dynamic table columns from the API response metadata.
 *
 * Each field in the response becomes a column. Numeric fields are right-aligned.
 */
function buildColumns(
  fieldNames: string[],
  fieldTypes?: Record<string, string>,
  fieldUnits?: Record<string, string | null>
): Column<Record<string, unknown>>[] {
  return fieldNames.map((name) => {
    const fieldType = fieldTypes?.[name];
    const unit = fieldUnits?.[name];
    const isNumeric = fieldType ? NUMERIC_FIELD_TYPES.has(fieldType) : false;

    return {
      header: name.toUpperCase(),
      value: (row) => formatCellValue(row[name], fieldType, unit),
      align: isNumeric ? ("right" as const) : ("left" as const),
      truncate: !isNumeric,
    };
  });
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

/**
 * Determine the column order for the table.
 *
 * Preserves the user's `--field` order, then appends any extra fields the
 * API returned that weren't in the request (rare, but possible for derived
 * fields like equations). Falls back to API response keys when no requested
 * fields are available.
 */
function orderFieldNames(
  requestedFields: string[],
  data: ExploreData
): string[] {
  const apiFields = data.meta?.fields
    ? Object.keys(data.meta.fields)
    : Object.keys(data.data[0] ?? {});

  if (requestedFields.length === 0) {
    return apiFields;
  }

  const apiSet = new Set(apiFields);
  const ordered = requestedFields.filter((f) => apiSet.has(f));
  // Append any API-returned fields that weren't requested (preserves API order)
  const requestedSet = new Set(ordered);
  for (const f of apiFields) {
    if (!requestedSet.has(f)) {
      ordered.push(f);
    }
  }
  return ordered;
}

/** Format explore results for human-readable terminal output */
function formatExploreHuman(data: ExploreData): string {
  if (data.data.length === 0) {
    return data.hasMore
      ? "No results on this page."
      : "No results matched the query.";
  }

  const fieldNames = orderFieldNames(data.requestedFields, data);
  const columns = buildColumns(fieldNames, data.meta?.fields, data.meta?.units);

  const scope = data.project ? `${data.org}/${data.project}` : data.org;
  const header = `Querying ${data.dataset} in ${scope}:\n\n`;
  return header + formatTable(data.data, columns);
}

/** Transform explore results for JSON output */
function jsonTransformExplore(data: ExploreData, fields?: string[]): unknown {
  const items =
    fields && fields.length > 0
      ? data.data.map((row) => filterFields(row, fields))
      : data.data;

  const envelope: Record<string, unknown> = {
    data: items,
    meta: data.meta,
    hasMore: data.hasMore,
    hasPrev: data.hasPrev,
    dataset: data.dataset,
  };
  if (
    data.nextCursor !== null &&
    data.nextCursor !== undefined &&
    data.nextCursor !== ""
  ) {
    envelope.nextCursor = data.nextCursor;
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Pagination hints
// ---------------------------------------------------------------------------

/** Append active non-default flags to a base command string */
function appendFlagHints(
  base: string,
  flags: Pick<ExploreFlags, "dataset" | "sort" | "query" | "period" | "field">
): string {
  const parts: string[] = [];
  if (flags.dataset !== DEFAULT_DATASET) {
    parts.push(`--dataset ${flags.dataset}`);
  }
  if (flags.sort) {
    parts.push(`--sort ${flags.sort}`);
  }
  if (flags.query) {
    parts.push(`-q "${flags.query}"`);
  }
  // Include --field flags when non-default
  const fieldList = flags.field ?? [];
  const currentFieldStr = fieldList.join(",");
  if (currentFieldStr !== DEFAULT_FIELDS.join(",") && fieldList.length > 0) {
    for (const f of fieldList) {
      parts.push(`-F "${f}"`);
    }
  }
  appendPeriodHint(parts, flags.period, DEFAULT_PERIOD);
  return parts.length > 0 ? `${base} ${parts.join(" ")}` : base;
}

/**
 * Detect the first aggregate function in the field list.
 * Aggregates contain parentheses, e.g., `count()`, `p50(transaction.duration)`.
 */
function findFirstAggregate(fieldList: string[]): string | undefined {
  return fieldList.find((f) => f.includes("(") && f.includes(")"));
}

// ---------------------------------------------------------------------------
// Org resolution helper — extracted from func() for complexity
// ---------------------------------------------------------------------------

/** Resolved explore target: org slug + optional project filter */
type ExploreTarget = {
  org: string;
  project?: string;
};

/** Usage hint shown when target resolution fails */
const USAGE_HINT = "sentry explore [<org>/[<project>]]";

/**
 * Resolve the explore target to an org slug and optional project filter.
 *
 * Semantics:
 * - `<org>/<project>` → explicit org with project filter (adds `project:slug` to query)
 * - `<org>/` → org-all mode (no project filter)
 * - `<project>` (bare) → fuzzy-search across all orgs for the project
 * - undefined → auto-detect from DSN/config
 */
async function resolveExploreTarget(
  target: string | undefined,
  cwd: string
): Promise<ExploreTarget> {
  const parsed = parseOrgProjectArg(target);

  if (parsed.type === "explicit") {
    return { org: parsed.org, project: parsed.project };
  }
  if (parsed.type === "org-all") {
    return { org: parsed.org };
  }
  if (parsed.type === "project-search") {
    // Bare slug — search across orgs to find the project
    const found = await resolveProjectBySlug(
      parsed.projectSlug,
      USAGE_HINT,
      `sentry explore <org>/${parsed.projectSlug}`,
      parsed.originalSlug
    );
    return { org: found.org, project: found.project };
  }

  // auto-detect: resolve org only
  const resolved = await resolveOrg({ cwd });
  if (!resolved) {
    throw new ContextError("Organization", USAGE_HINT, [
      "SENTRY_ORG environment variable",
      "sentry cli defaults",
    ]);
  }
  return { org: resolved.org };
}

/**
 * Determine the effective sort value, accounting for dataset restrictions.
 * Sort is only supported on the `spans` dataset.
 */
function resolveSort(
  fieldList: string[],
  dataset: string,
  explicitSort?: string
): string | undefined {
  const sort =
    explicitSort ??
    (findFirstAggregate(fieldList)
      ? `-${findFirstAggregate(fieldList)}`
      : undefined);

  if (dataset === "spans") {
    return sort;
  }
  // Warn only when user explicitly passed --sort on a non-spans dataset
  if (sort && explicitSort) {
    log.warn(
      `--sort is only supported on the spans dataset. Ignoring sort for ${dataset}.`
    );
  }
  return;
}

/** Build the result hint string from pagination state and row count */
function buildResultHint(rowCount: number, nav: string): string | undefined {
  if (rowCount === 0 && nav) {
    return `No results on this page. ${nav}`;
  }
  if (rowCount > 0) {
    const countText = `Showing ${rowCount} result${rowCount === 1 ? "" : "s"}.`;
    return nav ? `${countText} ${nav}` : countText;
  }
  return;
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export const exploreCommand = buildListCommand("explore", {
  docs: {
    brief: "Query aggregate event data (Explore)",
    fullDescription:
      "Query the Sentry Explore API for aggregate event data.\n\n" +
      "Supports arbitrary fields including columns (title, project),\n" +
      "aggregates (count(), count_unique(user), p50(transaction.duration)),\n" +
      "and equations. Results are returned as a table.\n\n" +
      "Datasets:\n" +
      "  errors         Error events (default)\n" +
      "  transactions   Transaction events\n" +
      "  spans          Span data\n" +
      "  metrics        Custom metrics (metricsEnhanced)\n" +
      "  discover       Legacy discover dataset\n\n" +
      "Targets:\n" +
      "  <org>/<project>  Filter by project (auto-adds project:<slug> to query)\n" +
      "  <org>/           All projects in org\n" +
      "  <project>        Bare slug — searches across orgs\n" +
      "  (omitted)        Auto-detect from DSN/config\n\n" +
      "Examples:\n" +
      '  sentry explore my-org/cli -F title -F "count()"\n' +
      '  sentry explore my-org/ -F title -F "count()" -F "count_unique(user)" --period 1h\n' +
      "  sentry explore my-org/cli -F transaction " +
      '-F "p50(transaction.duration)" --dataset transactions\n' +
      '  sentry explore -F span.op -F "count()" --dataset spans --period 1h\n' +
      "  sentry explore --json",
  },
  output: {
    human: formatExploreHuman,
    jsonTransform: jsonTransformExplore,
  },
  parameters: {
    positional: {
      kind: "tuple" as const,
      parameters: [
        {
          placeholder: "target",
          brief:
            "Target: <org>/<project>, <org>/, or <project>. Auto-detected if omitted.",
          parse: String,
          optional: true as const,
        },
      ],
    },
    flags: {
      field: {
        kind: "parsed",
        parse: String,
        brief:
          'API field or aggregate (repeatable). E.g., title, "count()", "p50(transaction.duration)"',
        variadic: true,
        optional: true,
      },
      dataset: {
        kind: "parsed",
        parse: parseDataset,
        brief: `Dataset to query (${VALID_DATASETS.join(", ")})`,
        default: DEFAULT_DATASET,
      },
      query: {
        kind: "parsed",
        parse: sanitizeQuery,
        brief: "Search query (Sentry search syntax)",
        optional: true,
      },
      sort: {
        kind: "parsed",
        parse: String,
        brief: 'Sort field (prefix with - for desc, e.g., "-count()")',
        optional: true,
      },
      limit: {
        kind: "parsed",
        parse: parseLimit,
        brief: `Number of rows (1-${LIST_MAX_LIMIT})`,
        default: "25",
      },
      period: {
        kind: "parsed" as const,
        parse: parsePeriod,
        brief: PERIOD_BRIEF,
        default: DEFAULT_PERIOD,
      },
    },
    aliases: {
      ...PERIOD_ALIASES,
      F: "field",
      d: "dataset",
      q: "query",
      s: "sort",
      n: "limit",
    },
  },
  async *func(this: SentryContext, flags: ExploreFlags, target?: string) {
    const { cwd } = this;
    const { org, project } = await resolveExploreTarget(target, cwd);

    const fieldList =
      flags.field && flags.field.length > 0 ? flags.field : DEFAULT_FIELDS;
    const dataset = flags.dataset;
    const timeRange = flags.period;
    const effectiveSort = resolveSort(fieldList, dataset, flags.sort);

    // When a project is in the target, prepend `project:<slug>` to the query
    // so the API filters server-side. Mirrors `trace logs` / `log list` behavior.
    const apiQuery = buildProjectQuery(flags.query, project);

    // Pagination context includes project so different scopes don't share state
    const contextKey = buildPaginationContextKey(
      "explore",
      project ? `${org}/${project}` : org,
      {
        dataset,
        fields: fieldList.join(","),
        q: flags.query,
        sort: effectiveSort,
        period: serializeTimeRange(timeRange),
      }
    );
    const { cursor, direction } = resolveCursor(
      flags.cursor,
      PAGINATION_KEY,
      contextKey
    );

    const { data: response, nextCursor } = await withProgress(
      {
        message: `Querying ${dataset} in ${project ? `${org}/${project}` : org}...`,
        json: flags.json,
      },
      () =>
        queryEvents(org, {
          fields: fieldList,
          dataset,
          query: apiQuery,
          sort: effectiveSort,
          limit: flags.limit,
          cursor,
          ...timeRangeToApiParams(timeRange),
        })
    );

    advancePaginationState(PAGINATION_KEY, contextKey, direction, nextCursor);
    const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);
    const hasMore = !!nextCursor;

    // Pagination hints preserve the original target shape (org/ vs org/project)
    const baseTarget = project ? `${org}/${project}` : `${org}/`;
    const nav = paginationHint({
      hasPrev,
      hasMore,
      prevHint: appendFlagHints(`sentry explore ${baseTarget} -c prev`, flags),
      nextHint: appendFlagHints(`sentry explore ${baseTarget} -c next`, flags),
    });

    const hint = buildResultHint(response.data.length, nav);

    yield new CommandOutput({
      data: response.data,
      meta: response.meta,
      hasMore,
      hasPrev,
      nextCursor,
      dataset,
      org,
      project,
      requestedFields: fieldList,
    });
    return { hint };
  },
});
