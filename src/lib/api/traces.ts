/**
 * Trace, Transaction, and Span API functions
 *
 * Functions for retrieving detailed traces, listing transactions, and listing spans.
 */

import {
  type SpanListItem,
  type SpansResponse,
  SpansResponseSchema,
  type TraceSpan,
  type TransactionListItem,
  type TransactionsResponse,
  TransactionsResponseSchema,
} from "../../types/index.js";

import { resolveOrgRegion } from "../region.js";
import { isAllDigits } from "../utils.js";

import {
  apiRequestToRegion,
  type PaginatedResponse,
  parseLinkHeader,
} from "./infrastructure.js";

// ---------------------------------------------------------------------------
// Trace item (span) detail types
// ---------------------------------------------------------------------------

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
          statsPeriod: options.statsPeriod ?? "7d",
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
    ? [...SPAN_FIELDS, ...options.extraFields]
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
        statsPeriod: options.statsPeriod ?? "7d",
        sort: options.sort === "duration" ? "-span.duration" : "-timestamp",
        cursor: options.cursor,
      },
      schema: SpansResponseSchema,
    }
  );

  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data: response.data, nextCursor };
}
