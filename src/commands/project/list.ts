/**
 * sentry project list
 *
 * List projects in an organization with pagination and flexible targeting.
 *
 * Supports:
 * - Auto-detection from DSN/config
 * - Explicit org/project targeting (e.g., sentry/sentry)
 * - Org-scoped listing with cursor pagination (e.g., sentry/)
 * - Cross-org project search (e.g., sentry)
 */

import type { SentryContext } from "../../context.js";
import {
  findProjectsBySlug,
  getProject,
  listOrganizations,
  listProjects,
  listProjectsPaginated,
  type PaginatedResponse,
} from "../../lib/api-client.js";
import {
  type ParsedOrgProject,
  parseOrgProjectArg,
} from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { getDefaultOrganization } from "../../lib/db/defaults.js";
import {
  clearPaginationCursor,
  escapeContextKeyValue,
  resolveOrgCursor,
  setPaginationCursor,
} from "../../lib/db/pagination.js";
import { AuthError, ContextError } from "../../lib/errors.js";
import {
  calculateProjectColumnWidths,
  formatProjectRow,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  buildListLimitFlag,
  LIST_BASE_ALIASES,
  LIST_CURSOR_FLAG,
  LIST_JSON_FLAG,
  LIST_TARGET_POSITIONAL,
} from "../../lib/list-command.js";
import {
  dispatchOrgScopedList,
  type ListCommandMeta,
} from "../../lib/org-list.js";
import { resolveAllTargets } from "../../lib/resolve-target.js";
import { getApiBaseUrl } from "../../lib/sentry-client.js";
import type { SentryProject, Writer } from "../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "project-list";

type ListFlags = {
  readonly limit: number;
  readonly json: boolean;
  readonly cursor?: string;
  readonly platform?: string;
};

/**
 * Project with optional organization context for display.
 * Uses optional orgSlug since some internal functions (e.g., filterByPlatform)
 * operate on projects before org context is attached.
 * The canonical exported type with required orgSlug lives in api-client.ts.
 */
type ProjectWithOrg = SentryProject & { orgSlug?: string };

/**
 * Fetch projects for a single organization (all pages).
 *
 * @param orgSlug - Organization slug to fetch projects from
 * @returns Projects with org context attached
 */
export async function fetchOrgProjects(
  orgSlug: string
): Promise<ProjectWithOrg[]> {
  const projects = await listProjects(orgSlug);
  return projects.map((p) => ({ ...p, orgSlug }));
}

/**
 * Fetch projects for a single org, returning empty array on non-auth errors.
 * Auth errors propagate so user sees "please log in" message.
 */
export async function fetchOrgProjectsSafe(
  orgSlug: string
): Promise<ProjectWithOrg[]> {
  try {
    return await fetchOrgProjects(orgSlug);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    return [];
  }
}

/**
 * Fetch projects from all accessible organizations.
 * Skips orgs where the user lacks access.
 *
 * @returns Combined list of projects from all accessible orgs
 */
export async function fetchAllOrgProjects(): Promise<ProjectWithOrg[]> {
  const orgs = await listOrganizations();
  const results: ProjectWithOrg[] = [];

  for (const org of orgs) {
    try {
      const projects = await fetchOrgProjects(org.slug);
      results.push(...projects);
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
 * Filter projects by platform name (case-insensitive partial match).
 *
 * @param projects - Projects to filter
 * @param platform - Platform substring to match (e.g., "javascript", "python")
 * @returns Filtered projects, or all projects if no platform specified
 */
export function filterByPlatform(
  projects: ProjectWithOrg[],
  platform?: string
): ProjectWithOrg[] {
  if (!platform) {
    return projects;
  }
  const lowerPlatform = platform.toLowerCase();
  return projects.filter((p) =>
    p.platform?.toLowerCase().includes(lowerPlatform)
  );
}

/**
 * Write the column header row for project list output.
 */
export function writeHeader(
  stdout: Writer,
  orgWidth: number,
  slugWidth: number,
  nameWidth: number
): void {
  const org = "ORG".padEnd(orgWidth);
  const project = "PROJECT".padEnd(slugWidth);
  const name = "NAME".padEnd(nameWidth);
  stdout.write(`${org}  ${project}  ${name}  PLATFORM\n`);
}

export type WriteRowsOptions = {
  stdout: Writer;
  projects: ProjectWithOrg[];
  orgWidth: number;
  slugWidth: number;
  nameWidth: number;
};

/**
 * Write formatted project rows to stdout.
 */
export function writeRows(options: WriteRowsOptions): void {
  const { stdout, projects, orgWidth, slugWidth, nameWidth } = options;
  for (const project of projects) {
    stdout.write(
      `${formatProjectRow(project, { orgWidth, slugWidth, nameWidth })}\n`
    );
  }
}

/**
 * Build a context key for pagination cursor validation.
 * Captures the query parameters that affect result ordering,
 * so cursors from different queries are not accidentally reused.
 *
 * Includes the Sentry host so cursors from different instances
 * (SaaS vs self-hosted) are never mixed.
 *
 * Format: `host:<url>|type:<kind>[:<arg>][|platform:<name>]`
 */
export function buildContextKey(
  parsed: ParsedOrgProject,
  flags: { platform?: string },
  host: string
): string {
  const parts: string[] = [`host:${host}`];
  switch (parsed.type) {
    case "org-all":
      parts.push(`type:org:${parsed.org}`);
      break;
    case "auto-detect":
      parts.push("type:auto");
      break;
    case "explicit":
      parts.push(`type:explicit:${parsed.org}/${parsed.project}`);
      break;
    case "project-search":
      parts.push(`type:search:${parsed.projectSlug}`);
      break;
    default: {
      const _exhaustive: never = parsed;
      parts.push(`type:unknown:${String(_exhaustive)}`);
    }
  }
  if (flags.platform) {
    // Normalize to lowercase since platform filtering is case-insensitive.
    parts.push(
      `platform:${escapeContextKeyValue(flags.platform.toLowerCase())}`
    );
  }
  return parts.join("|");
}

/** Result of resolving organizations to fetch projects from */
type OrgResolution = {
  orgs: string[];
  footer?: string;
  skippedSelfHosted?: number;
};

/**
 * Resolve which organizations to fetch projects from (auto-detect mode).
 * Uses config defaults or DSN auto-detection.
 */
async function resolveOrgsForAutoDetect(cwd: string): Promise<OrgResolution> {
  // 1. Check config defaults
  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return { orgs: [defaultOrg] };
  }

  // 2. Auto-detect from DSNs (may find multiple in monorepos)
  try {
    const { targets, footer, skippedSelfHosted } = await resolveAllTargets({
      cwd,
    });

    if (targets.length > 0) {
      const uniqueOrgs = [...new Set(targets.map((t) => t.org))];
      return { orgs: uniqueOrgs, footer, skippedSelfHosted };
    }

    return { orgs: [], skippedSelfHosted };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
  }

  return { orgs: [] };
}

/** Display projects in table format with header and rows */
export function displayProjectTable(
  stdout: Writer,
  projects: ProjectWithOrg[]
): void {
  const { orgWidth, slugWidth, nameWidth } =
    calculateProjectColumnWidths(projects);
  writeHeader(stdout, orgWidth, slugWidth, nameWidth);
  writeRows({ stdout, projects, orgWidth, slugWidth, nameWidth });
}

/**
 * Fetch a single page of projects from one org, with error handling
 * that mirrors `fetchOrgProjectsSafe` — re-throws auth errors but
 * silently returns empty for other failures (403, network errors).
 */
async function fetchPaginatedSafe(
  org: string,
  limit: number
): Promise<{ projects: ProjectWithOrg[]; nextCursor?: string }> {
  try {
    const response = await listProjectsPaginated(org, { perPage: limit });
    return {
      projects: response.data.map((p) => ({ ...p, orgSlug: org })),
      nextCursor: response.nextCursor,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    return { projects: [] };
  }
}

/**
 * Fetch projects for auto-detect mode.
 *
 * Optimization: when targeting a single org without platform filter, uses
 * single-page pagination (`perPage=limit`) to avoid fetching all projects.
 * Multi-org or filtered queries still require full fetch + client-side slicing.
 */
async function fetchAutoDetectProjects(
  orgs: string[],
  flags: ListFlags
): Promise<{ projects: ProjectWithOrg[]; nextCursor?: string }> {
  if (orgs.length === 1 && !flags.platform) {
    return fetchPaginatedSafe(orgs[0] as string, flags.limit);
  }
  if (orgs.length > 0) {
    const results = await Promise.all(orgs.map(fetchOrgProjectsSafe));
    return { projects: results.flat() };
  }
  return { projects: await fetchAllOrgProjects() };
}

/** Build a pagination hint for auto-detect JSON output. */
function autoDetectPaginationHint(orgs: string[]): string {
  return orgs.length === 1
    ? `sentry project list ${orgs[0]}/ --json`
    : "sentry project list <org>/ --json";
}

/**
 * Handle auto-detect mode: resolve orgs from config/DSN, fetch all projects,
 * apply client-side filtering and limiting.
 */
export async function handleAutoDetect(
  stdout: Writer,
  cwd: string,
  flags: ListFlags
): Promise<void> {
  const {
    orgs: orgsToFetch,
    footer,
    skippedSelfHosted,
  } = await resolveOrgsForAutoDetect(cwd);

  const { projects: allProjects, nextCursor } = await fetchAutoDetectProjects(
    orgsToFetch,
    flags
  );

  const filtered = filterByPlatform(allProjects, flags.platform);
  const limitCount =
    orgsToFetch.length > 1 ? flags.limit * orgsToFetch.length : flags.limit;
  const limited = filtered.slice(0, limitCount);

  const hasMore = filtered.length > limited.length || !!nextCursor;

  if (flags.json) {
    const output: Record<string, unknown> = { data: limited, hasMore };
    if (hasMore) {
      output.hint = autoDetectPaginationHint(orgsToFetch);
    }
    writeJson(stdout, output);
    return;
  }

  if (limited.length === 0) {
    stdout.write("No projects found.\n");
    writeSelfHostedWarning(stdout, skippedSelfHosted);
    return;
  }

  displayProjectTable(stdout, limited);

  if (hasMore) {
    if (nextCursor && orgsToFetch.length === 1) {
      const org = orgsToFetch[0] as string;
      stdout.write(
        `\nShowing ${limited.length} projects (more available). ` +
          `Use 'sentry project list ${org}/' for paginated results.\n`
      );
    } else {
      stdout.write(
        `\nShowing ${limited.length} projects (more available). Use --limit to show more.\n`
      );
    }
  }

  if (footer) {
    stdout.write(`\n${footer}\n`);
  }
  writeSelfHostedWarning(stdout, skippedSelfHosted);
  writeFooter(
    stdout,
    "Tip: Use 'sentry project view <org>/<project>' for details"
  );
}

/**
 * Handle explicit org/project targeting (e.g., sentry/sentry).
 * Fetches the specific project directly via the API.
 */
export async function handleExplicit(
  stdout: Writer,
  org: string,
  projectSlug: string,
  flags: ListFlags
): Promise<void> {
  let project: ProjectWithOrg;
  try {
    const result = await getProject(org, projectSlug);
    project = { ...result, orgSlug: org };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    if (flags.json) {
      writeJson(stdout, []);
      return;
    }
    stdout.write(
      `No project '${projectSlug}' found in organization '${org}'.\n`
    );
    writeFooter(
      stdout,
      `Tip: Use 'sentry project list ${org}/' to see all projects`
    );
    return;
  }

  const filtered = filterByPlatform([project], flags.platform);

  if (flags.json) {
    writeJson(stdout, filtered);
    return;
  }

  if (filtered.length === 0) {
    stdout.write(
      `No project '${projectSlug}' found matching platform '${flags.platform}'.\n`
    );
    return;
  }

  displayProjectTable(stdout, filtered);
  writeFooter(
    stdout,
    `Tip: Use 'sentry project view ${org}/${projectSlug}' for details`
  );
}

export type OrgAllOptions = {
  stdout: Writer;
  org: string;
  flags: ListFlags;
  contextKey: string;
  cursor: string | undefined;
};

/** Build the CLI hint for fetching the next page, preserving active flags. */
function nextPageHint(org: string, platform?: string): string {
  const base = `sentry project list ${org}/ -c last`;
  return platform ? `${base} --platform ${platform}` : base;
}

/**
 * Handle org-all mode (e.g., sentry/).
 * Uses cursor pagination for efficient page-by-page listing.
 */
export async function handleOrgAll(options: OrgAllOptions): Promise<void> {
  const { stdout, org, flags, contextKey, cursor } = options;
  const response: PaginatedResponse<SentryProject[]> =
    await listProjectsPaginated(org, {
      cursor,
      perPage: flags.limit,
    });

  const projects: ProjectWithOrg[] = response.data.map((p) => ({
    ...p,
    orgSlug: org,
  }));

  const filtered = filterByPlatform(projects, flags.platform);

  const hasMore = !!response.nextCursor;

  // Update cursor cache for `--cursor last` support
  if (response.nextCursor) {
    setPaginationCursor(PAGINATION_KEY, contextKey, response.nextCursor);
  } else {
    clearPaginationCursor(PAGINATION_KEY, contextKey);
  }

  if (flags.json) {
    const output = hasMore
      ? { data: filtered, nextCursor: response.nextCursor, hasMore: true }
      : { data: filtered, hasMore: false };
    writeJson(stdout, output);
    return;
  }

  if (filtered.length === 0) {
    if (hasMore) {
      stdout.write(
        `No matching projects on this page. Try the next page: ${nextPageHint(org, flags.platform)}\n`
      );
    } else if (flags.platform) {
      stdout.write(
        `No projects matching platform '${flags.platform}' in organization '${org}'.\n`
      );
    } else {
      stdout.write(`No projects found in organization '${org}'.\n`);
    }
    return;
  }

  displayProjectTable(stdout, filtered);

  if (hasMore) {
    stdout.write(`\nShowing ${filtered.length} projects (more available)\n`);
    stdout.write(`Next page: ${nextPageHint(org, flags.platform)}\n`);
  } else {
    stdout.write(`\nShowing ${filtered.length} projects\n`);
  }

  writeFooter(
    stdout,
    "Tip: Use 'sentry project view <org>/<project>' for details"
  );
}

/**
 * Handle project-search mode (bare slug, e.g., "sentry").
 * Searches for the project across all accessible organizations.
 */
export async function handleProjectSearch(
  stdout: Writer,
  projectSlug: string,
  flags: ListFlags
): Promise<void> {
  const projects: ProjectWithOrg[] = await findProjectsBySlug(projectSlug);
  const filtered = filterByPlatform(projects, flags.platform);

  if (filtered.length === 0) {
    if (flags.json) {
      writeJson(stdout, []);
      return;
    }
    if (projects.length > 0 && flags.platform) {
      stdout.write(
        `No project '${projectSlug}' found matching platform '${flags.platform}'.\n`
      );
      return;
    }
    throw new ContextError(
      "Project",
      `No project '${projectSlug}' found in any accessible organization.\n\n` +
        `Try: sentry project list <org>/${projectSlug}`
    );
  }

  const limited = filtered.slice(0, flags.limit);

  if (flags.json) {
    writeJson(stdout, limited);
    return;
  }

  displayProjectTable(stdout, limited);

  if (filtered.length > limited.length) {
    stdout.write(
      `\nShowing ${limited.length} of ${filtered.length} matches. Use --limit to show more.\n`
    );
  } else if (limited.length > 1) {
    stdout.write(
      `\nFound '${projectSlug}' in ${limited.length} organizations\n`
    );
  }

  writeFooter(
    stdout,
    "Tip: Use 'sentry project view <org>/<project>' for details"
  );
}

/** Write self-hosted DSN warning if applicable */
export function writeSelfHostedWarning(
  stdout: Writer,
  skippedSelfHosted: number | undefined
): void {
  if (skippedSelfHosted) {
    stdout.write(
      `\nNote: ${skippedSelfHosted} DSN(s) could not be resolved. ` +
        "Specify the organization explicitly: sentry project list <org>/\n"
    );
  }
}

/** Metadata used by the shared dispatch infrastructure for error messages and cursor keys. */
const projectListMeta: ListCommandMeta = {
  paginationKey: PAGINATION_KEY,
  entityName: "project",
  entityPlural: "projects",
  commandPrefix: "sentry project list",
};

export const listCommand = buildCommand({
  docs: {
    brief: "List projects",
    fullDescription:
      "List projects in an organization.\n\n" +
      "Target specification:\n" +
      "  sentry project list                # auto-detect from DSN or config\n" +
      "  sentry project list <org>/         # list all projects in org (paginated)\n" +
      "  sentry project list <org>/<proj>   # show specific project\n" +
      "  sentry project list <project>      # find project across all orgs\n\n" +
      "Pagination:\n" +
      "  sentry project list <org>/ -c last  # continue from last page\n" +
      "  sentry project list <org>/ -c <cursor>  # resume at specific cursor\n\n" +
      "Filtering and output:\n" +
      "  sentry project list --platform javascript  # filter by platform\n" +
      "  sentry project list --limit 50              # show more results\n" +
      "  sentry project list --json                  # output as JSON",
  },
  parameters: {
    positional: LIST_TARGET_POSITIONAL,
    flags: {
      limit: buildListLimitFlag("projects"),
      json: LIST_JSON_FLAG,
      cursor: LIST_CURSOR_FLAG,
      platform: {
        kind: "parsed",
        parse: String,
        brief: "Filter by platform (e.g., javascript, python)",
        optional: true,
      },
    },
    aliases: { ...LIST_BASE_ALIASES, p: "platform" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    const parsed = parseOrgProjectArg(target);

    await dispatchOrgScopedList({
      config: projectListMeta,
      stdout,
      cwd,
      flags,
      parsed,
      overrides: {
        "auto-detect": (ctx) => handleAutoDetect(ctx.stdout, ctx.cwd, flags),
        explicit: (ctx) =>
          handleExplicit(ctx.stdout, ctx.parsed.org, ctx.parsed.project, flags),
        "org-all": (ctx) => {
          // Build context key and resolve cursor only in org-all mode, after
          // dispatchOrgScopedList has already validated --cursor is allowed here.
          const contextKey = buildContextKey(
            ctx.parsed,
            flags,
            getApiBaseUrl()
          );
          const cursor = resolveOrgCursor(
            flags.cursor,
            PAGINATION_KEY,
            contextKey
          );
          return handleOrgAll({
            stdout: ctx.stdout,
            org: ctx.parsed.org,
            flags,
            contextKey,
            cursor,
          });
        },
        "project-search": (ctx) =>
          handleProjectSearch(ctx.stdout, ctx.parsed.projectSlug, flags),
      },
    });
  },
});
