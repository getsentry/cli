/**
 * Trace, Transaction, and Span API functions
 *
 * Functions for retrieving detailed traces, listing transactions, and listing spans.
 */

import pLimit from "p-limit";

import {
  type SpanListItem,
  type SpansResponse,
  SpansResponseSchema,
  type TraceSpan,
  type TransactionListItem,
  type TransactionsResponse,
  TransactionsResponseSchema,
} from "../../types/index.js";

import { logger } from "../logger.js";
import { resolveOrgRegion } from "../region.js";
import { isAllDigits } from "../utils.js";

import {
  apiRequestToRegion,
  type PaginatedResponse,
  parseLinkHeader,
} from "./infrastructure.js";

const log = logger.withTag("api.traces");

// ---------------------------------------------------------------------------
// Trace item (span) detail types
// ---------------------------------------------------------------------------

/**
 * Attribute names from the trace-items detail endpoint that duplicate
 * fields already shown in the standard span output (KV table, JSON core
 * fields) or are EAP storage internals with no diagnostic value.
 *
 * Shared between `span view` (JSON `data` dict) and `formatSpanDetails`
 * (human KV rows) to keep filtering consistent.
 */
export const REDUNDANT_DETAIL_ATTRS = new Set([
  // Timing / storage internals
  "precise.start_ts",
  "precise.finish_ts",
  "received",
  "hash",
  "project_id",
  "client_sample_rate",
  "server_sample_rate",
  // Already shown in standard span fields
  "is_transaction",
  "span.duration",
  "span.self_time",
  "span.op",
  "span.name",
  "span.description",
  "span.category",
  "parent_span",
  "transaction",
  "transaction.op",
  "transaction.event_id",
  "transaction.span_id",
  "trace",
  "trace.status",
  "segment.name",
  "origin",
  "platform",
  "sdk.name",
  "sdk.version",
  "environment",
]);

/** A single attribute returned by the trace-items detail endpoint */
export type TraceItemAttribute = {
  name: string;
  type: "str" | "int" | "float" | "bool";
  value: string | number | boolean;
};

/** Response from GET /projects/{org}/{project}/trace-items/{itemId}/ */
export type TraceItemDetail = {
  itemId: string;
  timestamp: string;
  attributes: TraceItemAttribute[];
  meta: Record<string, unknown>;
  links: unknown;
};

/**
 * Get detailed trace with nested children structure.
 * This is an internal endpoint not covered by the public API.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug
 * @param traceId - The trace ID (from event.contexts.trace.trace_id)
 * @param timestamp - Unix timestamp (seconds) from the event's dateCreated
 * @param additionalAttributes - Extra attribute names to include on each span
 *   (passed as repeated `additional_attributes` query params to the API)
 * @returns Array of root spans with nested children
 */
export async function getDetailedTrace(
  orgSlug: string,
  traceId: string,
  timestamp: number,
  additionalAttributes?: string[]
): Promise<TraceSpan[]> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data } = await apiRequestToRegion<TraceSpan[]>(
    regionUrl,
    `/organizations/${orgSlug}/trace/${traceId}/`,
    {
      params: {
        timestamp,
        limit: 10_000,
        project: -1,
        additional_attributes: additionalAttributes,
      },
    }
  );
  return data.map(normalizeTraceSpan);
}

/**
 * Fetch full attribute details for a single span.
 *
 * Uses the trace-items detail endpoint which returns ALL span attributes
 * without requiring the caller to enumerate them. This is the same endpoint
 * the Sentry frontend uses in the span detail sidebar.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug
 * @param spanId - The 16-char hex span ID
 * @param traceId - The parent trace ID (required for lookup)
 * @returns Full span detail with all attributes
 */
export async function getSpanDetails(
  orgSlug: string,
  projectSlug: string,
  spanId: string,
  traceId: string
): Promise<TraceItemDetail> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data } = await apiRequestToRegion<TraceItemDetail>(
    regionUrl,
    `/projects/${orgSlug}/${projectSlug}/trace-items/${spanId}/`,
    {
      params: {
        trace_id: traceId,
        item_type: "spans",
      },
    }
  );
  return data;
}

// ---------------------------------------------------------------------------
// Shared span detail helpers
// ---------------------------------------------------------------------------

/** Concurrency for parallel detail fetches (shared between trace/span view) */
const SPAN_DETAIL_CONCURRENCY = 15;

/**
 * Convert a trace-items attribute array into a key-value dict,
 * filtering out attributes already shown in the standard span fields
 * and EAP storage internals (tags[], precise timestamps, etc.).
 */
export function attributesToDict(
  attributes: TraceItemDetail["attributes"]
): Record<string, unknown> {
  return Object.fromEntries(
    attributes
      .filter(
        (a) =>
          !(REDUNDANT_DETAIL_ATTRS.has(a.name) || a.name.startsWith("tags["))
      )
      .map((a) => [a.name, a.value])
  );
}

/** Options for {@link fetchMultiSpanDetails} */
export type FetchMultiSpanDetailsOptions = {
  /** Organization slug */
  org: string;
  /** Project slug to use when a span has no project_slug */
  fallbackProject: string;
  /** The parent trace ID (required by the API) */
  traceId: string;
  /** Callback fired after each successful fetch for progress reporting */
  onProgress?: (done: number, total: number) => void;
};

/**
 * Fetch full attribute details for multiple spans in parallel.
 *
 * Uses p-limit to cap concurrency at {@link SPAN_DETAIL_CONCURRENCY}.
 * Failures for individual spans are logged as warnings — callers
 * still get partial results for the spans that succeeded.
 *
 * @param spans - Spans to fetch details for (must have span_id and optionally project_slug)
 * @param options - Org, project, traceId, and optional progress callback
 * @returns Map of span_id to detail
 */
export async function fetchMultiSpanDetails(
  spans: Array<{ span_id: string; project_slug?: string }>,
  options: FetchMultiSpanDetailsOptions
): Promise<Map<string, TraceItemDetail>> {
  const { org, fallbackProject, traceId, onProgress } = options;
  const limit = pLimit(SPAN_DETAIL_CONCURRENCY);
  const details = new Map<string, TraceItemDetail>();
  let completed = 0;
  const total = spans.length;

  await limit.map(spans, async (span) => {
    try {
      const detail = await getSpanDetails(
        org,
        span.project_slug || fallbackProject,
        span.span_id,
        traceId
      );
      details.set(span.span_id, detail);
    } catch {
      log.warn(`Could not fetch details for span ${span.span_id}`);
    }
    completed += 1;
    onProgress?.(completed, total);
  });

  return details;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * The trace detail API (`/trace/{id}/`) returns each span's unique identifier
 * as `event_id` rather than `span_id`. The value is the same 16-hex-char span
 * ID that `parent_span_id` references on child spans. We copy it to `span_id`
 * so the rest of the codebase can use a single, predictable field name.
 */
export function normalizeTraceSpan(span: TraceSpan): TraceSpan {
  const normalized = { ...span };
  if (!normalized.span_id && normalized.event_id) {
    normalized.span_id = normalized.event_id;
  }
  if (normalized.children) {
    normalized.children = normalized.children.map(normalizeTraceSpan);
  }
  return normalized;
}

/** Fields to request from the transactions API */
const TRANSACTION_FIELDS = [
  "trace",
  "id",
  "transaction",
  "timestamp",
  "transaction.duration",
  "project",
];

type ListTransactionsOptions = {
  /** Search query using Sentry query syntax */
  query?: string;
  /** Maximum number of transactions to return */
  limit?: number;
  /** Sort order: "date" (newest first) or "duration" (slowest first) */
  sort?: "date" | "duration";
  /** Time period for transactions (e.g., "7d", "24h") */
  statsPeriod?: string;
  /** Pagination cursor to resume from a previous page */
  cursor?: string;
  /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  start?: string;
  /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  end?: string;
};

/**
 * List recent transactions for a project.
 * Uses the Explore/Events API with dataset=transactions.
 *
 * Handles project slug vs numeric ID automatically:
 * - Numeric IDs are passed as the `project` parameter
 * - Slugs are added to the query string as `project:{slug}`
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug or numeric ID
 * @param options - Query options (query, limit, sort, statsPeriod, cursor)
 * @returns Paginated response with transaction items and optional next cursor
 */
export async function listTransactions(
  orgSlug: string,
  projectSlug: string,
  options: ListTransactionsOptions = {}
): Promise<PaginatedResponse<TransactionListItem[]>> {
  const isNumericProject = isAllDigits(projectSlug);
  const projectFilter = isNumericProject ? "" : `project:${projectSlug}`;
  const fullQuery = [projectFilter, options.query].filter(Boolean).join(" ");

  const regionUrl = await resolveOrgRegion(orgSlug);

  // Use raw request: the SDK's dataset type doesn't include "transactions"
  const { data: response, headers } =
    await apiRequestToRegion<TransactionsResponse>(
      regionUrl,
      `/organizations/${orgSlug}/events/`,
      {
        params: {
          dataset: "transactions",
          field: TRANSACTION_FIELDS,
          project: isNumericProject ? projectSlug : undefined,
          // Convert empty string to undefined so ky omits the param entirely;
          // sending `query=` causes the Sentry API to behave differently than
          // omitting the parameter.
          query: fullQuery || undefined,
          per_page: options.limit || 10,
          statsPeriod:
            options.start || options.end
              ? undefined
              : (options.statsPeriod ?? "7d"),
          start: options.start,
          end: options.end,
          sort:
            options.sort === "duration"
              ? "-transaction.duration"
              : "-timestamp",
          cursor: options.cursor,
        },
        schema: TransactionsResponseSchema,
      }
    );

  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data: response.data, nextCursor };
}

// Span listing

/** Fields to request from the spans API */
const SPAN_FIELDS = [
  "id",
  "parent_span",
  "span.op",
  "description",
  "span.duration",
  "timestamp",
  "project",
  "transaction",
  "trace",
];

/** Sort values for span listing: newest first or slowest first */
export type SpanSortValue = "date" | "duration";

type ListSpansOptions = {
  /** Search query using Sentry query syntax */
  query?: string;
  /** Maximum number of spans to return */
  limit?: number;
  /** Sort order */
  sort?: SpanSortValue;
  /** Time period for spans (e.g., "7d", "24h") */
  statsPeriod?: string;
  /** Pagination cursor to resume from a previous page */
  cursor?: string;
  /** Additional field names to request from the API beyond SPAN_FIELDS */
  extraFields?: string[];
  /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  start?: string;
  /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  end?: string;
};

/**
 * List spans using the EAP spans search endpoint.
 * Uses the Explore/Events API with dataset=spans.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug or numeric ID
 * @param options - Query options (query, limit, sort, statsPeriod, cursor)
 * @returns Paginated response with span items and optional next cursor
 */
export async function listSpans(
  orgSlug: string,
  projectSlug: string,
  options: ListSpansOptions = {}
): Promise<PaginatedResponse<SpanListItem[]>> {
  const isNumericProject = isAllDigits(projectSlug);
  const projectFilter = isNumericProject ? "" : `project:${projectSlug}`;
  const fullQuery = [projectFilter, options.query].filter(Boolean).join(" ");

  const fields = options.extraFields?.length
    ? SPAN_FIELDS.concat(options.extraFields)
    : SPAN_FIELDS;

  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data: response, headers } = await apiRequestToRegion<SpansResponse>(
    regionUrl,
    `/organizations/${orgSlug}/events/`,
    {
      params: {
        dataset: "spans",
        field: fields,
        project: isNumericProject ? projectSlug : undefined,
        query: fullQuery || undefined,
        per_page: options.limit || 10,
        statsPeriod:
          options.start || options.end
            ? undefined
            : (options.statsPeriod ?? "7d"),
        start: options.start,
        end: options.end,
        sort: options.sort === "duration" ? "-span.duration" : "-timestamp",
        cursor: options.cursor,
      },
      schema: SpansResponseSchema,
    }
  );

  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data: response.data, nextCursor };
}
