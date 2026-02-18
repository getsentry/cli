/**
 * sentry repo list
 *
 * List repositories in an organization.
 */

import type { SentryContext } from "../../context.js";
import { listRepositories } from "../../lib/api-client.js";
import {
  listCommand as buildListCommand,
  fetchFromOrgs,
  resolveOrgsForList,
} from "../../lib/list-helpers.js";
import type { SentryRepository, Writer } from "../../types/index.js";

/** Repository with its organization context for display */
type RepositoryWithOrg = SentryRepository & { orgSlug?: string };

/** Column widths for repository list display */
type ColumnWidths = {
  orgWidth: number;
  nameWidth: number;
  providerWidth: number;
  statusWidth: number;
};

/**
 * Calculate column widths for repository list display.
 */
function calculateColumnWidths(repos: RepositoryWithOrg[]): ColumnWidths {
  const orgWidth = Math.max(...repos.map((r) => (r.orgSlug || "").length), 3);
  const nameWidth = Math.max(...repos.map((r) => r.name.length), 4);
  const providerWidth = Math.max(
    ...repos.map((r) => r.provider.name.length),
    8
  );
  const statusWidth = Math.max(...repos.map((r) => r.status.length), 6);
  return { orgWidth, nameWidth, providerWidth, statusWidth };
}

/**
 * Write the column header row for repository list output.
 */
function writeHeader(stdout: Writer, widths: ColumnWidths): void {
  const { orgWidth, nameWidth, providerWidth, statusWidth } = widths;
  const org = "ORG".padEnd(orgWidth);
  const name = "NAME".padEnd(nameWidth);
  const provider = "PROVIDER".padEnd(providerWidth);
  const status = "STATUS".padEnd(statusWidth);
  stdout.write(`${org}  ${name}  ${provider}  ${status}  URL\n`);
}

type WriteRowsOptions = ColumnWidths & {
  stdout: Writer;
  repos: RepositoryWithOrg[];
};

/**
 * Write formatted repository rows to stdout.
 */
function writeRows(options: WriteRowsOptions): void {
  const { stdout, repos, orgWidth, nameWidth, providerWidth, statusWidth } =
    options;
  for (const repo of repos) {
    const org = (repo.orgSlug || "").padEnd(orgWidth);
    const name = repo.name.padEnd(nameWidth);
    const provider = repo.provider.name.padEnd(providerWidth);
    const status = repo.status.padEnd(statusWidth);
    const url = repo.url || "";
    stdout.write(`${org}  ${name}  ${provider}  ${status}  ${url}\n`);
  }
}

export const listCommand = buildListCommand<RepositoryWithOrg>({
  docs: {
    brief: "List repositories",
    fullDescription:
      "List repositories connected to an organization. If no organization is specified, " +
      "uses the default organization or lists repositories from all accessible organizations.\n\n" +
      "Examples:\n" +
      "  sentry repo list              # auto-detect or list all\n" +
      "  sentry repo list my-org       # list repositories in my-org\n" +
      "  sentry repo list --limit 10\n" +
      "  sentry repo list --json",
  },
  limit: 30,
  positional: {
    placeholder: "org",
    brief: "Organization slug (optional)",
    optional: true,
  },
  itemName: "repositories",
  emptyMessage: (_, org) =>
    org
      ? `No repositories found in organization '${org}'.`
      : "No repositories found.",
  footerTip: "Tip: Use 'sentry repo list <org>' to filter by organization",
  async fetch(this: SentryContext, flags, org) {
    const { orgSlugs, footer, skippedSelfHosted } = await resolveOrgsForList(
      org,
      this.cwd
    );

    const effectiveSlugs = orgSlugs.length > 0 ? orgSlugs : ("all" as const);
    const allRepos = await fetchFromOrgs<RepositoryWithOrg>({
      orgSlugs: effectiveSlugs,
      fetcher: async (slug) => {
        const repos = await listRepositories(slug);
        return repos.map((r) => ({ ...r, orgSlug: slug }));
      },
    });

    // Scale limit when multiple orgs
    const limitCount =
      orgSlugs.length > 1 ? flags.limit * orgSlugs.length : flags.limit;
    const items = allRepos.slice(0, limitCount);

    return {
      items,
      total: allRepos.length > limitCount ? allRepos.length : undefined,
      footer,
      skippedSelfHosted,
    };
  },
  render(items, stdout) {
    const widths = calculateColumnWidths(items);
    writeHeader(stdout, widths);
    writeRows({ stdout, repos: items, ...widths });
  },
});
