/**
 * sentry project list
 *
 * List projects in an organization.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { listOrganizations, listProjects } from "../../lib/api-client.js";
import { getDefaultOrganization } from "../../lib/config.js";
import { AuthError } from "../../lib/errors.js";
import {
  calculateProjectSlugWidth,
  formatProjectRow,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import { resolveAllTargets } from "../../lib/resolve-target.js";
import type { SentryProject, Writer } from "../../types/index.js";

type ListFlags = {
  readonly org?: string;
  readonly limit: number;
  readonly json: boolean;
  readonly platform?: string;
};

/** Project with its organization context for display */
type ProjectWithOrg = SentryProject & { orgSlug?: string };

/**
 * Fetch projects for a single organization.
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
function filterByPlatform(
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
function writeHeader(stdout: Writer, slugWidth: number): void {
  stdout.write(`${"SLUG".padEnd(slugWidth)}  ${"PLATFORM".padEnd(20)}  NAME\n`);
}

/**
 * Write formatted project rows to stdout.
 */
function writeRows(
  stdout: Writer,
  projects: ProjectWithOrg[],
  slugWidth: number,
  showOrg: boolean
): void {
  for (const project of projects) {
    stdout.write(
      `${formatProjectRow(project, { showOrg, orgSlug: project.orgSlug, slugWidth })}\n`
    );
  }
}

/** Result of resolving organizations to fetch projects from */
type OrgResolution = {
  orgs: string[];
  footer?: string;
  showOrg: boolean;
  skippedSelfHosted?: number;
};

/**
 * Resolve which organizations to fetch projects from.
 * Uses CLI flag, config defaults, or DSN auto-detection.
 */
async function resolveOrgsToFetch(
  orgFlag: string | undefined,
  cwd: string
): Promise<OrgResolution> {
  // 1. If --org flag provided, use it directly
  if (orgFlag) {
    return { orgs: [orgFlag], showOrg: false };
  }

  // 2. Check config defaults
  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return { orgs: [defaultOrg], showOrg: false };
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
        showOrg: uniqueOrgs.length > 1,
        skippedSelfHosted,
      };
    }

    // No resolvable targets, but may have self-hosted DSNs
    return { orgs: [], showOrg: true, skippedSelfHosted };
  } catch (error) {
    // Auth errors should propagate - user needs to log in
    if (error instanceof AuthError) {
      throw error;
    }
    // Fall through to empty orgs for other errors (network, etc.)
  }

  return { orgs: [], showOrg: true };
}

export const listCommand = buildCommand({
  docs: {
    brief: "List projects",
    fullDescription:
      "List projects in an organization. If no organization is specified, " +
      "uses the default organization or lists projects from all accessible organizations.\n\n" +
      "Examples:\n" +
      "  sentry project list\n" +
      "  sentry project list --org my-org\n" +
      "  sentry project list --limit 10\n" +
      "  sentry project list --json\n" +
      "  sentry project list --platform javascript",
  },
  parameters: {
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief: "Organization slug",
        optional: true,
      },
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
      platform: {
        kind: "parsed",
        parse: String,
        brief: "Filter by platform (e.g., javascript, python)",
        optional: true,
      },
    },
  },
  async func(this: SentryContext, flags: ListFlags): Promise<void> {
    const { stdout, cwd } = this;

    // Resolve which organizations to fetch from
    const {
      orgs: orgsToFetch,
      footer,
      showOrg,
      skippedSelfHosted,
    } = await resolveOrgsToFetch(flags.org, cwd);

    // Fetch projects from all orgs (or all accessible if none detected)
    let allProjects: ProjectWithOrg[];
    if (orgsToFetch.length > 0) {
      const results = await Promise.all(
        orgsToFetch.map((org) => fetchOrgProjectsSafe(org))
      );
      allProjects = results.flat();
    } else {
      allProjects = await fetchAllOrgProjects();
    }

    // Filter and limit (limit is per-org when multiple orgs)
    const filtered = filterByPlatform(allProjects, flags.platform);
    const limitCount =
      orgsToFetch.length > 1 ? flags.limit * orgsToFetch.length : flags.limit;
    const limited = filtered.slice(0, limitCount);

    if (flags.json) {
      writeJson(stdout, limited);
      return;
    }

    if (limited.length === 0) {
      const msg =
        orgsToFetch.length === 1
          ? `No projects found in organization '${orgsToFetch[0]}'.\n`
          : "No projects found.\n";
      stdout.write(msg);
      return;
    }

    const slugWidth = calculateProjectSlugWidth(limited, showOrg);
    writeHeader(stdout, slugWidth);
    writeRows(stdout, limited, slugWidth, showOrg);

    if (filtered.length > limited.length) {
      stdout.write(
        `\nShowing ${limited.length} of ${filtered.length} projects\n`
      );
    }

    if (footer) {
      stdout.write(`\n${footer}\n`);
    }

    if (skippedSelfHosted) {
      stdout.write(
        `\nNote: ${skippedSelfHosted} DSN(s) could not be resolved. ` +
          "Use --org to specify organization explicitly.\n"
      );
    }

    writeFooter(stdout, "Tip: Use 'sentry project view <slug>' for details");
  },
});
