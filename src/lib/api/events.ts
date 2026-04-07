/**
 * Event API functions
 *
 * Functions for retrieving, listing, and resolving Sentry events.
 */

import {
  listAnIssue_sEvents,
  retrieveAnEventForAProject,
  retrieveAnIssueEvent,
  resolveAnEventId as sdkResolveAnEventId,
} from "@sentry/api";
import pLimit from "p-limit";

import type { IssueEvent, SentryEvent } from "../../types/index.js";

import { ApiError, AuthError } from "../errors.js";

import {
  API_MAX_PER_PAGE,
  getOrgSdkConfig,
  MAX_PAGINATION_PAGES,
  ORG_FANOUT_CONCURRENCY,
  type PaginatedResponse,
  unwrapPaginatedResult,
  unwrapResult,
} from "./infrastructure.js";
import { listOrganizations } from "./organizations.js";

/**
 * Get the latest event for an issue.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug (required for multi-region routing)
 * @param issueId - Issue ID (numeric)
 */
export async function getLatestEvent(
  orgSlug: string,
  issueId: string
): Promise<SentryEvent> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveAnIssueEvent({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      issue_id: Number(issueId),
      event_id: "latest",
    },
  });

  const data = unwrapResult(result, "Failed to get latest event");
  return data as unknown as SentryEvent;
}

/**
 * Get a specific event by ID.
 * Uses region-aware routing for multi-region support.
 */
export async function getEvent(
  orgSlug: string,
  projectSlug: string,
  eventId: string
): Promise<SentryEvent> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveAnEventForAProject({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      project_id_or_slug: projectSlug,
      event_id: eventId,
    },
  });

  const data = unwrapResult(result, "Failed to get event");
  return data as unknown as SentryEvent;
}

/**
 * Result of resolving an event ID to an org and project.
 * Includes the full event so the caller can avoid a second API call.
 */
export type ResolvedEvent = {
  org: string;
  project: string;
  event: SentryEvent;
};

/**
 * Resolve an event ID to its org and project using the
 * `/organizations/{org}/eventids/{event_id}/` endpoint.
 *
 * Returns the resolved org, project, and full event on success,
 * or null if the event is not found in the given org.
 */
export async function resolveEventInOrg(
  orgSlug: string,
  eventId: string
): Promise<ResolvedEvent | null> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await sdkResolveAnEventId({
    ...config,
    path: { organization_id_or_slug: orgSlug, event_id: eventId },
  });

  try {
    const data = unwrapResult(result, "Failed to resolve event ID");
    return {
      org: data.organizationSlug,
      project: data.projectSlug,
      event: data.event as unknown as SentryEvent,
    };
  } catch (error) {
    // 404 means the event doesn't exist in this org — not an error
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Search for an event across all accessible organizations by event ID.
 *
 * Fans out to every org in parallel using the eventids resolution endpoint.
 * Returns the first match found, or null if the event is not accessible.
 *
 * @param eventId - The event ID (UUID) to look up
 */
export async function findEventAcrossOrgs(
  eventId: string
): Promise<ResolvedEvent | null> {
  const orgs = await listOrganizations();

  const limit = pLimit(ORG_FANOUT_CONCURRENCY);
  const results = await Promise.allSettled(
    orgs.map((org) => limit(() => resolveEventInOrg(org.slug, eventId)))
  );

  // First pass: return the first successful match
  for (const result of results) {
    if (result.status === "fulfilled" && result.value !== null) {
      return result.value;
    }
  }

  // Second pass (only reached when no org had the event): propagate
  // AuthError since it indicates a global problem (expired/missing token).
  // Transient per-org failures (network, 5xx) are swallowed — they are not
  // global, and if the event existed in any accessible org it would have matched.
  for (const result of results) {
    if (result.status === "rejected" && result.reason instanceof AuthError) {
      throw result.reason;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Issue event listing
// ---------------------------------------------------------------------------

/** Options for {@link listIssueEvents}. */
export type ListIssueEventsOptions = {
  /** Max items to return (total across all auto-paginated pages). @default 25 */
  limit?: number;
  /** Search query (Sentry search syntax). */
  query?: string;
  /** Include full event body (stacktraces, breadcrumbs). */
  full?: boolean;
  /** Pagination cursor from a previous response. */
  cursor?: string;
  /** Relative time period (e.g., "7d", "24h"). Overrides start/end on the API. */
  statsPeriod?: string;
  /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  start?: string;
  /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  end?: string;
};

/**
 * List events for a specific issue.
 *
 * Uses the SDK's `listAnIssue_sEvents` endpoint with region-aware routing.
 * When `limit` exceeds {@link API_MAX_PER_PAGE} (100), auto-paginates through
 * multiple API calls to fill the requested limit, bounded by {@link MAX_PAGINATION_PAGES}.
 *
 * @param orgSlug - Organization slug for region routing
 * @param issueId - Numeric issue ID
 * @param options - Query and pagination options
 * @returns Paginated response with events array and optional next cursor
 */
export async function listIssueEvents(
  orgSlug: string,
  issueId: string,
  options: ListIssueEventsOptions = {}
): Promise<PaginatedResponse<IssueEvent[]>> {
  const { limit = 25, query, full, cursor, statsPeriod, start, end } = options;

  const config = await getOrgSdkConfig(orgSlug);

  const allEvents: IssueEvent[] = [];
  let currentCursor = cursor;
  let nextCursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const result = await listAnIssue_sEvents({
      ...config,
      path: {
        organization_id_or_slug: orgSlug,
        issue_id: Number(issueId),
      },
      query: {
        query: query || undefined,
        full,
        cursor: currentCursor,
        statsPeriod,
        start,
        end,
      },
    });

    const paginated = unwrapPaginatedResult(
      result as
        | { data: IssueEvent[]; error: undefined }
        | { data: undefined; error: unknown },
      "Failed to list issue events"
    );

    allEvents.push(...(paginated.data as IssueEvent[]));
    nextCursor = paginated.nextCursor;

    if (allEvents.length >= limit || !nextCursor) {
      break;
    }
    currentCursor = nextCursor;
  }

  // Trim to exact limit. Unlike listIssuesAllPages (which controls per_page),
  // the issue events endpoint has no per-page parameter, so the API may return
  // more items than requested. We preserve nextCursor so the command-level
  // cursor stack can navigate to subsequent pages.
  const trimmed =
    allEvents.length > limit ? allEvents.slice(0, limit) : allEvents;

  return { data: trimmed, nextCursor };
}
