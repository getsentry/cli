/**
 * Alert rules API functions
 *
 * Fetch operations for Sentry alert rules:
 * - Issue alerts: event-based rules that trigger on matching errors (per-project)
 * - Metric alerts: threshold-based rules that trigger on metric queries (org-wide)
 */

import { ApiError } from "../errors.js";
import { resolveOrgRegion } from "../region.js";
import {
  apiRequestToRegion,
  apiRequestToRegionNoContent,
  type PaginatedResponse,
  parseLinkHeader,
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

/**
 * A metric-issue detector as returned by the org-scoped `/detectors/` endpoint.
 *
 * The new detectors API replaces the legacy `/alert-rules/` endpoint. The
 * threshold query fields (aggregate, dataset, query, timeWindow) live inside
 * the first entry of `dataSources`, and the active/disabled state is the
 * top-level `enabled` boolean. Only the fields the CLI reads are typed; the
 * nested `dataSources`/`config` objects are otherwise opaque.
 */
type MetricDetector = {
  id: string | number;
  name: string;
  enabled?: boolean;
  environment?: string | null;
  projectSlug?: string | null;
  projects?: string[] | null;
  owner?: { type: string; name?: string; id?: string } | string | null;
  dateCreated?: string;
  dataSources?: Record<string, unknown>[] | null;
};

/**
 * Map a metric-issue detector onto the flat `MetricAlertRule` shape the CLI
 * commands (list/view/resolve) already consume.
 *
 * The threshold query fields live in the first data source. Some deployments
 * nest them under a `queryObj`/`snubaQuery` sub-object, so we look there as a
 * fallback. `enabled === false` maps to the legacy disabled status (1); an
 * enabled or absent flag maps to active (0), matching `metricAlertStatusLabel`.
 */
function pickDetectorString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pickDetectorNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }
  return 0;
}

/** Reduce a detector owner (object or bare string) to the flat owner value. */
function pickDetectorOwner(owner: MetricDetector["owner"]): string | null {
  if (typeof owner === "string") {
    return owner;
  }
  if (owner && typeof owner === "object") {
    return owner.name ?? owner.id ?? null;
  }
  return null;
}

function mapDetectorToMetricAlertRule(
  detector: MetricDetector
): MetricAlertRule {
  const source = detector.dataSources?.[0] ?? {};
  const nested =
    (source.queryObj as Record<string, unknown> | undefined) ??
    (source.snubaQuery as Record<string, unknown> | undefined) ??
    source;

  const environment =
    pickDetectorString(nested.environment) || detector.environment || null;

  return {
    id: String(detector.id),
    name: detector.name,
    status: detector.enabled === false ? 1 : 0,
    query: pickDetectorString(nested.query),
    aggregate: pickDetectorString(nested.aggregate),
    dataset: pickDetectorString(nested.dataset),
    timeWindow: pickDetectorNumber(nested.timeWindow),
    environment,
    owner: pickDetectorOwner(detector.owner),
    projects: detector.projects ?? [],
    dateCreated: detector.dateCreated ?? "",
  };
}

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
 * Single GET for a project issue alert rule as full JSON (used as the edit
 * baseline for PUT).
 *
 * NOTE: still uses the deprecated project-scoped `/rules/` endpoint. It backs
 * the mutation path (`getIssueAlertRuleDocument` → edit), which is migrating to
 * `/workflows/` in a follow-up (getsentry/cli#1182).
 */
async function fetchIssueAlertRuleJson(
  orgSlug: string,
  projectSlug: string,
  ruleId: string
): Promise<Record<string, unknown>> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<Record<string, unknown>>(
    regionUrl,
    `/projects/${orgSlug}/${projectSlug}/rules/${encodeURIComponent(ruleId)}/`
  );
  return data;
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
//
// Metric alert rules are read from the org-scoped
// `/organizations/{org}/detectors/` endpoint (filtered to `type:metric_issue`).
// The legacy `/organizations/{org}/alert-rules/` endpoint is being retired on
// 2026-08-17 (getsentry/cli#1274, #1182). Detectors return a nested shape, so
// `mapDetectorToMetricAlertRule` flattens each detector into the existing
// `MetricAlertRule` shape the commands already consume. Mutations
// (create/update/delete) still use the legacy endpoint pending a follow-up
// migration to the detectors/monitors + workflows write APIs.

/** Search query that limits the detectors endpoint to metric alert rules. */
const METRIC_DETECTOR_QUERY = "type:metric_issue";

/**
 * List metric alert rules for an organization with cursor-based pagination.
 *
 * Reads from the org-scoped `/detectors/` endpoint filtered to
 * `type:metric_issue` and maps each detector onto the flat `MetricAlertRule`
 * shape.
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
  const { data, headers } = await apiRequestToRegion<MetricDetector[]>(
    regionUrl,
    `/organizations/${orgSlug}/detectors/`,
    {
      params: {
        query: METRIC_DETECTOR_QUERY,
        sortBy: "-id",
        per_page: options.perPage,
        cursor: options.cursor,
      },
    }
  );
  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return { data: data.map(mapDetectorToMetricAlertRule), nextCursor };
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
 * Reads from the org-scoped `/detectors/{id}/` endpoint and maps the detector
 * onto the flat `MetricAlertRule` shape.
 *
 * @param orgSlug - Organization slug
 * @param ruleId - Detector (alert rule) ID
 * @returns The metric alert rule
 */
export async function getMetricAlertRule(
  orgSlug: string,
  ruleId: string
): Promise<MetricAlertRule> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<MetricDetector>(
    regionUrl,
    `/organizations/${orgSlug}/detectors/${encodeURIComponent(ruleId)}/`
  );
  return mapDetectorToMetricAlertRule(data);
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
 * Full document for PUT (includes conditions, actions, etc. from the API).
 */
export function getIssueAlertRuleDocument(
  orgSlug: string,
  projectSlug: string,
  ruleId: string
): Promise<Record<string, unknown>> {
  return fetchIssueAlertRuleJson(orgSlug, projectSlug, ruleId);
}

/**
 * Replace an issue alert rule (Sentry PUT is a full replacement).
 */
export async function putIssueAlertRule(
  orgSlug: string,
  projectSlug: string,
  ruleId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<Record<string, unknown>>(
    regionUrl,
    `/projects/${orgSlug}/${projectSlug}/rules/${encodeURIComponent(ruleId)}/`,
    { method: "PUT", body }
  );
  return data;
}

/**
 * Create an issue (project) alert rule.
 */
export async function createIssueAlertRule(
  orgSlug: string,
  projectSlug: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<Record<string, unknown>>(
    regionUrl,
    `/projects/${orgSlug}/${projectSlug}/rules/`,
    { method: "POST", body }
  );
  return data;
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
