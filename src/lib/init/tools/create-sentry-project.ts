import { createProjectWithDsn, listTeams } from "../../api-client.js";
import { ApiError } from "../../errors.js";
import { resolveOrCreateTeam } from "../../resolve-team.js";
import { getSentryBaseUrl } from "../../sentry-urls.js";
import { slugify } from "../../utils.js";
import { tryGetExistingProjectData } from "../existing-project.js";
import type {
  CreateSentryProjectPayload,
  EnsureSentryProjectPayload,
  ToolResult,
} from "../types.js";
import { formatToolError } from "./shared.js";
import type { InitToolDefinition, ToolContext } from "./types.js";

/** True when the API returned the org-level member project-creation restriction. */
function isMemberCreationDenied(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.detail?.includes("disabled this feature") === true
  );
}

/**
 * Attempt project creation on any team where the user holds team:admin.
 *
 * Called after a 403 "disabled this feature" on the auto-resolved team.
 * team:admin bypasses the org-level member-creation restriction even for
 * plain org members (team_projects.py:228–233).
 *
 * Returns the successful ToolResult, null if no admin team exists, or a
 * failed ToolResult if the retry encountered a different error (so that
 * a 5xx or 409 slug conflict is not masked by the original 403).
 */
async function retryWithAdminTeam(
  org: string,
  name: string,
  platform: string
): Promise<ToolResult | null> {
  try {
    const allTeams = await listTeams(org);
    const adminTeam = allTeams.find(
      (t) => t.isMember === true && t.teamRole === "admin"
    );
    if (!adminTeam) {
      return null;
    }

    const { project, dsn, url } = await createProjectWithDsn(
      org,
      adminTeam.slug,
      { name, platform }
    );
    return {
      ok: true,
      data: {
        orgSlug: org,
        projectSlug: project.slug,
        projectId: project.id,
        dsn: dsn ?? "",
        url,
      },
    };
  } catch (retryError) {
    if (!isMemberCreationDenied(retryError)) {
      // Surface failures unrelated to the same org-policy restriction —
      // a 409 slug conflict or 5xx should not be masked by the original 403.
      return { ok: false, error: formatToolError(retryError) };
    }
    return null;
  }
}

/**
 * Create a new Sentry project using the org that preflight already resolved.
 * Team creation is deferred here for empty-org init flows so the final project
 * slug can be reused as the team slug.
 *
 * New Sentry orgs have member project creation disabled by default
 * (Organization.flags.disable_member_project_creation = true). When the
 * auto-resolved team doesn't grant project-creation rights, we retry once
 * via {@link retryWithAdminTeam}. If no admin team exists we surface a clear
 * error rather than the generic "re-authenticate" advice that 403 enrichment
 * would otherwise produce.
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

  // Hoisted before the try so the catch can read it without a scoping issue.
  // When the user passed --team explicitly we must not silently swap teams on a
  // 403 — their intent is clear and we should surface the error as-is.
  const teamWasExplicit = !!context.team;

  try {
    const existingProject = await tryGetExistingProjectData(context.org, slug);
    if (existingProject) {
      return {
        ok: true,
        message: `Using existing project "${existingProject.projectSlug}" in ${existingProject.orgSlug}`,
        data: existingProject,
      };
    }

    const teamSlug = context.team
      ? context.team
      : (
          await resolveOrCreateTeam(context.org, {
            autoCreateSlug: slug,
            usageHint: "sentry init",
            dryRun: context.dryRun,
          })
        ).slug;

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

    const { project, dsn, url } = await createProjectWithDsn(
      context.org,
      teamSlug,
      {
        name,
        platform: payload.params.platform,
      }
    );

    return {
      ok: true,
      data: {
        orgSlug: context.org,
        projectSlug: project.slug,
        projectId: project.id,
        dsn: dsn ?? "",
        url,
      },
    };
  } catch (error) {
    // Guard: pass through immediately for explicit teams or non-policy errors.
    if (teamWasExplicit || !isMemberCreationDenied(error)) {
      return { ok: false, error: formatToolError(error) };
    }

    const retryResult = await retryWithAdminTeam(
      context.org,
      name,
      payload.params.platform
    );
    if (retryResult) {
      return retryResult;
    }

    return {
      ok: false,
      error:
        `Project creation is disabled for members in "${context.org}".\n` +
        "You need org:admin/manager/owner role, or team:admin role on a team.\n" +
        "Ask an org owner, or manage access at: " +
        `${getSentryBaseUrl()}/settings/${context.org}/members/`,
    };
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
