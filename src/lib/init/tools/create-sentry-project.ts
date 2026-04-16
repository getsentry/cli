import { createProjectWithDsn } from "../../api-client.js";
import { slugify } from "../../utils.js";
import { tryGetExistingProjectData } from "../existing-project.js";
import type {
  CreateSentryProjectPayload,
  ToolResult,
} from "../types.js";
import { formatToolError } from "./shared.js";
import type { InitToolDefinition, ToolContext } from "./types.js";

/**
 * Create a new Sentry project using the org/team that preflight already resolved.
 */
export async function createSentryProject(
  payload: CreateSentryProjectPayload,
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

  try {
    if (context.project) {
      const existingProject = await tryGetExistingProjectData(context.org, slug);
      if (existingProject) {
        return {
          ok: true,
          message: `Using existing project "${existingProject.projectSlug}" in ${existingProject.orgSlug}`,
          data: existingProject,
        };
      }
    }

    const { project, dsn, url } = await createProjectWithDsn(
      context.org,
      context.team,
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
 * Tool definition for Sentry project creation.
 */
export const createSentryProjectTool: InitToolDefinition<"create-sentry-project"> =
  {
    operation: "create-sentry-project",
    describe: (payload) =>
      `Creating project \`${payload.params.name}\` (${payload.params.platform})...`,
    execute: createSentryProject,
  };
