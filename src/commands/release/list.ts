/**
 * sentry release list
 *
 * List releases in an organization with pagination support.
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

const RELEASE_COLUMNS: Column<ReleaseWithOrg>[] = [
  { header: "ORG", value: (r) => r.orgSlug || "" },
  {
    header: "VERSION",
    value: (r) => escapeMarkdownCell(r.shortVersion || r.version),
  },
  {
    header: "STATUS",
    value: (r) => (r.dateReleased ? "Finalized" : "Unreleased"),
  },
  {
    header: "CREATED",
    value: (r) => (r.dateCreated ? formatRelativeTime(r.dateCreated) : ""),
  },
  {
    header: "RELEASED",
    value: (r) => (r.dateReleased ? formatRelativeTime(r.dateReleased) : "—"),
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
  listForOrg: async (org) => {
    const { data } = await listReleasesPaginated(org, { perPage: 100 });
    return data;
  },
  listPaginated: (org, opts) => listReleasesPaginated(org, opts),
  withOrg: (release, orgSlug) => ({ ...release, orgSlug }),
  displayTable: (releases: ReleaseWithOrg[]) =>
    formatTable(releases, RELEASE_COLUMNS),
};

const docs: OrgListCommandDocs = {
  brief: "List releases",
  fullDescription:
    "List releases in an organization.\n\n" +
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
