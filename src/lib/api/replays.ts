/**
 * Replay API functions
 *
 * Functions for listing and retrieving Session Replays.
 */

import {
  REPLAY_LIST_FIELDS,
  ReplayDetailsResponseSchema,
  type ReplayDetails,
  ReplayListResponseSchema,
  type ReplayListItem,
} from "../../types/index.js";

import { resolveOrgRegion } from "../region.js";

import {
  API_MAX_PER_PAGE,
  apiRequestToRegion,
  autoPaginate,
  type PaginatedResponse,
  parseLinkHeader,
} from "./infrastructure.js";

/** Sort values supported by the CLI replay list command. */
export type ReplaySortValue =
  | "-started_at"
  | "started_at"
  | "-duration"
  | "-count_errors"
  | "-count_segments"
  | "-activity";

/** Options for {@link listReplays}. */
export type ListReplaysOptions = {
  /** Limit total rows returned across auto-paginated pages. */
  limit?: number;
  /** Structured replay query using Sentry search syntax. */
  query?: string;
  /** Project slugs to filter by. */
  projectSlugs?: string[];
  /** Sort expression for the replay index endpoint. */
  sort?: ReplaySortValue;
  /** Pagination cursor from a previous response. */
  cursor?: string;
  /** Relative time period (e.g. "7d", "24h"). Overrides start/end on the API. */
  statsPeriod?: string;
  /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  start?: string;
  /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  end?: string;
};

/**
 * Fetch a single page of replays from the organization replay index.
 */
async function fetchReplayPage(
  regionUrl: string,
  orgSlug: string,
  options: ListReplaysOptions,
  perPage: number,
  cursor?: string
): Promise<PaginatedResponse<ReplayListItem[]>> {
  const { data, headers } = await apiRequestToRegion(
    regionUrl,
    `/organizations/${orgSlug}/replays/`,
    {
      params: {
        cursor,
        field: [...REPLAY_LIST_FIELDS],
        per_page: perPage,
        projectSlug: options.projectSlugs,
        query: options.query,
        sort: options.sort ?? "-started_at",
        statsPeriod:
          options.start || options.end
            ? undefined
            : (options.statsPeriod ?? "7d"),
        start: options.start,
        end: options.end,
      },
      schema: ReplayListResponseSchema,
    }
  );

  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data: data.data, nextCursor };
}

/**
 * List replays for an organization, optionally filtered to one or more projects.
 *
 * Auto-paginates when `limit` exceeds the API's per-page cap.
 */
export async function listReplays(
  orgSlug: string,
  options: ListReplaysOptions = {}
): Promise<PaginatedResponse<ReplayListItem[]>> {
  const limit = options.limit ?? 25;
  const perPage = Math.min(limit, API_MAX_PER_PAGE);
  const regionUrl = await resolveOrgRegion(orgSlug);

  return autoPaginate(
    (cursor) => fetchReplayPage(regionUrl, orgSlug, options, perPage, cursor),
    limit,
    options.cursor
  );
}

/**
 * Fetch a single replay by ID.
 */
export async function getReplay(
  orgSlug: string,
  replayId: string
): Promise<ReplayDetails> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion(
    regionUrl,
    `/organizations/${orgSlug}/replays/${replayId}/`,
    {
      schema: ReplayDetailsResponseSchema,
    }
  );
  return data.data;
}
