/**
 * Alert rules API functions
 *
 * Fetch operations for Sentry alert rules:
 * - Issue alerts: event-based rules that trigger on matching errors (per-project)
 * - Metric alerts: threshold-based rules that trigger on metric queries (org-wide)
 */

import {
  createOrganizationWorkflow,
  getOrganizationWorkflow,
  listOrganizationDetectors,
  updateOrganizationWorkflow,
} from "@sentry/api";
import { ApiError } from "../errors.js";
import { resolveOrgRegion } from "../region.js";
import {
  apiRequestToRegion,
  apiRequestToRegionNoContent,
  getOrgSdkConfig,
  type PaginatedResponse,
  parseLinkHeader,
  unwrapResult,
} from "./infrastructure.js";

// Types

/** A single issue alert rule (event-based) */
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
  /**
   * Detector IDs the workflow is attached to. Returned by the org-scoped
   * `/workflows/` endpoint; used to filter out unattached org-level workflows
   * (a workflow with no detectors is not an issue alert rule).
   */
  detectorIds?: Array<string | number>;
};

/** A single metric alert rule (threshold-based, org-scoped) */
export type MetricAlertRule = {
  id: string;
  name: string;
  /** 0/"0"/absent = active, 1/"1" = disabled */
  status?: number | string;
  query: string;
  aggregate: string;
  dataset: string;
  timeWindow: number;
  environment: string | null;
  owner: string | null;
  projects: string[];
  dateCreated: string;
};

// Issue alerts
//
// Issue alert rules are read from the org-scoped `/organizations/{org}/workflows/`
// endpoint (filtered by `projectSlug`). The legacy project-scoped
// `/projects/{org}/{project}/rules/` endpoint was deprecated on 2026-05-14 and
// now returns HTTP 410 during recurring brownouts (getsentry/cli#1182). The
// workflows endpoint returns rule-shaped payloads, so the existing
// `IssueAlertRule` shape is preserved. Mutations (create/update/delete) still
// use the legacy endpoint pending a follow-up migration.

/**
 * Keep only workflows that are attached to a detector.
 *
 * A `projectSlug`-filtered workflows response can also include unattached
 * org-level workflows; those are not issue alert rules, so we drop any entry
 * with no `detectorIds`. Mirrors the sentry-mcp filter of the same name.
 */
function filterAttachedIssueAlertRules(
  rules: IssueAlertRule[]
): IssueAlertRule[] {
  return rules.filter((rule) => (rule.detectorIds ?? []).length > 0);
}

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
    `/organizations/${orgSlug}/workflows/`,
    {
      params: {
        projectSlug,
        sortBy: "-id",
        per_page: options.perPage,
        cursor: options.cursor,
      },
    }
  );
  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data: filterAttachedIssueAlertRules(data), nextCursor };
}

/**
 * Full workflow document for the edit baseline (name, config, environment,
 * triggers, action_filters, detector_ids, ...), read from the org-scoped
 * `/organizations/{org}/workflows/{id}/` detail endpoint.
 */
export async function getIssueAlertWorkflowDocument(
  orgSlug: string,
  workflowId: string
): Promise<Record<string, unknown>> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await getOrganizationWorkflow({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      workflow_id: Number(workflowId),
    },
  });
  return unwrapResult<Record<string, unknown>>(
    result,
    "Failed to fetch issue alert rule"
  );
}

/**
 * Resolve the id of a project's error detector ("Error Monitor"). An issue alert
 * workflow must connect to it via `detector_ids` to fire on new issues. Reads the
 * org-scoped detectors endpoint filtered to the project and the `error` type.
 *
 * @throws {ApiError} 404 if the project has no error detector
 */
export async function resolveErrorDetectorId(
  orgSlug: string,
  projectSlug: string
): Promise<number> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await listOrganizationDetectors({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    query: { project: [projectSlug], query: "type:error" },
  });
  const detectors = unwrapResult<Array<{ id: string | number }>>(
    result,
    "Failed to resolve error detector"
  );
  const detector = detectors[0];
  if (!detector) {
    throw new ApiError(
      `No error detector found for project '${projectSlug}'`,
      404,
      undefined,
      `/organizations/${orgSlug}/detectors/`
    );
  }
  return Number(detector.id);
}

/**
 * Get a single issue alert rule by ID.
 *
 * Reads from the org-scoped `/workflows/` endpoint, filtered by project and id.
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug
 * @param ruleId - Alert rule ID
 * @returns The issue alert rule
 * @throws {ApiError} 404 if no attached rule matches the id in the project
 */
export async function getIssueAlertRule(
  orgSlug: string,
  projectSlug: string,
  ruleId: string
): Promise<IssueAlertRule> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<IssueAlertRule[]>(
    regionUrl,
    `/organizations/${orgSlug}/workflows/`,
    { params: { projectSlug, id: ruleId, per_page: 1 } }
  );
  const rule = filterAttachedIssueAlertRules(data)[0];
  if (!rule) {
    throw new ApiError(
      `Issue alert rule '${ruleId}' not found`,
      404,
      undefined,
      `/organizations/${orgSlug}/workflows/`
    );
  }
  return rule;
}

// Metric alerts

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

/** Single GET for org metric alert rule (typed or full JSON for PUT). */
async function fetchMetricAlertRuleJson(
  orgSlug: string,
  ruleId: string
): Promise<Record<string, unknown>> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<Record<string, unknown>>(
    regionUrl,
    `/organizations/${orgSlug}/alert-rules/${encodeURIComponent(ruleId)}/`
  );
  return data;
}

/**
 * Get a single metric alert rule by ID.
 *
 * @param orgSlug - Organization slug
 * @param ruleId - Alert rule ID
 * @returns The metric alert rule
 */
export async function getMetricAlertRule(
  orgSlug: string,
  ruleId: string
): Promise<MetricAlertRule> {
  const data = await fetchMetricAlertRuleJson(orgSlug, ruleId);
  return data as MetricAlertRule;
}

// Issue alert write operations

/**
 * Delete an issue alert rule via the org-scoped `/workflows/` endpoint.
 *
 * `ruleId` is the workflow id surfaced by the migrated read path (`list`/`view`),
 * so the delete is keyed by id alone — no project slug is needed (project scoping
 * already happens upstream when the rule is resolved via `resolveIssueAlertRule`).
 *
 * Succeeds with 204 No Content and no response body.
 */
export async function deleteIssueAlertRule(
  orgSlug: string,
  ruleId: string
): Promise<void> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  await apiRequestToRegionNoContent(
    regionUrl,
    `/organizations/${orgSlug}/workflows/${encodeURIComponent(ruleId)}/`,
    { method: "DELETE" }
  );
}

/**
 * Replace (update) an issue alert workflow. Sentry PUT is a full replacement.
 *
 * `workflowId` is the id surfaced by the migrated read path; the update is keyed
 * by id on the org-scoped `/workflows/{id}/` endpoint.
 */
export async function updateIssueAlertRule(
  orgSlug: string,
  workflowId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await updateOrganizationWorkflow({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      workflow_id: Number(workflowId),
    },
    // The SDK types conditions/actions as `unknown[]`; the CLI supplies the
    // workflow-native body as a plain record, so cast into the typed arg.
    body: body as unknown as Parameters<
      typeof updateOrganizationWorkflow
    >[0]["body"],
  });
  return unwrapResult<Record<string, unknown>>(
    result,
    "Failed to update issue alert rule"
  );
}

/**
 * Create an issue alert workflow on the org-scoped `/workflows/` endpoint.
 *
 * `body` must be workflow-shaped (name, detector_ids, config, triggers,
 * action_filters, ...). Project linkage is carried by `detector_ids`, so no
 * project slug is part of the request.
 */
export async function createIssueAlertRule(
  orgSlug: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await createOrganizationWorkflow({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    // The SDK types conditions/actions as `unknown[]`; the CLI supplies the
    // workflow-native body as a plain record, so cast into the typed arg.
    body: body as unknown as Parameters<
      typeof createOrganizationWorkflow
    >[0]["body"],
  });
  return unwrapResult<Record<string, unknown>>(
    result,
    "Failed to create issue alert rule"
  );
}

// Metric alert (org) write operations

/**
 * Delete a metric (organization) alert rule. May return 202 with no body.
 */
export async function deleteMetricAlertRule(
  orgSlug: string,
  ruleId: string
): Promise<void> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  await apiRequestToRegionNoContent(
    regionUrl,
    `/organizations/${orgSlug}/alert-rules/${encodeURIComponent(ruleId)}/`,
    { method: "DELETE" }
  );
}

export function getMetricAlertRuleDocument(
  orgSlug: string,
  ruleId: string
): Promise<Record<string, unknown>> {
  return fetchMetricAlertRuleJson(orgSlug, ruleId);
}

export async function putMetricAlertRule(
  orgSlug: string,
  ruleId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<Record<string, unknown>>(
    regionUrl,
    `/organizations/${orgSlug}/alert-rules/${encodeURIComponent(ruleId)}/`,
    { method: "PUT", body }
  );
  return data;
}

/**
 * Create a metric (organization) alert rule.
 */
export async function createMetricAlertRule(
  orgSlug: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<Record<string, unknown>>(
    regionUrl,
    `/organizations/${orgSlug}/alert-rules/`,
    { method: "POST", body }
  );
  return data;
}
