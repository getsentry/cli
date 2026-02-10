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
import { buildCommand, numberParser } from "../../lib/command.js";
import { getDefaultOrganization } from "../../lib/db/defaults.js";
import {
  clearPaginationCursor,
  getPaginationCursor,
  setPaginationCursor,
} from "../../lib/db/pagination.js";
import { AuthError, ContextError, ValidationError } from "../../lib/errors.js";
import {
  calculateProjectColumnWidths,
  formatProjectRow,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import { resolveAllTargets } from "../../lib/resolve-target.js";
import type { SentryProject, Writer } from "../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "project-list";

type ListFlags = {
  readonly limit: number;
  readonly json: boolean;
  readonly cursor?: string;
  readonly platform?: string;
};

/** Project with its organization context for display */
type ProjectWithOrg = SentryProject & { orgSlug?: string };

/**
 * Fetch projects for a single organization (all pages).
 *
 * @param orgSlug - Organization slug to fetch projects from
 * @returns Projects with org context attached
 */
async function fetchOrgProjects(orgSlug: string): Promise<ProjectWithOrg[]> {
  const projects = await listProjects(orgSlug);
  return projects.map((p) => ({ ...p, orgSlug }));
}

/**
 * Fetch projects for a single org, returning empty array on non-auth errors.
 * Auth errors propagate so user sees "please log in" message.
 */
async function fetchOrgProjectsSafe(
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
async function fetchAllOrgProjects(): Promise<ProjectWithOrg[]> {
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
 */
export function buildContextKey(
  parsed: ParsedOrgProject,
  flags: { platform?: string }
): string {
  const parts: string[] = [];
  switch (parsed.type) {
    case "org-all":
      parts.push(`org:${parsed.org}`);
      break;
    case "auto-detect":
      parts.push("auto");
      break;
    default:
      parts.push(`type:${parsed.type}`);
  }
  if (flags.platform) {
    parts.push(`platform:${flags.platform}`);
  }
  return parts.join("|");
}

/**
 * Resolve the cursor value from --cursor flag.
 * Handles the magic "last" value by looking up the cached cursor.
 */
export function resolveCursor(
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
function displayProjectTable(stdout: Writer, projects: ProjectWithOrg[]): void {
  const { orgWidth, slugWidth, nameWidth } =
    calculateProjectColumnWidths(projects);
  writeHeader(stdout, orgWidth, slugWidth, nameWidth);
  writeRows({ stdout, projects, orgWidth, slugWidth, nameWidth });
}

/**
 * Handle auto-detect mode: resolve orgs from config/DSN, fetch all projects,
 * apply client-side filtering and limiting.
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
  } = await resolveOrgsForAutoDetect(cwd);

  let allProjects: ProjectWithOrg[];
  if (orgsToFetch.length > 0) {
    const results = await Promise.all(orgsToFetch.map(fetchOrgProjectsSafe));
    allProjects = results.flat();
  } else {
    allProjects = await fetchAllOrgProjects();
  }

  const filtered = filterByPlatform(allProjects, flags.platform);
  const limitCount =
    orgsToFetch.length > 1 ? flags.limit * orgsToFetch.length : flags.limit;
  const limited = filtered.slice(0, limitCount);

  if (flags.json) {
    writeJson(stdout, limited);
    return;
  }

  if (limited.length === 0) {
    stdout.write("No projects found.\n");
    writeSelfHostedWarning(stdout, skippedSelfHosted);
    return;
  }

  displayProjectTable(stdout, limited);

  if (filtered.length > limited.length) {
    stdout.write(
      `\nShowing ${limited.length} of ${filtered.length} projects. Use --limit to show more.\n`
    );
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

  // Update cursor cache for `--cursor last` support
  if (response.hasMore && response.nextCursor) {
    setPaginationCursor(PAGINATION_KEY, contextKey, response.nextCursor);
  } else {
    clearPaginationCursor(PAGINATION_KEY, contextKey);
  }

  if (flags.json) {
    const output = response.hasMore
      ? { data: filtered, nextCursor: response.nextCursor, hasMore: true }
      : { data: filtered, hasMore: false };
    writeJson(stdout, output);
    return;
  }

  if (filtered.length === 0) {
    if (response.hasMore) {
      stdout.write(
        `No matching projects on this page. Try the next page: sentry project list ${org}/ -c last\n`
      );
    } else {
      stdout.write(`No projects found in organization '${org}'.\n`);
    }
    return;
  }

  displayProjectTable(stdout, filtered);

  if (response.hasMore) {
    stdout.write(`\nShowing ${filtered.length} projects (more available)\n`);
    stdout.write(`Next page: sentry project list ${org}/ -c last\n`);
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
  const matches = await findProjectsBySlug(projectSlug);
  const projects: ProjectWithOrg[] = matches.map((m) => ({
    ...m,
    orgSlug: m.orgSlug,
  }));
  const filtered = filterByPlatform(projects, flags.platform);

  if (flags.json) {
    writeJson(stdout, filtered);
    return;
  }

  if (filtered.length === 0) {
    throw new ContextError(
      "Project",
      `No project '${projectSlug}' found in any accessible organization.\n\n` +
        `Try: sentry project list <org>/${projectSlug}`
    );
  }

  displayProjectTable(stdout, filtered);

  if (filtered.length > 1) {
    stdout.write(
      `\nFound '${projectSlug}' in ${filtered.length} organizations\n`
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
      "  sentry project list <org>/ -c <cursor>  # resume at specific cursor",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "target",
          brief: "Target: <org>/, <org>/<project>, or <project>",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of projects to list",
        // Stricli requires string defaults (raw CLI input); numberParser converts to number
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
      platform: {
        kind: "parsed",
        parse: String,
        brief: "Filter by platform (e.g., javascript, python)",
        optional: true,
      },
    },
    aliases: { n: "limit", p: "platform", c: "cursor" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    const parsed = parseOrgProjectArg(target);

    // Cursor pagination is only supported in org-all mode — check before resolving
    if (flags.cursor && parsed.type !== "org-all") {
      throw new ValidationError(
        "The --cursor flag is only supported when listing projects for a specific organization " +
          "(e.g., sentry project list <org>/). " +
          "Use 'sentry project list <org>/' for paginated results.",
        "cursor"
      );
    }

    const contextKey = buildContextKey(parsed, flags);
    const cursor = resolveCursor(flags.cursor, contextKey);

    switch (parsed.type) {
      case "auto-detect":
        await handleAutoDetect(stdout, cwd, flags);
        break;

      case "explicit":
        await handleExplicit(stdout, parsed.org, parsed.project, flags);
        break;

      case "org-all":
        await handleOrgAll({
          stdout,
          org: parsed.org,
          flags,
          contextKey,
          cursor,
        });
        break;

      case "project-search":
        await handleProjectSearch(stdout, parsed.projectSlug, flags);
        break;

      default: {
        const _exhaustiveCheck: never = parsed;
        throw new Error(`Unexpected parsed type: ${_exhaustiveCheck}`);
      }
    }
  },
});
