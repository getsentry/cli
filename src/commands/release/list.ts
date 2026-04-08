/**
 * sentry release list
 *
 * List releases in an organization with health/adoption metrics,
 * project scoping, environment filtering, and rich terminal styling.
 */

import type { OrgReleaseResponse } from "@sentry/api";
import type { SentryContext } from "../../context.js";
import {
  type ListReleasesOptions,
  listReleasesForProject,
  listReleasesPaginated,
  type ReleaseSortValue,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import {
  colorTag,
  escapeMarkdownInline,
} from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { sparkline } from "../../lib/formatters/sparkline.js";
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
  type HandlerContext,
  jsonTransformListResult,
  type ListResult,
  type OrgListConfig,
} from "../../lib/org-list.js";
import {
  type ResolvedTarget,
  resolveAllTargets,
  toNumericId,
} from "../../lib/resolve-target.js";
import { buildReleaseUrl } from "../../lib/sentry-urls.js";
import { fmtCrashFree } from "./view.js";

export const PAGINATION_KEY = "release-list";

type ReleaseWithOrg = OrgReleaseResponse & { orgSlug?: string };

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

const VALID_SORT_VALUES: ReleaseSortValue[] = [
  "date",
  "sessions",
  "users",
  "crash_free_sessions",
  "crash_free_users",
];

const SORT_ALIASES: Record<string, ReleaseSortValue> = {
  stable_sessions: "crash_free_sessions",
  stable_users: "crash_free_users",
  cfs: "crash_free_sessions",
  cfu: "crash_free_users",
};

const DEFAULT_SORT: ReleaseSortValue = "date";

function parseSortFlag(value: string): ReleaseSortValue {
  if (VALID_SORT_VALUES.includes(value as ReleaseSortValue)) {
    return value as ReleaseSortValue;
  }
  const alias = SORT_ALIASES[value];
  if (alias) {
    return alias;
  }
  const allAccepted = [...VALID_SORT_VALUES, ...Object.keys(SORT_ALIASES)].join(
    ", "
  );
  throw new Error(`Invalid sort value. Must be one of: ${allAccepted}`);
}

// ---------------------------------------------------------------------------
// Health data helpers
// ---------------------------------------------------------------------------

/** Pick health data from the first project that has it. */
function getHealthData(release: OrgReleaseResponse) {
  return release.projects?.find((p) => p.healthData?.hasHealthData)?.healthData;
}

/** Extract session time-series from health stats `{ "<period>": [[ts, count], ...] }`. */
function extractSessionPoints(stats?: Record<string, unknown>): number[] {
  if (!stats) {
    return [];
  }
  const key = Object.keys(stats)[0];
  if (!key) {
    return [];
  }
  const buckets = stats[key];
  if (!Array.isArray(buckets)) {
    return [];
  }
  return buckets.map((b: unknown) =>
    Array.isArray(b) && b.length >= 2 ? Number(b[1]) || 0 : 0
  );
}

// ---------------------------------------------------------------------------
// Cell formatters (rich styling, matching issue list patterns)
// ---------------------------------------------------------------------------

/**
 * Format the VERSION cell: bold version linked to Sentry release page.
 * Second line: muted "age | last-deploy-env".
 */
function formatVersionCell(r: ReleaseWithOrg): string {
  const version = escapeMarkdownInline(r.shortVersion || r.version);
  const org = r.orgSlug || "";
  const linked = org
    ? `[**${version}**](${buildReleaseUrl(org, r.version)})`
    : `**${version}**`;
  const age = r.dateCreated ? formatRelativeTime(r.dateCreated) : "";
  const env = r.lastDeploy?.environment || "";
  const subtitle = [age, env].filter(Boolean).join(" | ");
  if (subtitle) {
    return `${linked}\n${colorTag("muted", subtitle)}`;
  }
  return linked;
}

/** Color adoption percentage: green ≥ 50%, yellow ≥ 10%, default otherwise. */
function formatAdoption(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return colorTag("muted", "—");
  }
  const text = `${value.toFixed(0)}%`;
  if (value >= 50) {
    return colorTag("green", text);
  }
  if (value >= 10) {
    return colorTag("yellow", text);
  }
  return text;
}

/** Session sparkline in muted color. */
function formatSessionSparkline(r: OrgReleaseResponse): string {
  const health = getHealthData(r);
  if (!health) {
    return "";
  }
  const points = extractSessionPoints(
    health.stats as Record<string, unknown> | undefined
  );
  if (points.length === 0) {
    return "";
  }
  return colorTag("muted", sparkline(points));
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const RELEASE_COLUMNS: Column<ReleaseWithOrg>[] = [
  { header: "ORG", value: (r) => r.orgSlug || "" },
  {
    header: "VERSION",
    value: formatVersionCell,
    shrinkable: false,
  },
  {
    header: "ADOPTION",
    value: (r) => formatAdoption(getHealthData(r)?.adoption),
    align: "right",
  },
  {
    header: "SESSIONS",
    value: formatSessionSparkline,
  },
  {
    header: "CRASH-FREE",
    value: (r) => fmtCrashFree(getHealthData(r)?.crashFreeSessions),
    align: "right",
  },
  {
    header: "CRASHES",
    value: (r) => {
      const h = getHealthData(r);
      const v = h?.sessionsCrashed;
      if (v === undefined || v === null) {
        return colorTag("muted", "—");
      }
      return v > 0 ? colorTag("red", String(v)) : colorTag("green", "0");
    },
    align: "right",
  },
  {
    header: "NEW ISSUES",
    value: (r) => String(r.newGroups ?? 0),
    align: "right",
  },
];

/** Muted ANSI color for row separators (matches issue list). */
const MUTED_ANSI = "\x1b[38;2;137;130;148m";

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

/** Extra API options shared across listForOrg, listPaginated, and listForProject. */
type ExtraApiOptions = Pick<
  ListReleasesOptions,
  "sort" | "environment" | "statsPeriod" | "status"
>;

function buildReleaseListConfig(
  extra: ExtraApiOptions
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
        ...extra,
      });
      return data;
    },
    listPaginated: (org, opts) =>
      listReleasesPaginated(org, { ...opts, health: true, ...extra }),
    listForProject: (org, project) =>
      listReleasesForProject(org, project, { health: true, ...extra }),
    withOrg: (release, orgSlug) => ({ ...release, orgSlug }),
    displayTable: (releases: ReleaseWithOrg[]) =>
      formatTable(releases, RELEASE_COLUMNS, { rowSeparator: MUTED_ANSI }),
  };
}

// ---------------------------------------------------------------------------
// Human formatter
// ---------------------------------------------------------------------------

function formatListHuman(result: ListResult<ReleaseWithOrg>): string {
  const parts: string[] = [];

  if (result.items.length === 0) {
    if (result.hint) {
      parts.push(result.hint);
    }
    return parts.join("\n");
  }

  parts.push(
    formatTable(result.items, RELEASE_COLUMNS, { rowSeparator: MUTED_ANSI })
  );

  if (result.header) {
    parts.push(`\n${result.header}`);
  }

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Auto-detect override: resolve DSN → project-scoped listing
// ---------------------------------------------------------------------------

/**
 * Custom auto-detect handler that resolves DSN/config to org+project targets,
 * then fetches releases scoped to each detected project.
 *
 * The default auto-detect handler only resolves org slugs and calls
 * `listForOrg`, which returns ALL releases in the org. Since orgs can have
 * hundreds of projects, the specific project's releases get buried.
 * This override uses `resolveAllTargets` to get project context from DSN
 * detection, then passes project IDs to the API for scoped results.
 */
async function handleAutoDetectWithProject(
  config: OrgListConfig<OrgReleaseResponse, ReleaseWithOrg>,
  extra: ExtraApiOptions,
  ctx: HandlerContext<"auto-detect">
): Promise<ListResult<ReleaseWithOrg>> {
  const { cwd, flags } = ctx;
  const resolved = await resolveAllTargets({ cwd });

  if (resolved.targets.length === 0) {
    // No DSN/config found — fall back to org-wide listing via listForOrg
    const { data } = await listReleasesPaginated("", {
      perPage: flags.limit,
      health: true,
      ...extra,
    });
    return {
      items: data.map((r) => config.withOrg(r, "")),
      hint: "No project detected. Specify a target: sentry release list <org>/<project>",
    };
  }

  // Deduplicate by org+project
  const seen = new Set<string>();
  const unique: ResolvedTarget[] = [];
  for (const t of resolved.targets) {
    const key = `${t.org}/${t.project}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(t);
    }
  }

  // Fetch releases scoped to each detected project
  const allItems: ReleaseWithOrg[] = [];
  const hintParts: string[] = [];

  for (const t of unique) {
    const projectIds = t.projectId ? [t.projectId] : undefined;
    // If we don't have a numeric project ID, try to resolve it
    const ids = projectIds ?? (await resolveProjectIds(t.org, t.project));
    const { data } = await listReleasesPaginated(t.org, {
      perPage: Math.min(flags.limit, 100),
      health: true,
      project: ids,
      ...extra,
    });
    for (const release of data) {
      allItems.push(config.withOrg(release, t.org));
    }
  }

  const limited = allItems.slice(0, flags.limit);

  if (limited.length === 0) {
    const projects = unique.map((t) => `${t.org}/${t.project}`).join(", ");
    hintParts.push(`No releases found for ${projects}.`);
  }

  if (resolved.footer) {
    hintParts.push(resolved.footer);
  }

  const detectedFrom = unique
    .filter((t) => t.detectedFrom)
    .map((t) => `${t.project} (from ${t.detectedFrom})`)
    .join(", ");
  if (detectedFrom) {
    hintParts.push(`Detected: ${detectedFrom}`);
  }

  return {
    items: limited,
    hint: hintParts.length > 0 ? hintParts.join("\n") : undefined,
  };
}

/** Resolve a project slug to a numeric ID array for the API query param. */
async function resolveProjectIds(
  org: string,
  project: string
): Promise<number[] | undefined> {
  try {
    const { getProject } = await import("../../lib/api-client.js");
    const info = await getProject(org, project);
    const id = toNumericId(info.id);
    return id ? [id] : undefined;
  } catch {
    return;
  }
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

type ListFlags = {
  readonly limit: number;
  readonly sort: ReleaseSortValue;
  readonly environment?: string;
  readonly period: string;
  readonly status: string;
  readonly json: boolean;
  readonly cursor?: string;
  readonly fresh: boolean;
  readonly fields?: string[];
};

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const listCommand = buildListCommand("release", {
  docs: {
    brief: "List releases with adoption and health metrics",
    fullDescription:
      "List releases in an organization with adoption and crash-free metrics.\n\n" +
      "When run from a project directory (DSN auto-detection or explicit\n" +
      "<org>/<project> target), shows only releases for that project.\n\n" +
      "Sort options:\n" +
      "  date                 # by creation date (default)\n" +
      "  sessions             # by total sessions\n" +
      "  users                # by total users\n" +
      "  crash_free_sessions  # by crash-free session rate (aliases: stable_sessions, cfs)\n" +
      "  crash_free_users     # by crash-free user rate (aliases: stable_users, cfu)\n\n" +
      "Target specification:\n" +
      "  sentry release list               # auto-detect from DSN (project-scoped)\n" +
      "  sentry release list <org>/        # list all releases in org (paginated)\n" +
      "  sentry release list <org>/<proj>  # list releases for project\n" +
      "  sentry release list <org>         # list releases in org\n\n" +
      "Pagination:\n" +
      "  sentry release list <org>/ -c next  # fetch next page\n" +
      "  sentry release list <org>/ -c prev  # fetch previous page\n\n" +
      "Examples:\n" +
      "  sentry release list                         # auto-detect project\n" +
      "  sentry release list my-org/                  # all releases in org\n" +
      "  sentry release list my-org/my-proj           # project-scoped\n" +
      "  sentry release list --sort cfs               # sort by crash-free sessions\n" +
      "  sentry release list --environment production  # filter by env\n" +
      "  sentry release list --period 7d              # last 7 days of health data\n" +
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
          "Sort: date, sessions, users, crash_free_sessions (cfs), crash_free_users (cfu)",
        default: DEFAULT_SORT,
      },
      environment: {
        kind: "parsed" as const,
        parse: String,
        brief: "Filter by environment (e.g., production)",
        optional: true as const,
      },
      period: {
        kind: "parsed" as const,
        parse: String,
        brief: "Health stats period (e.g., 24h, 7d, 14d, 90d)",
        default: "90d",
      },
      status: {
        kind: "parsed" as const,
        parse: String,
        brief: "Filter by status: open (default) or archived",
        default: "open",
      },
    },
    aliases: { ...LIST_BASE_ALIASES, s: "sort", e: "environment", t: "period" },
  },
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    const { cwd } = this;
    const parsed = parseOrgProjectArg(target);
    const extra: ExtraApiOptions = {
      sort: flags.sort,
      environment: flags.environment ? [flags.environment] : undefined,
      statsPeriod: flags.period,
      status: flags.status,
    };
    const config = buildReleaseListConfig(extra);
    const result = await dispatchOrgScopedList({
      config,
      cwd,
      flags,
      parsed,
      orgSlugMatchBehavior: "redirect",
      overrides: {
        "auto-detect": (ctx: HandlerContext<"auto-detect">) =>
          handleAutoDetectWithProject(config, extra, ctx),
      },
    });
    yield new CommandOutput(result);
    const hint = result.items.length > 0 ? result.hint : undefined;
    return { hint };
  },
});
