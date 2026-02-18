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
import { listTeams, listTeamsPaginated } from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { type Column, writeTable } from "../../lib/formatters/table.js";
import {
  dispatchOrgScopedList,
  type OrgListConfig,
} from "../../lib/org-list.js";
import type { SentryTeam, Writer } from "../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "team-list";

/** Team with its organization context for display */
type TeamWithOrg = SentryTeam & { orgSlug?: string };

/** Column definitions for the team table. */
const TEAM_COLUMNS: Column<TeamWithOrg>[] = [
  { header: "ORG", value: (t) => t.orgSlug || "", minWidth: 3 },
  { header: "SLUG", value: (t) => t.slug, minWidth: 4 },
  { header: "NAME", value: (t) => t.name, minWidth: 4 },
  {
    header: "MEMBERS",
    value: (t) => String(t.memberCount ?? ""),
    align: "right",
    minWidth: 7,
  },
];

/** Shared config that plugs into the org-list framework. */
const teamListConfig: OrgListConfig<SentryTeam, TeamWithOrg> = {
  paginationKey: PAGINATION_KEY,
  entityName: "team",
  entityPlural: "teams",
  commandPrefix: "sentry team list",
  listForOrg: (org) => listTeams(org),
  listPaginated: (org, opts) => listTeamsPaginated(org, opts),
  withOrg: (team, orgSlug) => ({ ...team, orgSlug }),
  displayTable: (stdout: Writer, teams: TeamWithOrg[]) =>
    writeTable(stdout, teams, TEAM_COLUMNS),
};

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
    flags: {
      readonly limit: number;
      readonly json: boolean;
      readonly cursor?: string;
    },
    target?: string
  ): Promise<void> {
    const { stdout, cwd } = this;
    const parsed = parseOrgProjectArg(target);
    await dispatchOrgScopedList({
      config: teamListConfig,
      stdout,
      cwd,
      flags,
      parsed,
    });
  },
});
