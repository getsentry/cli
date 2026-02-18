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

import type { SentryContext } from "../../context.js";
import {
  listOrganizations,
  listRepositories,
  listRepositoriesPaginated,
  type PaginatedResponse,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import {
  clearPaginationCursor,
  getPaginationCursor,
  setPaginationCursor,
} from "../../lib/db/pagination.js";
import { AuthError, ContextError, ValidationError } from "../../lib/errors.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import { resolveOrgsForListing } from "../../lib/resolve-target.js";
import { getApiBaseUrl } from "../../lib/sentry-client.js";
import type { SentryRepository, Writer } from "../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "repo-list";

type ListFlags = {
  readonly limit: number;
  readonly json: boolean;
  readonly cursor?: string;
};

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

/** Display repositories in table format with header and rows */
function displayRepoTable(stdout: Writer, repos: RepositoryWithOrg[]): void {
  const widths = calculateColumnWidths(repos);
  writeHeader(stdout, widths);
  writeRows({ stdout, repos, ...widths });
}

/**
 * Fetch repositories for a single org, returning empty array on non-auth errors.
 */
async function fetchOrgRepositoriesSafe(
  orgSlug: string
): Promise<RepositoryWithOrg[]> {
  try {
    const repos = await listRepositories(orgSlug);
    return repos.map((r) => ({ ...r, orgSlug }));
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    return [];
  }
}

/**
 * Fetch repositories from all accessible organizations.
 */
async function fetchAllOrgRepositories(): Promise<RepositoryWithOrg[]> {
  const orgs = await listOrganizations();
  const results: RepositoryWithOrg[] = [];

  for (const org of orgs) {
    try {
      const repos = await listRepositories(org.slug);
      results.push(...repos.map((r) => ({ ...r, orgSlug: org.slug })));
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      // User may lack access to some orgs
    }
  }

  return results;
}

/**
 * Build a context key for pagination cursor validation.
 * Captures the org so cursors from different orgs are never mixed.
 */
function buildContextKey(org: string): string {
  return `host:${getApiBaseUrl()}|type:org:${org}`;
}

/**
 * Resolve the cursor value from --cursor flag.
 * Handles the magic "last" value by looking up the cached cursor.
 */
function resolveCursor(
  cursorFlag: string | undefined,
  contextKey: string
): string | undefined {
  if (!cursorFlag) {
    return;
  }
  if (cursorFlag === "last") {
    const cached = getPaginationCursor(PAGINATION_KEY, contextKey);
    if (!cached) {
      throw new ContextError(
        "Pagination cursor",
        "No saved cursor for this query. Run without --cursor first."
      );
    }
    return cached;
  }
  return cursorFlag;
}

/** Build the CLI hint for fetching the next page. */
function nextPageHint(org: string): string {
  return `sentry repo list ${org}/ -c last`;
}

type OrgAllOptions = {
  stdout: Writer;
  org: string;
  flags: ListFlags;
  contextKey: string;
  cursor: string | undefined;
};

/**
 * Handle org-all mode (e.g., sentry/).
 * Uses cursor pagination for efficient page-by-page listing.
 */
async function handleOrgAll(options: OrgAllOptions): Promise<void> {
  const { stdout, org, flags, contextKey, cursor } = options;
  const response: PaginatedResponse<SentryRepository[]> =
    await listRepositoriesPaginated(org, { cursor, perPage: flags.limit });

  const repos: RepositoryWithOrg[] = response.data.map((r) => ({
    ...r,
    orgSlug: org,
  }));
  const hasMore = !!response.nextCursor;

  // Update cursor cache for `--cursor last` support
  if (response.nextCursor) {
    setPaginationCursor(PAGINATION_KEY, contextKey, response.nextCursor);
  } else {
    clearPaginationCursor(PAGINATION_KEY, contextKey);
  }

  if (flags.json) {
    const output = hasMore
      ? { data: repos, nextCursor: response.nextCursor, hasMore: true }
      : { data: repos, hasMore: false };
    writeJson(stdout, output);
    return;
  }

  if (repos.length === 0) {
    if (hasMore) {
      stdout.write(
        `No repositories on this page. Try the next page: ${nextPageHint(org)}\n`
      );
    } else {
      stdout.write(`No repositories found in organization '${org}'.\n`);
    }
    return;
  }

  displayRepoTable(stdout, repos);

  if (hasMore) {
    stdout.write(`\nShowing ${repos.length} repositories (more available)\n`);
    stdout.write(`Next page: ${nextPageHint(org)}\n`);
  } else {
    stdout.write(`\nShowing ${repos.length} repositories\n`);
  }

  writeFooter(
    stdout,
    "Tip: Use 'sentry repo list <org>/' for paginated results"
  );
}

/**
 * Handle auto-detect mode: resolve orgs from config/DSN, fetch all repos.
 */
async function handleAutoDetect(
  stdout: Writer,
  cwd: string,
  flags: ListFlags
): Promise<void> {
  const {
    orgs: orgsToFetch,
    footer,
    skippedSelfHosted,
  } = await resolveOrgsForListing(undefined, cwd);

  let allRepos: RepositoryWithOrg[];
  if (orgsToFetch.length > 0) {
    const results = await Promise.all(
      orgsToFetch.map(fetchOrgRepositoriesSafe)
    );
    allRepos = results.flat();
  } else {
    allRepos = await fetchAllOrgRepositories();
  }

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

  displayRepoTable(stdout, limited);

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
        "Specify the organization explicitly: sentry repo list <org>/\n"
    );
  }

  writeFooter(
    stdout,
    "Tip: Use 'sentry repo list <org>/' to filter by organization"
  );
}

/**
 * Handle a single explicit org (non-paginated fetch).
 */
async function handleExplicitOrg(
  stdout: Writer,
  org: string,
  flags: ListFlags
): Promise<void> {
  const repos = await fetchOrgRepositoriesSafe(org);
  const limited = repos.slice(0, flags.limit);

  if (flags.json) {
    writeJson(stdout, limited);
    return;
  }

  if (limited.length === 0) {
    stdout.write(`No repositories found in organization '${org}'.\n`);
    return;
  }

  displayRepoTable(stdout, limited);

  if (repos.length > limited.length) {
    stdout.write(
      `\nShowing ${limited.length} of ${repos.length} repositories. ` +
        `Use 'sentry repo list ${org}/' for paginated results.\n`
    );
  } else {
    stdout.write(`\nShowing ${limited.length} repositories\n`);
  }

  writeFooter(
    stdout,
    `Tip: Use 'sentry repo list ${org}/' for paginated results`
  );
}

export const listCommand = buildCommand({
  docs: {
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
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "target",
          brief: "Target: <org>/, <org>/<project>, or <org>",
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
      cursor: {
        kind: "parsed",
        parse: String,
        brief: 'Pagination cursor (use "last" to continue from previous page)',
        optional: true,
      },
    },
    aliases: { n: "limit", c: "cursor" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    const parsed = parseOrgProjectArg(target);

    // Cursor pagination is only supported in org-all mode
    if (flags.cursor && parsed.type !== "org-all") {
      throw new ValidationError(
        "The --cursor flag is only supported when listing repositories for a specific organization " +
          "(e.g., sentry repo list <org>/). " +
          "Use 'sentry repo list <org>/' for paginated results.",
        "cursor"
      );
    }

    switch (parsed.type) {
      case "auto-detect":
        await handleAutoDetect(stdout, cwd, flags);
        break;

      case "explicit":
        // Use the org context; project part is ignored for repo listing
        await handleExplicitOrg(stdout, parsed.org, flags);
        break;

      case "project-search":
        // Bare slug treated as org slug (no slash → repo list for that org)
        await handleExplicitOrg(stdout, parsed.projectSlug, flags);
        break;

      case "org-all": {
        const contextKey = buildContextKey(parsed.org);
        const cursor = resolveCursor(flags.cursor, contextKey);
        await handleOrgAll({
          stdout,
          org: parsed.org,
          flags,
          contextKey,
          cursor,
        });
        break;
      }

      default: {
        const _exhaustiveCheck: never = parsed;
        throw new Error(`Unexpected parsed type: ${_exhaustiveCheck}`);
      }
    }
  },
});
