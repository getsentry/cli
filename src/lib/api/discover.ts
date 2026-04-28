/**
 * Sentry Explore/Discover API — aggregate event queries.
 *
 * Wraps `GET /organizations/{org}/events/` with user-specified fields, dataset,
 * query, sort, and time range. This is the same endpoint used by the Sentry
 * Explore UI for arbitrary event queries with aggregation support.
 */

import type { EventsTableResponse } from "../../types/dashboard.js";
import { EventsTableResponseSchema } from "../../types/dashboard.js";
import { resolveOrgRegion } from "../region.js";
import {
  apiRequestToRegion,
  type PaginatedResponse,
  parseLinkHeader,
} from "./infrastructure.js";

/** Options for querying the Explore/Events endpoint. */
export type ExploreQueryOptions = {
  /** Fields to request — columns, aggregates, or equations */
  fields: string[];
  /** Dataset to query: errors, transactions, spans, discover */
  dataset?: string;
  /** Sentry search query filter */
  query?: string;
  /**
   * Sort field. Prefix with `-` for descending.
   * Only supported on the `spans` dataset — other datasets reject it with 400.
   */
  sort?: string;
  /** Maximum number of rows to return */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
  /** Relative time period (e.g., "24h", "7d"). Mutually exclusive with start/end. */
  statsPeriod?: string;
  /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  start?: string;
  /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  end?: string;
};

/**
 * Query the Explore/Events endpoint for aggregate or tabular event data.
 *
 * Calls `GET /organizations/{org}/events/` with the specified fields, dataset,
 * query, sort, and time range. Supports all standard Sentry Explore fields
 * including aggregates like `count()`, `count_unique(user)`, `p50(transaction.duration)`.
 *
 * @param orgSlug - Organization slug
 * @param options - Query options
 * @returns Paginated response with tabular data and field metadata
 */
export async function queryEvents(
  orgSlug: string,
  options: ExploreQueryOptions
): Promise<PaginatedResponse<EventsTableResponse>> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data, headers } = await apiRequestToRegion<EventsTableResponse>(
    regionUrl,
    `/organizations/${orgSlug}/events/`,
    {
      params: {
        dataset: options.dataset ?? "errors",
        field: options.fields,
        query: options.query || undefined,
        sort: options.sort || undefined,
        per_page: options.limit ?? 25,
        statsPeriod:
          options.start || options.end
            ? undefined
            : (options.statsPeriod ?? "24h"),
        start: options.start,
        end: options.end,
        cursor: options.cursor,
      },
      schema: EventsTableResponseSchema,
    }
  );

  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data, nextCursor };
}
