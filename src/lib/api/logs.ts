/**
 * Log API functions
 *
 * Functions for listing and retrieving Sentry log entries,
 * including trace-associated logs.
 */

import { queryExploreEventsInTableFormat } from "@sentry/api";

import {
  DetailedLogsResponseSchema,
  type DetailedSentryLog,
  LogsResponseSchema,
  type SentryLog,
  type TraceLog,
  TraceLogsResponseSchema,
} from "../../types/index.js";

import { resolveOrgRegion } from "../region.js";
import { LOG_RETENTION_PERIOD } from "../retention.js";
import { isAllDigits } from "../utils.js";

import {
  API_MAX_PER_PAGE,
  apiRequestToRegion,
  getOrgSdkConfig,
  unwrapResult,
} from "./infrastructure.js";

/** Sort direction for log queries: newest-first or oldest-first. */
export type LogSortDirection = "newest" | "oldest";

/** Map CLI sort direction to Sentry API sort parameter. */
function toApiSort(sort: LogSortDirection | undefined): string {
  return sort === "oldest" ? "timestamp" : "-timestamp";
}

/** Fields to request from the logs API */
const LOG_FIELDS = [
  "sentry.item_id",
  "trace",
  "severity",
  "timestamp",
  "timestamp_precise",
  "message",
];

type ListLogsOptions = {
  /** Search query using Sentry query syntax */
  query?: string;
  /** Maximum number of log entries to return */
  limit?: number;
  /**
   * Time period for logs (e.g., "30d", "14d", "10m").
   * Defaults to "30d" — the maximum log retention period.
   * Periods >30d hit a degraded API path returning stale/incomplete data.
   */
  statsPeriod?: string;
  /** Sort direction: "newest" (default) or "oldest" */
  sort?: LogSortDirection;
  /** Only return logs after this timestamp_precise value (for streaming) */
  afterTimestamp?: number;
  /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  start?: string;
  /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  end?: string;
};

/**
 * List logs for an organization/project.
 * Uses the Explore/Events API with dataset=logs.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug or numeric ID
 * @param options - Query options (query, limit, statsPeriod)
 * @returns Array of log entries
 */
export async function listLogs(
  orgSlug: string,
  projectSlug: string,
  options: ListLogsOptions = {}
): Promise<SentryLog[]> {
  const isNumericProject = isAllDigits(projectSlug);

  const projectFilter = isNumericProject ? "" : `project:${projectSlug}`;
  const timestampFilter = options.afterTimestamp
    ? `timestamp_precise:>${options.afterTimestamp}`
    : "";

  const fullQuery = [projectFilter, options.query, timestampFilter]
    .filter(Boolean)
    .join(" ");

  const config = await getOrgSdkConfig(orgSlug);

  const result = await queryExploreEventsInTableFormat({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    query: {
      dataset: "logs",
      field: LOG_FIELDS,
      project: isNumericProject ? [Number(projectSlug)] : undefined,
      query: fullQuery || undefined,
      per_page: options.limit || API_MAX_PER_PAGE,
      statsPeriod:
        options.start || options.end
          ? undefined
          : (options.statsPeriod ?? "30d"),
      start: options.start,
      end: options.end,
      sort: toApiSort(options.sort),
    },
  });

  const data = unwrapResult(result, "Failed to list logs");
  const logsResponse = LogsResponseSchema.parse(data);
  return logsResponse.data;
}

/** All fields to request for detailed log view */
const DETAILED_LOG_FIELDS = [
  "sentry.item_id",
  "timestamp",
  "timestamp_precise",
  "message",
  "severity",
  "trace",
  "project",
  "environment",
  "release",
  "sdk.name",
  "sdk.version",
  "span_id",
  "code.function",
  "code.file.path",
  "code.line.number",
  "sentry.otel.kind",
  "sentry.otel.status_code",
  "sentry.otel.instrumentation_scope.name",
];

/**
 * Fetch a single batch of log entries by their item IDs.
 * Batch size must not exceed {@link API_MAX_PER_PAGE}.
 */
async function getLogsBatch(
  orgSlug: string,
  projectSlug: string,
  batchIds: string[],
  config: Awaited<ReturnType<typeof getOrgSdkConfig>>
): Promise<DetailedSentryLog[]> {
  const query = `project:${projectSlug} sentry.item_id:[${batchIds.join(",")}]`;

  const result = await queryExploreEventsInTableFormat({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    query: {
      dataset: "logs",
      field: DETAILED_LOG_FIELDS,
      query,
      per_page: batchIds.length,
      statsPeriod: LOG_RETENTION_PERIOD,
    },
  });

  const data = unwrapResult(result, "Failed to get log");
  const logsResponse = DetailedLogsResponseSchema.parse(data);
  return logsResponse.data;
}

/**
 * Get one or more log entries by their item IDs.
 * Uses the Explore/Events API with dataset=logs and a filter query.
 * Bracket syntax (`sentry.item_id:[id1,id2,...]`) works for any count including one.
 *
 * When more than {@link API_MAX_PER_PAGE} IDs are requested, the fetch is
 * split into batches to avoid silent API truncation.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug for filtering
 * @param logIds - One or more sentry.item_id values to fetch
 * @returns Array of matching detailed log entries (may be shorter than logIds if some weren't found)
 */
export async function getLogs(
  orgSlug: string,
  projectSlug: string,
  logIds: string[]
): Promise<DetailedSentryLog[]> {
  const config = await getOrgSdkConfig(orgSlug);

  // Single batch — no splitting needed
  if (logIds.length <= API_MAX_PER_PAGE) {
    return getLogsBatch(orgSlug, projectSlug, logIds, config);
  }

  // Split into batches of API_MAX_PER_PAGE and fetch in parallel
  const batches: string[][] = [];
  for (let i = 0; i < logIds.length; i += API_MAX_PER_PAGE) {
    batches.push(logIds.slice(i, i + API_MAX_PER_PAGE));
  }

  const results = await Promise.all(
    batches.map((batch) => getLogsBatch(orgSlug, projectSlug, batch, config))
  );

  return results.flat();
}

type ListTraceLogsOptions = {
  /** Additional search query to filter results (Sentry query syntax) */
  query?: string;
  /** Maximum number of log entries to return (max 9999) */
  limit?: number;
  /**
   * Time period to search in (e.g., "14d", "7d", "24h").
   * Required by the API — without it the response may be empty even when
   * logs exist for the trace. Defaults to "14d".
   */
  statsPeriod?: string;
  /** Sort direction: "newest" (default) or "oldest" */
  sort?: LogSortDirection;
  /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  start?: string;
  /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  end?: string;
};

/**
 * List logs associated with a specific trace.
 *
 * Uses the dedicated `/organizations/{org}/trace-logs/` endpoint, which is
 * org-scoped and automatically queries all projects in the org. This is
 * distinct from the Explore/Events logs endpoint (`/events/?dataset=logs`)
 * which does not support filtering by trace ID in query syntax.
 *
 * `statsPeriod` defaults to `"14d"`. Without a stats period the API may
 * return empty results even when logs exist for the trace.
 *
 * @param orgSlug - Organization slug
 * @param traceId - The 32-character hex trace ID
 * @param options - Optional query/limit/statsPeriod/sort overrides
 * @returns Array of trace log entries
 */
export async function listTraceLogs(
  orgSlug: string,
  traceId: string,
  options: ListTraceLogsOptions = {}
): Promise<TraceLog[]> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data: response } = await apiRequestToRegion<{ data: TraceLog[] }>(
    regionUrl,
    `/organizations/${orgSlug}/trace-logs/`,
    {
      params: {
        traceId,
        statsPeriod:
          options.start || options.end
            ? undefined
            : (options.statsPeriod ?? "14d"),
        start: options.start,
        end: options.end,
        per_page: options.limit ?? API_MAX_PER_PAGE,
        query: options.query,
        sort: toApiSort(options.sort),
      },
      schema: TraceLogsResponseSchema,
    }
  );

  return response.data;
}
