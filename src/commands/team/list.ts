/**
 * sentry team list
 *
 * List teams in an organization.
 */

import type { SentryContext } from "../../context.js";
import { listOrganizations, listTeams } from "../../lib/api-client.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { getDefaultOrganization } from "../../lib/db/defaults.js";
import { AuthError } from "../../lib/errors.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import { resolveAllTargets } from "../../lib/resolve-target.js";
import type { SentryTeam, Writer } from "../../types/index.js";

type ListFlags = {
  readonly limit: number;
  readonly json: boolean;
};

/** Team with its organization context for display */
type TeamWithOrg = SentryTeam & { orgSlug?: string };

/**
 * Fetch teams for a single organization.
 *
 * @param orgSlug - Organization slug to fetch teams from
 * @returns Teams with org context attached
 */
async function fetchOrgTeams(orgSlug: string): Promise<TeamWithOrg[]> {
  const teams = await listTeams(orgSlug);
  return teams.map((t) => ({ ...t, orgSlug }));
}

/**
 * Fetch teams for a single org, returning empty array on non-auth errors.
 * Auth errors propagate so user sees "please log in" message.
 */
async function fetchOrgTeamsSafe(orgSlug: string): Promise<TeamWithOrg[]> {
  try {
    return await fetchOrgTeams(orgSlug);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    return [];
  }
}

/**
 * Fetch teams from all accessible organizations.
 * Skips orgs where the user lacks access.
 *
 * @returns Combined list of teams from all accessible orgs
 */
async function fetchAllOrgTeams(): Promise<TeamWithOrg[]> {
  const orgs = await listOrganizations();
  const results: TeamWithOrg[] = [];

  for (const org of orgs) {
    try {
      const teams = await fetchOrgTeams(org.slug);
      results.push(...teams);
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      // User may lack access to some orgs
    }
  }

  return results;
}

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

/** Result of resolving organizations to fetch teams from */
type OrgResolution = {
  orgs: string[];
  footer?: string;
  skippedSelfHosted?: number;
};

/**
 * Resolve which organizations to fetch teams from.
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
    brief: "List teams",
    fullDescription:
      "List teams in an organization. If no organization is specified, " +
      "uses the default organization or lists teams from all accessible organizations.\n\n" +
      "Examples:\n" +
      "  sentry team list              # auto-detect or list all\n" +
      "  sentry team list my-org       # list teams in my-org\n" +
      "  sentry team list --limit 10\n" +
      "  sentry team list --json",
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
        brief: "Maximum number of teams to list",
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

    // Fetch teams from resolved orgs (or all accessible if none detected)
    let allTeams: TeamWithOrg[];
    if (orgsToFetch.length > 0) {
      const results = await Promise.all(orgsToFetch.map(fetchOrgTeamsSafe));
      allTeams = results.flat();
    } else {
      allTeams = await fetchAllOrgTeams();
    }

    // Apply limit (scale limit when multiple orgs)
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

    const widths = calculateColumnWidths(limited);
    writeHeader(stdout, widths);
    writeRows({
      stdout,
      teams: limited,
      ...widths,
    });

    if (allTeams.length > limited.length) {
      stdout.write(`\nShowing ${limited.length} of ${allTeams.length} teams\n`);
    }

    if (footer) {
      stdout.write(`\n${footer}\n`);
    }

    if (skippedSelfHosted) {
      stdout.write(
        `\nNote: ${skippedSelfHosted} DSN(s) could not be resolved. ` +
          "Specify the organization explicitly: sentry team list <org>\n"
      );
    }

    writeFooter(
      stdout,
      "Tip: Use 'sentry team list <org>' to filter by organization"
    );
  },
});
