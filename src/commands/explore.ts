/**
 * sentry explore
 *
 * Query aggregate event data using the Sentry Explore/Events API.
 * Supports arbitrary fields, aggregates, and datasets for spike analysis
 * and ad-hoc event queries.
 */

import type { SentryContext } from "../context.js";
import {
  isReplaySortValue,
  listReplays,
  queryEvents,
  type ReplaySortValue,
} from "../lib/api-client.js";
import { buildProjectQuery, validateLimit } from "../lib/arg-parsing.js";
import {
  advancePaginationState,
  buildPaginationContextKey,
  hasPreviousPage,
  resolveCursor,
} from "../lib/db/pagination.js";
import { ValidationError } from "../lib/errors.js";
import { filterFields } from "../lib/formatters/json.js";
import { buildMetaColumns } from "../lib/formatters/meta-table.js";
import { CommandOutput } from "../lib/formatters/output.js";
import { formatTable } from "../lib/formatters/table.js";
import {
  appendQueryHint,
  appendSortHint,
  buildListCommand,
  LIST_MAX_LIMIT,
  PERIOD_ALIASES,
  paginationHint,
} from "../lib/list-command.js";
import { logger } from "../lib/logger.js";
import { withProgress } from "../lib/polling.js";
import {
  DEFAULT_REPLAY_EXPLORE_FIELDS,
  getReplayFieldValue,
  getReplayRequestFields,
  isSupportedReplayField,
  listSupportedReplayFields,
  parseReplayEnvironmentFilter,
} from "../lib/replay-search.js";
import { resolveOrgOptionalProjectFromArg } from "../lib/resolve-target.js";
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
const DEFAULT_REPLAY_SORT = "-started_at";

/** Default time period */
const DEFAULT_PERIOD = "24h";

/** Command key for pagination cursor storage */
const PAGINATION_KEY = "explore";

/**
 * Dataset aliases: user-facing name → API-level dataset name.
 *
 * All entries are accepted as `--dataset` values. `VALID_DATASETS` controls
 * which appear in `--help` and validation error messages.
 */
const DATASET_ALIASES: Record<string, string> = {
  errors: "errors",
  error: "errors",
  spans: "spans",
  span: "spans",
  metrics: "metricsEnhanced",
  logs: "logs",
  log: "logs",
  replays: "replays",
  replay: "replays",
  // Deprecated but still functional — hidden from help
  transactions: "transactions",
  transaction: "transactions",
  discover: "discover",
};

/**
 * User-facing dataset names shown in `--help` and validation errors.
 * Deprecated datasets (transactions, discover) are omitted from the display
 * list but still work as `--dataset` values via `DATASET_ALIASES`.
 *
 * Set preserves insertion order for the join-based help/error rendering.
 */
const VALID_DATASETS = new Set([
  "errors",
  "spans",
  "metrics",
  "logs",
  "replays",
]);

/**
 * Reverse map from API-level dataset name → canonical user-facing name.
 * Used by pagination hints so they emit `--dataset metrics` not `--dataset metricsEnhanced`.
 */
const API_TO_USER_DATASET = new Map(
  Array.from(VALID_DATASETS, (name) => [DATASET_ALIASES[name] ?? name, name])
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExploreFlags = {
  readonly field?: string[];
  readonly dataset: string;
  readonly environment?: readonly string[];
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
      `Invalid dataset "${value}". Must be one of: ${[...VALID_DATASETS].join(", ")}`,
      "dataset"
    );
  }
  return resolved;
}

/**
 * Parse --limit flag. Capped at {@link LIST_MAX_LIMIT} (1000).
 * `queryEvents` auto-paginates when the limit exceeds the API's per-page cap.
 */
function parseLimit(value: string): number {
  return validateLimit(value, 1, LIST_MAX_LIMIT);
}

function inferReplayFieldType(field: string): string {
  if (field === "duration") {
    return "duration";
  }
  if (field === "activity" || field.startsWith("count_")) {
    return "integer";
  }
  return "string";
}

function buildReplayExploreResponse(
  fields: string[],
  replays: Awaited<ReturnType<typeof listReplays>>["data"]
): { data: Record<string, unknown>[]; meta: NonNullable<ExploreData["meta"]> } {
  return {
    data: replays.map((replay) =>
      Object.fromEntries(
        fields.map((field) => [field, getReplayFieldValue(replay, field)])
      )
    ),
    meta: {
      fields: Object.fromEntries(
        fields.map((field) => [field, inferReplayFieldType(field)])
      ),
      units: Object.fromEntries(
        fields.map((field) => [field, field === "duration" ? "s" : null])
      ),
    },
  };
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
    // Empty page mid-pagination (more or prev pages exist) vs. truly no results.
    return data.hasMore || data.hasPrev
      ? "No results on this page."
      : "No results matched the query.";
  }

  const fieldNames = orderFieldNames(data.requestedFields, data);
  const columns = buildMetaColumns(
    fieldNames,
    data.meta?.fields,
    data.meta?.units
  );

  const scope = data.project ? `${data.org}/${data.project}` : data.org;
  const displayDataset = API_TO_USER_DATASET.get(data.dataset) ?? data.dataset;
  const header = `Querying ${displayDataset} in ${scope}:\n\n`;
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

/** Default limit value matching the flag default for hint comparison */
const DEFAULT_LIMIT = 25;

function defaultFieldsForDataset(dataset: string): readonly string[] {
  return dataset === "replays" ? DEFAULT_REPLAY_EXPLORE_FIELDS : DEFAULT_FIELDS;
}

/** Append active non-default flags to a base command string */
function appendFlagHints(
  base: string,
  flags: Pick<
    ExploreFlags,
    "dataset" | "environment" | "sort" | "query" | "period" | "field" | "limit"
  >
): string {
  const parts: string[] = [];
  const defaultSort =
    flags.dataset === "replays" ? DEFAULT_REPLAY_SORT : undefined;
  if (flags.dataset !== DEFAULT_DATASET) {
    // Emit user-facing name, not API-level name (e.g. "metrics" not "metricsEnhanced")
    const displayDataset =
      API_TO_USER_DATASET.get(flags.dataset) ?? flags.dataset;
    parts.push(`--dataset ${displayDataset}`);
  }
  appendSortHint(parts, flags.sort, defaultSort);
  appendQueryHint(parts, flags.query);
  // Include --field flags when non-default
  const fieldList = flags.field ?? [];
  const currentFieldStr = fieldList.join(",");
  if (
    currentFieldStr !== defaultFieldsForDataset(flags.dataset).join(",") &&
    fieldList.length > 0
  ) {
    for (const f of fieldList) {
      parts.push(`-F "${f}"`);
    }
  }
  if (flags.limit !== DEFAULT_LIMIT) {
    parts.push(`--limit ${flags.limit}`);
  }
  if (flags.environment && flags.environment.length > 0) {
    for (const environment of flags.environment) {
      parts.push(`-e "${environment}"`);
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

/** Validate and normalize replay sort values. */
function resolveReplaySort(explicitSort?: string): ReplaySortValue {
  const sort = explicitSort ?? DEFAULT_REPLAY_SORT;
  if (!isReplaySortValue(sort)) {
    throw new ValidationError(
      `Invalid replay sort "${sort}". Use a replay sort like ${DEFAULT_REPLAY_SORT} or -count_errors.`,
      "sort"
    );
  }
  return sort;
}

/**
 * Determine the effective sort value for non-replay explore datasets.
 * Sort is only supported on the `spans` dataset.
 */
function resolveExploreSort(
  fieldList: string[],
  dataset: string,
  explicitSort?: string
): string | undefined {
  const firstAgg = findFirstAggregate(fieldList);
  const sort = explicitSort ?? (firstAgg ? `-${firstAgg}` : undefined);

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
    return nav;
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
      "  errors   Error events (default)\n" +
      "  spans    Span data\n" +
      "  metrics  Custom metrics\n" +
      "  logs     Log entries\n" +
      "  replays  Session replay search\n\n" +
      "Targets:\n" +
      "  <org>/<project>  Filter by project (auto-adds project:<slug> to query)\n" +
      "  <org>/           All projects in org\n" +
      "  <project>        Bare slug — searches across orgs\n" +
      "  (omitted)        Auto-detect from DSN/config\n\n" +
      "Examples:\n" +
      '  sentry explore my-org/cli -F title -F "count()"\n' +
      '  sentry explore my-org/ -F title -F "count()" -F "count_unique(user)" --period 1h\n' +
      '  sentry explore my-org/cli -F span.op -F "p50(span.duration)" ' +
      "--dataset spans\n" +
      "  sentry explore my-org/cli --dataset replays -F id -F user.email -F count_errors\n" +
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
        brief: `Dataset to query (${[...VALID_DATASETS].join(", ")})`,
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
      environment: {
        kind: "parsed",
        parse: String,
        brief:
          "Replay environment filter for --dataset replays (repeatable, comma-separated)",
        variadic: true,
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
      e: "environment",
      F: "field",
      d: "dataset",
      q: "query",
      s: "sort",
      n: "limit",
    },
  },
  async *func(this: SentryContext, flags: ExploreFlags, target?: string) {
    const { cwd } = this;
    const { org, project } = await resolveOrgOptionalProjectFromArg(
      target,
      cwd,
      "explore"
    );

    const dataset = flags.dataset;
    let fieldList = [...defaultFieldsForDataset(dataset)];
    if (flags.field && flags.field.length > 0) {
      fieldList = flags.field;
    }
    const timeRange = flags.period;
    const environment = parseReplayEnvironmentFilter(flags.environment);
    const replaySort =
      dataset === "replays" ? resolveReplaySort(flags.sort) : undefined;
    const eventSort =
      dataset === "replays"
        ? undefined
        : resolveExploreSort(fieldList, dataset, flags.sort);
    const paginationSort = dataset === "replays" ? replaySort : eventSort;

    if (dataset !== "replays" && environment) {
      throw new ValidationError(
        "--environment is only supported with --dataset replays. Use environment:... inside --query for other datasets.",
        "environment"
      );
    }

    if (dataset === "replays") {
      const unsupportedField = fieldList.find(
        (field) => !isSupportedReplayField(field)
      );
      if (unsupportedField) {
        throw new ValidationError(
          `Unsupported replay field "${unsupportedField}". Supported fields include: ${listSupportedReplayFields().slice(0, 12).join(", ")}...`,
          "field"
        );
      }
    }

    // When a project is in the target, prepend `project:<slug>` to the query
    // so the API filters server-side. Mirrors `trace logs` / `log list` behavior.
    const apiQuery = buildProjectQuery(flags.query, project);

    // Pagination context includes project so different scopes don't share state
    const contextKey = buildPaginationContextKey(
      "explore",
      project ? `${org}/${project}` : org,
      {
        dataset,
        env: environment?.join(","),
        fields: fieldList.join(","),
        q: flags.query,
        sort: paginationSort,
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
      async () => {
        if (dataset === "replays") {
          const replayResponse = await listReplays(org, {
            cursor,
            environment,
            fields: getReplayRequestFields(fieldList),
            limit: flags.limit,
            projectSlugs: project ? [project] : undefined,
            query: apiQuery,
            sort: replaySort,
            ...timeRangeToApiParams(timeRange),
          });

          return {
            data: buildReplayExploreResponse(fieldList, replayResponse.data),
            nextCursor: replayResponse.nextCursor,
          };
        }

        return queryEvents(org, {
          fields: fieldList,
          dataset,
          query: apiQuery,
          sort: eventSort,
          limit: flags.limit,
          cursor,
          ...timeRangeToApiParams(timeRange),
        });
      }
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
