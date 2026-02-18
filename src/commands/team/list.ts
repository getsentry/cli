/**
 * sentry team list
 *
 * List teams in an organization.
 */

import type { SentryContext } from "../../context.js";
import { listTeams } from "../../lib/api-client.js";
import {
  listCommand as buildListCommand,
  fetchFromOrgs,
  resolveOrgsForList,
} from "../../lib/list-helpers.js";
import type { SentryTeam, Writer } from "../../types/index.js";

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

export const listCommand = buildListCommand<TeamWithOrg>({
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
  limit: 30,
  positional: {
    placeholder: "org",
    brief: "Organization slug (optional)",
    optional: true,
  },
  itemName: "teams",
  emptyMessage: (_, org) =>
    org ? `No teams found in organization '${org}'.` : "No teams found.",
  footerTip: "Tip: Use 'sentry team list <org>' to filter by organization",
  async fetch(this: SentryContext, flags, org) {
    const { orgSlugs, footer, skippedSelfHosted } = await resolveOrgsForList(
      org,
      this.cwd
    );

    const effectiveSlugs = orgSlugs.length > 0 ? orgSlugs : ("all" as const);
    const allTeams = await fetchFromOrgs<TeamWithOrg>({
      orgSlugs: effectiveSlugs,
      fetcher: async (slug) => {
        const teams = await listTeams(slug);
        return teams.map((t) => ({ ...t, orgSlug: slug }));
      },
    });

    // Scale limit when multiple orgs
    const limitCount =
      orgSlugs.length > 1 ? flags.limit * orgSlugs.length : flags.limit;
    const items = allTeams.slice(0, limitCount);

    return {
      items,
      total: allTeams.length > limitCount ? allTeams.length : undefined,
      footer,
      skippedSelfHosted,
    };
  },
  render(items, stdout) {
    const widths = calculateColumnWidths(items);
    writeHeader(stdout, widths);
    writeRows({ stdout, teams: items, ...widths });
  },
});
