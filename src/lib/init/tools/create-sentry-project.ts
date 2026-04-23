import { createProjectWithDsn } from "../../api-client.js";
import { resolveOrCreateTeam } from "../../resolve-team.js";
import { slugify } from "../../utils.js";
import { tryGetExistingProjectData } from "../existing-project.js";
import type {
  CreateSentryProjectPayload,
  EnsureSentryProjectPayload,
  ToolResult,
} from "../types.js";
import { formatToolError } from "./shared.js";
import type { InitToolDefinition, ToolContext } from "./types.js";

/**
 * Create a new Sentry project using the org that preflight already resolved.
 * Team creation is deferred here for empty-org init flows so the final project
 * slug can be reused as the team slug.
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
