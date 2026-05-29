/**
 * Sentry project creation tool for the init wizard.
 *
 * Implements the `create-sentry-project` and `ensure-sentry-project` wizard
 * operations. Uses the team-scoped endpoint when the caller has team access,
 * falling back to POST /organizations/{org}/projects/ for org members who
 * lack team:write.
 */

import {
  createProjectWithAutoTeam,
  createProjectWithDsn,
  MEMBER_PROJECT_CREATION_DISABLED_DETAIL,
  tryGetPrimaryDsn,
} from "../../api-client.js";
import { ApiError } from "../../errors.js";
import { resolveOrCreateTeam } from "../../resolve-team.js";
import { buildProjectUrl } from "../../sentry-urls.js";
import { slugify } from "../../utils.js";
import { tryGetExistingProjectData } from "../existing-project.js";
import type {
  CreateSentryProjectPayload,
  EnsureSentryProjectPayload,
  ToolResult,
} from "../types.js";
import { formatToolError } from "./shared.js";
import type { InitToolDefinition, ToolContext } from "./types.js";

type ProjectData = {
  projectSlug: string;
  projectId: string;
  dsn: string;
  url: string;
};

/**
 * Resolve project creation using the team-based flow, falling back to the
 * org-scoped endpoint on 403 (member lacks team creation permission).
 *
 * @param opts.org - Organization slug
 * @param opts.name - Project display name
 * @param opts.platform - Platform identifier (null/undefined → omitted from request)
 * @param opts.explicitTeam - Team slug from `--team` flag; suppresses fallback when set
 * @param opts.slugHint - Slug used for auto-creating a team when org has none
 * @returns Resolved project identifiers and DSN
 * @throws When the team-scoped flow fails for any reason other than a member
 *   permission 403, or when an explicit team was given and it 403s.
 */
async function resolveProjectCreation(opts: {
  org: string;
  name: string;
  platform: string | null | undefined;
  explicitTeam: string | undefined;
  slugHint: string;
}): Promise<ProjectData> {
  const { org, name, explicitTeam, slugHint } = opts;
  // Coerce null → undefined: CreateProjectBody.platform is string | undefined.
  const platform = opts.platform ?? undefined;
  try {
    const teamSlug = explicitTeam
      ? explicitTeam
      : (
          await resolveOrCreateTeam(org, {
            autoCreateSlug: slugHint,
            usageHint: "sentry init",
          })
        ).slug;
    const result = await createProjectWithDsn(org, teamSlug, {
      name,
      platform,
    });
    return {
      projectSlug: result.project.slug,
      projectId: result.project.id,
      dsn: result.dsn ?? "",
      url: result.url,
    };
  } catch (innerError) {
    // Fall back to org-scoped endpoint on 403, unless an explicit team was
    // given (in which case the 403 is meaningful feedback, not a permissions gap).
    if (
      !(innerError instanceof ApiError && innerError.status === 403) ||
      explicitTeam
    ) {
      throw innerError;
    }
    // Policy 403: org has disabled member project creation. The org-scoped
    // endpoint enforces the same flag — re-throw immediately so the outer
    // catch surfaces the friendly disabled-policy message without a wasted round-trip.
    if (innerError.detail?.includes(MEMBER_PROJECT_CREATION_DISABLED_DETAIL)) {
      throw innerError;
    }
    const autoTeam = await createProjectWithAutoTeam(org, { name, platform });
    return {
      projectSlug: autoTeam.slug,
      projectId: autoTeam.id,
      url: buildProjectUrl(org, autoTeam.slug),
      dsn: (await tryGetPrimaryDsn(org, autoTeam.slug)) ?? "",
    };
  }
}

/**
 * Validate team access for a dry-run, mirroring preflight.ts:resolveTeam.
 *
 * Calls resolveOrCreateTeam with dryRun=true and deferAutoCreateOnEmptyOrg=true
 * so no real teams are created. A 403 is swallowed — the real run falls back
 * to the org-scoped endpoint.
 *
 * @throws Non-403 errors from resolveOrCreateTeam (org not found, network, etc.)
 */
async function validateTeamForDryRun(
  org: string,
  team: string | undefined,
  autoCreateSlug: string
): Promise<void> {
  try {
    await resolveOrCreateTeam(org, {
      team,
      autoCreateSlug,
      usageHint: "sentry init",
      dryRun: true,
      deferAutoCreateOnEmptyOrg: true,
    });
  } catch (teamErr) {
    if (!(teamErr instanceof ApiError && teamErr.status === 403)) {
      throw teamErr;
    }
  }
}

/**
 * Create a new Sentry project using the org that preflight already resolved.
 * Team creation is deferred here for empty-org init flows so the final project
 * slug can be reused as the team slug.
 *
 * New Sentry orgs have member project creation disabled by default
 * (Organization.flags.disable_member_project_creation = true). When the org
 * restricts project creation for members, we surface a clear error with an
 * escape hatch: the user can pass `sentry init <org>/<project-slug>` once an
 * admin creates the project, which resolves to an existing project and skips
 * creation entirely (preflight.ts:261).
 */
export async function createSentryProject(
  payload: CreateSentryProjectPayload | EnsureSentryProjectPayload,
  context: Pick<
    ToolContext,
    "dryRun" | "existingProject" | "org" | "team" | "project"
  >
): Promise<ToolResult> {
  const name = context.project ?? payload.params.name;
  const slug = slugify(name);
  if (!slug) {
    return {
      ok: false,
      error: `Invalid project name: "${name}" produces an empty slug.`,
    };
  }

  if (context.existingProject) {
    return {
      ok: true,
      message: `Using existing project "${context.existingProject.projectSlug}" in ${context.existingProject.orgSlug}`,
      data: context.existingProject,
    };
  }

  try {
    const existingProject = await tryGetExistingProjectData(context.org, slug);
    if (existingProject) {
      return {
        ok: true,
        message: `Using existing project "${existingProject.projectSlug}" in ${existingProject.orgSlug}`,
        data: existingProject,
      };
    }

    // Validate team access before the dry-run early return — mirrors
    // preflight.ts:resolveTeam which calls resolveOrCreateTeam unconditionally.
    await validateTeamForDryRun(context.org, context.team, slug);

    if (context.dryRun) {
      return {
        ok: true,
        data: {
          orgSlug: context.org,
          projectSlug: slug,
          projectId: "(dry-run)",
          dsn: "https://key@o0.ingest.sentry.io/0",
          url: "https://sentry.io/dry-run",
        },
      };
    }

    // Try the normal team-based flow. If the user is an org member who can't
    // create or see teams (403), fall back to POST /organizations/{org}/projects/
    // which requires only project:read scope and auto-creates a personal team.
    const projectData = await resolveProjectCreation({
      org: context.org,
      name,
      platform: payload.params.platform,
      explicitTeam: context.team,
      slugHint: slug,
    });

    return {
      ok: true,
      data: {
        orgSlug: context.org,
        projectSlug: projectData.projectSlug,
        projectId: projectData.projectId,
        dsn: projectData.dsn,
        url: projectData.url,
      },
    };
  } catch (error) {
    // Org-level policy: member project creation is disabled on this org.
    // Surface a clear message with the escape hatch.
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      error.detail?.includes(MEMBER_PROJECT_CREATION_DISABLED_DETAIL)
    ) {
      return {
        ok: false,
        error:
          `Project creation is disabled for members in "${context.org}".\n` +
          "Ask an org owner to either enable project creation for members\n" +
          "or create the project for you. Once the project exists, run:\n" +
          `  sentry init ${context.org}/<project-slug>`,
      };
    }
    // 409: project already exists (from either the team-scoped or org-scoped
    // endpoint — both propagate here). Surface a friendly message with a view
    // hint rather than the raw API error text.
    if (error instanceof ApiError && error.status === 409) {
      return {
        ok: false,
        error:
          `A project named "${name}" already exists in "${context.org}".\n` +
          `View it: sentry project view ${context.org}/${slugify(name)}`,
      };
    }
    return { ok: false, error: formatToolError(error) };
  }
}

/**
 * Tool definition for creating or ensuring a Sentry project exists for init.
 */
const describeCreateSentryProject = (
  payload: CreateSentryProjectPayload | EnsureSentryProjectPayload
): string =>
  payload.detail ??
  `Ensuring project \`${payload.params.name}\` (${payload.params.platform})...`;

export const createSentryProjectTool: InitToolDefinition<"create-sentry-project"> =
  {
    operation: "create-sentry-project",
    describe: describeCreateSentryProject,
    execute: createSentryProject,
  };

export const ensureSentryProjectTool: InitToolDefinition<"ensure-sentry-project"> =
  {
    operation: "ensure-sentry-project",
    describe: describeCreateSentryProject,
    execute: createSentryProject,
  };
