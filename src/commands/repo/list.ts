/**
 * sentry repo list
 *
 * List repositories in an organization.
 */

import type { SentryContext } from "../../context.js";
import { listOrganizations, listRepositories } from "../../lib/api-client.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { getDefaultOrganization } from "../../lib/db/defaults.js";
import { AuthError } from "../../lib/errors.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import { resolveAllTargets } from "../../lib/resolve-target.js";
import type { SentryRepository, Writer } from "../../types/index.js";

type ListFlags = {
  readonly limit: number;
  readonly json: boolean;
};

/** Repository with its organization context for display */
type RepositoryWithOrg = SentryRepository & { orgSlug?: string };

/**
 * Fetch repositories for a single organization.
 *
 * @param orgSlug - Organization slug to fetch repositories from
 * @returns Repositories with org context attached
 */
async function fetchOrgRepositories(
  orgSlug: string
): Promise<RepositoryWithOrg[]> {
  const repos = await listRepositories(orgSlug);
  return repos.map((r) => ({ ...r, orgSlug }));
}

/**
 * Fetch repositories for a single org, returning empty array on non-auth errors.
 * Auth errors propagate so user sees "please log in" message.
 */
async function fetchOrgRepositoriesSafe(
  orgSlug: string
): Promise<RepositoryWithOrg[]> {
  try {
    return await fetchOrgRepositories(orgSlug);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    return [];
  }
}

/**
 * Fetch repositories from all accessible organizations.
 * Skips orgs where the user lacks access.
 *
 * @returns Combined list of repositories from all accessible orgs
 */
async function fetchAllOrgRepositories(): Promise<RepositoryWithOrg[]> {
  const orgs = await listOrganizations();
  const results: RepositoryWithOrg[] = [];

  for (const org of orgs) {
    try {
      const repos = await fetchOrgRepositories(org.slug);
      results.push(...repos);
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      // User may lack access to some orgs
    }
  }

  return results;
}

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

/** Result of resolving organizations to fetch repositories from */
type OrgResolution = {
  orgs: string[];
  footer?: string;
  skippedSelfHosted?: number;
};

/**
 * Resolve which organizations to fetch repositories from.
 * Uses CLI flag, config defaults, or DSN auto-detection.
 */
async function resolveOrgsToFetch(
  orgFlag: string | undefined,
  cwd: string
): Promise<OrgResolution> {
  // 1. If positional org provided, use it directly
  if (orgFlag) {
    return { orgs: [orgFlag] };
  }

  // 2. Check config defaults
  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return { orgs: [defaultOrg] };
  }

  // 3. Auto-detect from DSNs (may find multiple in monorepos)
  try {
    const { targets, footer, skippedSelfHosted } = await resolveAllTargets({
      cwd,
    });

    if (targets.length > 0) {
      const uniqueOrgs = [...new Set(targets.map((t) => t.org))];
      return {
        orgs: uniqueOrgs,
        footer,
        skippedSelfHosted,
      };
    }

    // No resolvable targets, but may have self-hosted DSNs
    return { orgs: [], skippedSelfHosted };
  } catch (error) {
    // Auth errors should propagate - user needs to log in
    if (error instanceof AuthError) {
      throw error;
    }
    // Fall through to empty orgs for other errors (network, etc.)
  }

  return { orgs: [] };
}

export const listCommand = buildCommand({
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
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org",
          brief: "Organization slug (optional)",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of repositories to list",
        default: "30",
      },
      json: {
        kind: "boolean",
        brief: "Output JSON",
        default: false,
      },
    },
    aliases: { n: "limit" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    org?: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    // Resolve which organizations to fetch from
    const {
      orgs: orgsToFetch,
      footer,
      skippedSelfHosted,
    } = await resolveOrgsToFetch(org, cwd);

    // Fetch repositories from all orgs (or all accessible if none detected)
    let allRepos: RepositoryWithOrg[];
    if (orgsToFetch.length > 0) {
      const results = await Promise.all(
        orgsToFetch.map(fetchOrgRepositoriesSafe)
      );
      allRepos = results.flat();
    } else {
      allRepos = await fetchAllOrgRepositories();
    }

    // Apply limit (limit is per-org when multiple orgs)
    const limitCount =
      orgsToFetch.length > 1 ? flags.limit * orgsToFetch.length : flags.limit;
    const limited = allRepos.slice(0, limitCount);

    if (flags.json) {
      writeJson(stdout, limited);
      return;
    }

    if (limited.length === 0) {
      const msg =
        orgsToFetch.length === 1
          ? `No repositories found in organization '${orgsToFetch[0]}'.\n`
          : "No repositories found.\n";
      stdout.write(msg);
      return;
    }

    const widths = calculateColumnWidths(limited);
    writeHeader(stdout, widths);
    writeRows({
      stdout,
      repos: limited,
      ...widths,
    });

    if (allRepos.length > limited.length) {
      stdout.write(
        `\nShowing ${limited.length} of ${allRepos.length} repositories\n`
      );
    }

    if (footer) {
      stdout.write(`\n${footer}\n`);
    }

    if (skippedSelfHosted) {
      stdout.write(
        `\nNote: ${skippedSelfHosted} DSN(s) could not be resolved. ` +
          "Specify the organization explicitly: sentry repo list <org>\n"
      );
    }

    writeFooter(
      stdout,
      "Tip: Use 'sentry repo list <org>' to filter by organization"
    );
  },
});
