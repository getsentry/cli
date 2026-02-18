/**
 * sentry team list
 *
 * List teams in an organization, with flexible targeting and cursor pagination.
 *
 * Supports:
 * - Auto-detection from DSN/config
 * - Org-scoped listing with cursor pagination (e.g., sentry/)
 * - Project-scoped listing (e.g., sentry/cli) - lists teams for that project's org
 * - Cross-org project search (e.g., sentry)
 */

import type { SentryContext } from "../../context.js";
import {
  listOrganizations,
  listTeams,
  listTeamsPaginated,
  type PaginatedResponse,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import {
  buildOrgContextKey,
  clearPaginationCursor,
  resolveOrgCursor,
  setPaginationCursor,
} from "../../lib/db/pagination.js";
import { AuthError, ValidationError } from "../../lib/errors.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import { resolveOrgsForListing } from "../../lib/resolve-target.js";
import type { SentryTeam, Writer } from "../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "team-list";

type ListFlags = {
  readonly limit: number;
  readonly json: boolean;
  readonly cursor?: string;
};

/** Team with its organization context for display */
type TeamWithOrg = SentryTeam & { orgSlug?: string };

/** Column widths for team list display */
type ColumnWidths = {
  orgWidth: number;
  slugWidth: number;
  nameWidth: number;
  membersWidth: number;
};

/**
 * Calculate column widths for team list display.
 */
function calculateColumnWidths(teams: TeamWithOrg[]): ColumnWidths {
  const orgWidth = Math.max(...teams.map((t) => (t.orgSlug || "").length), 3);
  const slugWidth = Math.max(...teams.map((t) => t.slug.length), 4);
  const nameWidth = Math.max(...teams.map((t) => t.name.length), 4);
  const membersWidth = Math.max(
    ...teams.map((t) => String(t.memberCount ?? "").length),
    7
  );
  return { orgWidth, slugWidth, nameWidth, membersWidth };
}

/**
 * Write the column header row for team list output.
 */
function writeHeader(stdout: Writer, widths: ColumnWidths): void {
  const { orgWidth, slugWidth, nameWidth, membersWidth } = widths;
  const org = "ORG".padEnd(orgWidth);
  const slug = "SLUG".padEnd(slugWidth);
  const name = "NAME".padEnd(nameWidth);
  const members = "MEMBERS".padStart(membersWidth);
  stdout.write(`${org}  ${slug}  ${name}  ${members}\n`);
}

type WriteRowsOptions = ColumnWidths & {
  stdout: Writer;
  teams: TeamWithOrg[];
};

/**
 * Write formatted team rows to stdout.
 */
function writeRows(options: WriteRowsOptions): void {
  const { stdout, teams, orgWidth, slugWidth, nameWidth, membersWidth } =
    options;
  for (const team of teams) {
    const org = (team.orgSlug || "").padEnd(orgWidth);
    const slug = team.slug.padEnd(slugWidth);
    const name = team.name.padEnd(nameWidth);
    const members = String(team.memberCount ?? "").padStart(membersWidth);
    stdout.write(`${org}  ${slug}  ${name}  ${members}\n`);
  }
}

/** Display teams in table format with header and rows */
function displayTeamTable(stdout: Writer, teams: TeamWithOrg[]): void {
  const widths = calculateColumnWidths(teams);
  writeHeader(stdout, widths);
  writeRows({ stdout, teams, ...widths });
}

/**
 * Fetch teams for a single org, returning empty array on non-auth errors.
 */
async function fetchOrgTeamsSafe(orgSlug: string): Promise<TeamWithOrg[]> {
  try {
    const teams = await listTeams(orgSlug);
    return teams.map((t) => ({ ...t, orgSlug }));
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    return [];
  }
}

/**
 * Fetch teams from all accessible organizations.
 */
async function fetchAllOrgTeams(): Promise<TeamWithOrg[]> {
  const orgs = await listOrganizations();
  const results: TeamWithOrg[] = [];

  for (const org of orgs) {
    try {
      const teams = await listTeams(org.slug);
      results.push(...teams.map((t) => ({ ...t, orgSlug: org.slug })));
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      // User may lack access to some orgs
    }
  }

  return results;
}

/** Build the CLI hint for fetching the next page. */
function nextPageHint(org: string): string {
  return `sentry team list ${org}/ -c last`;
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
  const response: PaginatedResponse<SentryTeam[]> = await listTeamsPaginated(
    org,
    { cursor, perPage: flags.limit }
  );

  const teams: TeamWithOrg[] = response.data.map((t) => ({
    ...t,
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
      ? { data: teams, nextCursor: response.nextCursor, hasMore: true }
      : { data: teams, hasMore: false };
    writeJson(stdout, output);
    return;
  }

  if (teams.length === 0) {
    if (hasMore) {
      stdout.write(
        `No teams on this page. Try the next page: ${nextPageHint(org)}\n`
      );
    } else {
      stdout.write(`No teams found in organization '${org}'.\n`);
    }
    return;
  }

  displayTeamTable(stdout, teams);

  if (hasMore) {
    stdout.write(`\nShowing ${teams.length} teams (more available)\n`);
    stdout.write(`Next page: ${nextPageHint(org)}\n`);
  } else {
    stdout.write(`\nShowing ${teams.length} teams\n`);
  }
}

/**
 * Handle auto-detect and explicit org modes.
 * Fetches all teams for the resolved orgs (no cursor pagination).
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

  let allTeams: TeamWithOrg[];
  if (orgsToFetch.length > 0) {
    const results = await Promise.all(orgsToFetch.map(fetchOrgTeamsSafe));
    allTeams = results.flat();
  } else {
    allTeams = await fetchAllOrgTeams();
  }

  const limitCount =
    orgsToFetch.length > 1 ? flags.limit * orgsToFetch.length : flags.limit;
  const limited = allTeams.slice(0, limitCount);

  if (flags.json) {
    writeJson(stdout, limited);
    return;
  }

  if (limited.length === 0) {
    const msg =
      orgsToFetch.length === 1
        ? `No teams found in organization '${orgsToFetch[0]}'.\n`
        : "No teams found.\n";
    stdout.write(msg);
    return;
  }

  displayTeamTable(stdout, limited);

  if (allTeams.length > limited.length) {
    stdout.write(`\nShowing ${limited.length} of ${allTeams.length} teams\n`);
  }

  if (footer) {
    stdout.write(`\n${footer}\n`);
  }

  if (skippedSelfHosted) {
    stdout.write(
      `\nNote: ${skippedSelfHosted} DSN(s) could not be resolved. ` +
        "Specify the organization explicitly: sentry team list <org>/\n"
    );
  }

  writeFooter(
    stdout,
    "Tip: Use 'sentry team list <org>/' to filter by organization"
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
  const teams = await fetchOrgTeamsSafe(org);
  const limited = teams.slice(0, flags.limit);

  if (flags.json) {
    writeJson(stdout, limited);
    return;
  }

  if (limited.length === 0) {
    stdout.write(`No teams found in organization '${org}'.\n`);
    return;
  }

  displayTeamTable(stdout, limited);

  if (teams.length > limited.length) {
    stdout.write(
      `\nShowing ${limited.length} of ${teams.length} teams. ` +
        `Use 'sentry team list ${org}/' for paginated results.\n`
    );
  } else {
    stdout.write(`\nShowing ${limited.length} teams\n`);
  }

  writeFooter(
    stdout,
    `Tip: Use 'sentry team list ${org}/' for paginated results`
  );
}

export const listCommand = buildCommand({
  docs: {
    brief: "List teams",
    fullDescription:
      "List teams in an organization.\n\n" +
      "Target specification:\n" +
      "  sentry team list               # auto-detect from DSN or config\n" +
      "  sentry team list <org>/        # list all teams in org (paginated)\n" +
      "  sentry team list <org>/<proj>  # list teams in org (project context)\n" +
      "  sentry team list <org>         # list teams in org\n\n" +
      "Pagination:\n" +
      "  sentry team list <org>/ -c last  # continue from last page\n\n" +
      "Examples:\n" +
      "  sentry team list              # auto-detect or list all\n" +
      "  sentry team list my-org/      # list teams in my-org (paginated)\n" +
      "  sentry team list --limit 10\n" +
      "  sentry team list --json",
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
        brief: "Maximum number of teams to list",
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
        "The --cursor flag is only supported when listing teams for a specific organization " +
          "(e.g., sentry team list <org>/). " +
          "Use 'sentry team list <org>/' for paginated results.",
        "cursor"
      );
    }

    switch (parsed.type) {
      case "auto-detect":
        await handleAutoDetect(stdout, cwd, flags);
        break;

      case "explicit":
        // Use the org context; project part is ignored for team listing
        await handleExplicitOrg(stdout, parsed.org, flags);
        break;

      case "project-search":
        // Bare slug treated as org slug (no slash → team list for that org)
        await handleExplicitOrg(stdout, parsed.projectSlug, flags);
        break;

      case "org-all": {
        const contextKey = buildOrgContextKey(parsed.org);
        const cursor = resolveOrgCursor(
          flags.cursor,
          PAGINATION_KEY,
          contextKey
        );
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
