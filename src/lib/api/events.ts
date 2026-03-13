/**
 * Event API functions
 *
 * Functions for retrieving and resolving Sentry events.
 */

import {
  retrieveAnEventForAProject,
  retrieveAnIssueEvent,
  resolveAnEventId as sdkResolveAnEventId,
} from "@sentry/api";

import type { SentryEvent } from "../../types/index.js";

import { ApiError, AuthError } from "../errors.js";

import { getOrgSdkConfig, unwrapResult } from "./infrastructure.js";
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

  const results = await Promise.allSettled(
    orgs.map((org) => resolveEventInOrg(org.slug, eventId))
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
