/**
 * sentry release list
 *
 * List releases in an organization with pagination support.
 * Includes per-project health/adoption metrics when available.
 */

import type { OrgReleaseResponse } from "@sentry/api";
import type { SentryContext } from "../../context.js";
import {
  listReleasesPaginated,
  type ReleaseSortValue,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { escapeMarkdownCell } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { type Column, formatTable } from "../../lib/formatters/table.js";
import { formatRelativeTime } from "../../lib/formatters/time-utils.js";
import {
  buildListCommand,
  buildListLimitFlag,
  LIST_BASE_ALIASES,
  LIST_TARGET_POSITIONAL,
} from "../../lib/list-command.js";
import {
  dispatchOrgScopedList,
  jsonTransformListResult,
  type ListResult,
  type OrgListConfig,
} from "../../lib/org-list.js";
import { fmtPct } from "./format.js";

export const PAGINATION_KEY = "release-list";

type ReleaseWithOrg = OrgReleaseResponse & { orgSlug?: string };

/** Valid values for the `--sort` flag. */
const VALID_SORT_VALUES: ReleaseSortValue[] = [
  "date",
  "sessions",
  "users",
  "crash_free_sessions",
  "crash_free_users",
];

const DEFAULT_SORT: ReleaseSortValue = "date";

/**
 * Parse and validate the `--sort` flag value.
 *
 * @throws Error when value is not one of the accepted sort keys
 */
function parseSortFlag(value: string): ReleaseSortValue {
  if (VALID_SORT_VALUES.includes(value as ReleaseSortValue)) {
    return value as ReleaseSortValue;
  }
  throw new Error(
    `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
  );
}

/**
 * Extract health data from the first project that has it.
 *
 * A release spans multiple projects; each gets independent health data.
 * For the list table we pick the first project with `hasHealthData: true`.
 */
function getHealthData(release: OrgReleaseResponse) {
  return release.projects?.find((p) => p.healthData?.hasHealthData)?.healthData;
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

/**
 * Build the OrgListConfig with the given sort value baked into API calls.
 *
 * We build this per-invocation so the `--sort` flag value flows into
 * `listForOrg` and `listPaginated` closures.
 */
function buildReleaseListConfig(
  sort: ReleaseSortValue
): OrgListConfig<OrgReleaseResponse, ReleaseWithOrg> {
  return {
    paginationKey: PAGINATION_KEY,
    entityName: "release",
    entityPlural: "releases",
    commandPrefix: "sentry release list",
    listForOrg: async (org) => {
      const { data } = await listReleasesPaginated(org, {
        perPage: 100,
        health: true,
        sort,
      });
      return data;
    },
    listPaginated: (org, opts) =>
      listReleasesPaginated(org, { ...opts, health: true, sort }),
    withOrg: (release, orgSlug) => ({ ...release, orgSlug }),
    displayTable: (releases: ReleaseWithOrg[]) =>
      formatTable(releases, RELEASE_COLUMNS),
  };
}

/** Format a ListResult as human-readable output. */
function formatListHuman(result: ListResult<ReleaseWithOrg>): string {
  const parts: string[] = [];

  if (result.items.length === 0) {
    if (result.hint) {
      parts.push(result.hint);
    }
    return parts.join("\n");
  }

  parts.push(formatTable(result.items, RELEASE_COLUMNS));

  if (result.header) {
    parts.push(`\n${result.header}`);
  }

  return parts.join("");
}

type ListFlags = {
  readonly limit: number;
  readonly sort: ReleaseSortValue;
  readonly json: boolean;
  readonly cursor?: string;
  readonly fresh: boolean;
  readonly fields?: string[];
};

export const listCommand = buildListCommand("release", {
  docs: {
    brief: "List releases with adoption and health metrics",
    fullDescription:
      "List releases in an organization with adoption and crash-free metrics.\n\n" +
      "Health data (adoption %, crash-free session rate) is shown per-release\n" +
      "from the first project that has session data.\n\n" +
      "Sort options:\n" +
      "  date                 # by creation date (default)\n" +
      "  sessions             # by total sessions\n" +
      "  users                # by total users\n" +
      "  crash_free_sessions  # by crash-free session rate\n" +
      "  crash_free_users     # by crash-free user rate\n\n" +
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
      "  sentry release list --sort crash_free_sessions\n" +
      "  sentry release list --limit 10\n" +
      "  sentry release list --json\n\n" +
      "Alias: `sentry releases` → `sentry release list`",
  },
  output: {
    human: formatListHuman,
    jsonTransform: (result: ListResult<ReleaseWithOrg>, fields?: string[]) =>
      jsonTransformListResult(result, fields),
  },
  parameters: {
    positional: LIST_TARGET_POSITIONAL,
    flags: {
      limit: buildListLimitFlag("releases"),
      sort: {
        kind: "parsed" as const,
        parse: parseSortFlag,
        brief:
          "Sort order: date, sessions, users, crash_free_sessions, crash_free_users",
        default: DEFAULT_SORT,
      },
    },
    aliases: { ...LIST_BASE_ALIASES, s: "sort" },
  },
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    const { cwd } = this;
    const parsed = parseOrgProjectArg(target);
    const config = buildReleaseListConfig(flags.sort);
    const result = await dispatchOrgScopedList({
      config,
      cwd,
      flags,
      parsed,
      orgSlugMatchBehavior: "redirect",
    });
    yield new CommandOutput(result);
    const hint = result.items.length > 0 ? result.hint : undefined;
    return { hint };
  },
});
