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

/** Options for {@link findEventAcrossOrgs}. */
export type FindEventAcrossOrgsOptions = {
  /** Org slugs to skip (already searched by the caller). */
  excludeOrgs?: string[];
};

/**
 * Search for an event across all accessible organizations by event ID.
 *
 * Fans out to every org in parallel using the eventids resolution endpoint.
 * Returns the first match found, or null if the event is not accessible.
 *
 * @param eventId - The event ID (UUID) to look up
 * @param options - Optional settings (e.g., orgs to skip)
 */
export async function findEventAcrossOrgs(
  eventId: string,
  options?: FindEventAcrossOrgsOptions
): Promise<ResolvedEvent | null> {
  const excludeSet = options?.excludeOrgs
    ? new Set(options.excludeOrgs)
    : undefined;
  const allOrgs = await listOrganizations();
  const orgs = excludeSet
    ? allOrgs.filter((o) => !excludeSet.has(o.slug))
    : allOrgs;

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
 *
 * Page size is capped at `min(limit, {@link API_MAX_PER_PAGE})` via `per_page`,
 * which Sentry accepts on this route at runtime even though it is absent from
 * the OpenAPI spec. Capping page size means the server-issued `nextCursor` is
 * aligned to a page boundary, so cursor navigation never skips events.
 *
 * As defense-in-depth (in case the server ignores `per_page`), the result is
 * trimmed to `limit` but `nextCursor` is PRESERVED: the events cursor is
 * offset-based, so resuming from it re-includes any trimmed tail rather than
 * skipping it. Preserving the cursor is also what lets `-c next` advance at all
 * when a page is larger than `limit` — dropping it would strand later events.
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
  const perPage = Math.min(limit, API_MAX_PER_PAGE);

  const result = await listAnIssue_sEvents({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      issue_id: Number(issueId),
    },
    query: {
      query: query || undefined,
      full,
      cursor,
      statsPeriod,
      start,
      end,
      // `per_page` is accepted at runtime but absent from the generated query
      // type, so widen via cast.
      per_page: perPage,
    } as Parameters<typeof listAnIssue_sEvents>[0]["query"],
  });

  const paginated = unwrapPaginatedResult(
    result,
    "Failed to list issue events"
  );
  const events = paginated.data as IssueEvent[];

  // Trim to limit but keep nextCursor (see JSDoc): the offset-based events
  // cursor re-includes any trimmed tail on the next page, so navigation neither
  // skips nor stalls.
  const data = events.length > limit ? events.slice(0, limit) : events;
  return { data, nextCursor: paginated.nextCursor };
}
