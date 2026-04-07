/**
 * sentry release list
 *
 * List releases in an organization with pagination support.
 * Includes per-project health/adoption metrics when available.
 */

import type { OrgReleaseResponse } from "@sentry/api";
import { listReleasesPaginated } from "../../lib/api-client.js";
import { escapeMarkdownCell } from "../../lib/formatters/markdown.js";
import { type Column, formatTable } from "../../lib/formatters/table.js";
import { formatRelativeTime } from "../../lib/formatters/time-utils.js";
import {
  buildOrgListCommand,
  type OrgListCommandDocs,
} from "../../lib/list-command.js";
import type { OrgListConfig } from "../../lib/org-list.js";

export const PAGINATION_KEY = "release-list";

type ReleaseWithOrg = OrgReleaseResponse & { orgSlug?: string };

/**
 * Extract health data from the first project that has it.
 *
 * A release spans multiple projects; each gets independent health data.
 * For the list table we pick the first project with `hasHealthData: true`.
 */
function getHealthData(release: OrgReleaseResponse) {
  return release.projects?.find((p) => p.healthData?.hasHealthData)?.healthData;
}

/** Format a percentage value with one decimal, or "—" when absent. */
function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

const RELEASE_COLUMNS: Column<ReleaseWithOrg>[] = [
  { header: "ORG", value: (r) => r.orgSlug || "" },
  {
    header: "VERSION",
    value: (r) => escapeMarkdownCell(r.shortVersion || r.version),
  },
  {
    header: "CREATED",
    value: (r) => (r.dateCreated ? formatRelativeTime(r.dateCreated) : ""),
  },
  {
    header: "ADOPTION",
    value: (r) => fmtPct(getHealthData(r)?.adoption),
    align: "right",
  },
  {
    header: "CRASH-FREE",
    value: (r) => fmtPct(getHealthData(r)?.crashFreeSessions),
    align: "right",
  },
  {
    header: "ISSUES",
    value: (r) => String(r.newGroups ?? 0),
    align: "right",
  },
  { header: "COMMITS", value: (r) => String(r.commitCount ?? 0) },
  { header: "DEPLOYS", value: (r) => String(r.deployCount ?? 0) },
];

const releaseListConfig: OrgListConfig<OrgReleaseResponse, ReleaseWithOrg> = {
  paginationKey: PAGINATION_KEY,
  entityName: "release",
  entityPlural: "releases",
  commandPrefix: "sentry release list",
  // listForOrg fetches a buffer page for multi-org fan-out.
  // The framework truncates results to --limit after aggregation.
  // health=true to populate per-project adoption/crash-free metrics.
  listForOrg: async (org) => {
    const { data } = await listReleasesPaginated(org, {
      perPage: 100,
      health: true,
    });
    return data;
  },
  listPaginated: (org, opts) =>
    listReleasesPaginated(org, { ...opts, health: true }),
  withOrg: (release, orgSlug) => ({ ...release, orgSlug }),
  displayTable: (releases: ReleaseWithOrg[]) =>
    formatTable(releases, RELEASE_COLUMNS),
};

const docs: OrgListCommandDocs = {
  brief: "List releases with adoption and health metrics",
  fullDescription:
    "List releases in an organization with adoption and crash-free metrics.\n\n" +
    "Health data (adoption %, crash-free session rate) is shown per-release\n" +
    "from the first project that has session data.\n\n" +
    "Target specification:\n" +
    "  sentry release list               # auto-detect from DSN or config\n" +
    "  sentry release list <org>/        # list all releases in org (paginated)\n" +
    "  sentry release list <org>/<proj>  # list releases in org (project context)\n" +
    "  sentry release list <org>         # list releases in org\n\n" +
    "Pagination:\n" +
    "  sentry release list <org>/ -c next  # fetch next page\n" +
    "  sentry release list <org>/ -c prev  # fetch previous page\n\n" +
    "Examples:\n" +
    "  sentry release list              # auto-detect or list all\n" +
    "  sentry release list my-org/      # list releases in my-org (paginated)\n" +
    "  sentry release list --limit 10\n" +
    "  sentry release list --json\n\n" +
    "Alias: `sentry releases` → `sentry release list`",
};

export const listCommand = buildOrgListCommand(
  releaseListConfig,
  docs,
  "release"
);
