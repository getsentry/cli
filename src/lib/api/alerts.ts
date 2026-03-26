/**
 * Alert rules API functions
 *
 * Fetch operations for Sentry alert rules:
 * - Issue alerts: event-based rules that trigger on matching errors (per-project)
 * - Metric alerts: threshold-based rules that trigger on metric queries (org-wide)
 */

import { resolveOrgRegion } from "../region.js";
import {
  apiRequestToRegion,
  type PaginatedResponse,
  parseLinkHeader,
} from "./infrastructure.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single issue alert rule (event-based, project-scoped) */
export type IssueAlertRule = {
  id: string;
  name: string;
  /** "active" | "disabled" */
  status: string;
  actionMatch: string;
  conditions: unknown[];
  actions: unknown[];
  frequency: number;
  environment: string | null;
  owner: string | null;
  projects: string[];
  dateCreated: string;
};

/** A single metric alert rule (threshold-based, org-scoped) */
export type MetricAlertRule = {
  id: string;
  name: string;
  /** 0 = active, 1 = disabled */
  status: number;
  query: string;
  aggregate: string;
  dataset: string;
  timeWindow: number;
  environment: string | null;
  owner: string | null;
  projects: string[];
  dateCreated: string;
};

// ---------------------------------------------------------------------------
// Issue alerts
// ---------------------------------------------------------------------------

/**
 * List issue alert rules for a project with cursor-based pagination.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug
 * @param options - Pagination parameters (perPage, cursor)
 * @returns Paginated response with issue alert rules and optional next cursor
 */
export async function listIssueAlertsPaginated(
  orgSlug: string,
  projectSlug: string,
  options: { perPage?: number; cursor?: string } = {}
): Promise<PaginatedResponse<IssueAlertRule[]>> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data, headers } = await apiRequestToRegion<IssueAlertRule[]>(
    regionUrl,
    `/projects/${orgSlug}/${projectSlug}/rules/`,
    { params: { per_page: options.perPage, cursor: options.cursor } }
  );
  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data, nextCursor };
}

// ---------------------------------------------------------------------------
// Metric alerts
// ---------------------------------------------------------------------------

/**
 * List metric alert rules for an organization with cursor-based pagination.
 *
 * @param orgSlug - Organization slug
 * @param options - Pagination parameters (perPage, cursor)
 * @returns Paginated response with metric alert rules and optional next cursor
 */
export async function listMetricAlertsPaginated(
  orgSlug: string,
  options: { perPage?: number; cursor?: string } = {}
): Promise<PaginatedResponse<MetricAlertRule[]>> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data, headers } = await apiRequestToRegion<MetricAlertRule[]>(
    regionUrl,
    `/organizations/${orgSlug}/alert-rules/`,
    { params: { per_page: options.perPage, cursor: options.cursor } }
  );
  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data, nextCursor };
}
