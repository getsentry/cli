/**
 * Dashboard API functions
 *
 * CRUD operations for Sentry dashboards.
 */

import type {
  DashboardDetail,
  DashboardListItem,
  DashboardWidget,
} from "../../types/dashboard.js";

import { resolveOrgRegion } from "../region.js";

import { apiRequestToRegion } from "./infrastructure.js";

/**
 * List dashboards in an organization.
 *
 * @param orgSlug - Organization slug
 * @param options - Optional pagination parameters
 * @returns Array of dashboard list items
 */
export async function listDashboards(
  orgSlug: string,
  options: { perPage?: number } = {}
): Promise<DashboardListItem[]> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<DashboardListItem[]>(
    regionUrl,
    `/organizations/${orgSlug}/dashboards/`,
    { params: { per_page: options.perPage } }
  );
  return data;
}

/**
 * Get a dashboard by ID.
 *
 * @param orgSlug - Organization slug
 * @param dashboardId - Dashboard ID
 * @returns Full dashboard detail with widgets
 */
export async function getDashboard(
  orgSlug: string,
  dashboardId: string
): Promise<DashboardDetail> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<DashboardDetail>(
    regionUrl,
    `/organizations/${orgSlug}/dashboards/${dashboardId}/`
  );
  return data;
}

/**
 * Create a new dashboard.
 *
 * @param orgSlug - Organization slug
 * @param body - Dashboard creation body (title, optional widgets)
 * @returns Created dashboard detail
 */
export async function createDashboard(
  orgSlug: string,
  body: { title: string; widgets?: DashboardWidget[]; projects?: number[] }
): Promise<DashboardDetail> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<DashboardDetail>(
    regionUrl,
    `/organizations/${orgSlug}/dashboards/`,
    { method: "POST", body }
  );
  return data;
}

/**
 * Update a dashboard (full PUT — replaces all widgets).
 * Always GET first, modify, then PUT the full widget list.
 *
 * @param orgSlug - Organization slug
 * @param dashboardId - Dashboard ID
 * @param body - Dashboard update body (title, widgets)
 * @returns Updated dashboard detail
 */
export async function updateDashboard(
  orgSlug: string,
  dashboardId: string,
  body: { title: string; widgets: DashboardWidget[]; projects?: number[] }
): Promise<DashboardDetail> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<DashboardDetail>(
    regionUrl,
    `/organizations/${orgSlug}/dashboards/${dashboardId}/`,
    { method: "PUT", body }
  );
  return data;
}
