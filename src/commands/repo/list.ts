/**
 * sentry repo list
 *
 * List repositories in an organization, with flexible targeting and cursor pagination.
 *
 * Supports:
 * - Auto-detection from DSN/config
 * - Org-scoped listing with cursor pagination (e.g., sentry/)
 * - Project-scoped listing (e.g., sentry/cli) - lists repos for that project's org
 * - Bare org slug (e.g., sentry) - lists repos for that org
 */

import {
  listRepositories,
  listRepositoriesPaginated,
} from "../../lib/api-client.js";
import { type Column, writeTable } from "../../lib/formatters/table.js";
import {
  buildOrgListCommand,
  type OrgListCommandDocs,
} from "../../lib/list-command.js";
import type { OrgListConfig } from "../../lib/org-list.js";
import type { SentryRepository, Writer } from "../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "repo-list";

/** Repository with its organization context for display */
type RepositoryWithOrg = SentryRepository & { orgSlug?: string };

/** Column definitions for the repository table. */
const REPO_COLUMNS: Column<RepositoryWithOrg>[] = [
  { header: "ORG", value: (r) => r.orgSlug || "", minWidth: 3 },
  { header: "NAME", value: (r) => r.name, minWidth: 4 },
  { header: "PROVIDER", value: (r) => r.provider.name, minWidth: 8 },
  { header: "STATUS", value: (r) => r.status, minWidth: 6 },
  { header: "URL", value: (r) => r.url || "" },
];

/** Shared config that plugs into the org-list framework. */
const repoListConfig: OrgListConfig<SentryRepository, RepositoryWithOrg> = {
  paginationKey: PAGINATION_KEY,
  entityName: "repository",
  entityPlural: "repositories",
  commandPrefix: "sentry repo list",
  listForOrg: (org) => listRepositories(org),
  listPaginated: (org, opts) => listRepositoriesPaginated(org, opts),
  withOrg: (repo, orgSlug) => ({ ...repo, orgSlug }),
  displayTable: (stdout: Writer, repos: RepositoryWithOrg[]) =>
    writeTable(stdout, repos, REPO_COLUMNS),
};

const docs: OrgListCommandDocs = {
  brief: "List repositories",
  fullDescription:
    "List repositories connected to an organization.\n\n" +
    "Target specification:\n" +
    "  sentry repo list               # auto-detect from DSN or config\n" +
    "  sentry repo list <org>/        # list all repos in org (paginated)\n" +
    "  sentry repo list <org>/<proj>  # list repos in org (project context)\n" +
    "  sentry repo list <org>         # list repos in org\n\n" +
    "Pagination:\n" +
    "  sentry repo list <org>/ -c last  # continue from last page\n\n" +
    "Examples:\n" +
    "  sentry repo list              # auto-detect or list all\n" +
    "  sentry repo list my-org/      # list repositories in my-org (paginated)\n" +
    "  sentry repo list --limit 10\n" +
    "  sentry repo list --json",
};

export const listCommand = buildOrgListCommand(repoListConfig, docs, "repo");
