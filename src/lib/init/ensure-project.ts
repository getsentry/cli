/**
 * Ensure a Sentry project + DSN exist before the workflow starts.
 *
 * Mirrors the legacy server-side `create-sentry-project` tool, but
 * runs entirely in CLI preflight so the workflow input is complete
 * by the time we POST `/api/init`. The agent never has to ask the
 * user to pick an org/team/project mid-run.
 */

import { log } from "@clack/prompts";
import { createProjectWithDsn } from "../api-client.js";
import { ApiError, WizardError } from "../errors.js";
import { resolveOrCreateTeam } from "../resolve-team.js";
import { slugify } from "../utils.js";
import { tryGetExistingProjectData } from "./existing-project.js";
import type { ExistingProjectData, ResolvedInitContext } from "./types.js";

/** Default platform slug used to create new projects from `sentry init`. */
const DEFAULT_CREATE_PLATFORM = "javascript";

export type EnsuredProject = {
  orgSlug: string;
  teamSlug?: string;
  projectSlug: string;
  projectId: string;
  dsn: string;
  url: string;
  /** True if the project existed before this run. */
  preExisting: boolean;
};

export async function ensureSentryProject(
  ctx: ResolvedInitContext
): Promise<EnsuredProject> {
  const explicit = ctx.existingProject;
  if (explicit) {
    return projectFromExisting(explicit, ctx.team, true);
  }

  const projectName = ctx.project ?? deriveProjectName(ctx.directory);
  const slug = slugify(projectName);
  if (!slug) {
    throw new WizardError(
      `Cannot create project: "${projectName}" produces an empty slug.`
    );
  }

  // First check if it already exists under the resolved org.
  try {
    const existing = await tryGetExistingProjectData(ctx.org, slug);
    if (existing) {
      return projectFromExisting(existing, ctx.team, true);
    }
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      throw err;
    }
  }

  if (ctx.dryRun) {
    return {
      orgSlug: ctx.org,
      teamSlug: ctx.team,
      projectSlug: slug,
      projectId: "(dry-run)",
      dsn: "https://key@o0.ingest.sentry.io/0",
      url: "https://sentry.io/dry-run",
      preExisting: false,
    };
  }

  // Create the project. Resolve the team if it wasn't already.
  const teamSlug = ctx.team
    ? ctx.team
    : (
        await resolveOrCreateTeam(ctx.org, {
          autoCreateSlug: slug,
          usageHint: "sentry init",
          dryRun: ctx.dryRun,
        })
      ).slug;

  log.info(`Creating Sentry project '${slug}' in ${ctx.org}/${teamSlug}...`);

  const { project, dsn, url } = await createProjectWithDsn(ctx.org, teamSlug, {
    name: projectName,
    platform: DEFAULT_CREATE_PLATFORM,
  });

  if (!dsn) {
    throw new WizardError(
      `Project '${project.slug}' created in ${ctx.org} but no DSN was issued.`
    );
  }

  return {
    orgSlug: ctx.org,
    teamSlug,
    projectSlug: project.slug,
    projectId: project.id,
    dsn,
    url,
    preExisting: false,
  };
}

function projectFromExisting(
  existing: ExistingProjectData,
  team: string | undefined,
  preExisting: boolean
): EnsuredProject {
  if (!existing.dsn) {
    throw new WizardError(
      `Existing project '${existing.projectSlug}' has no DSN configured.`
    );
  }
  return {
    orgSlug: existing.orgSlug,
    teamSlug: team,
    projectSlug: existing.projectSlug,
    projectId: existing.projectId,
    dsn: existing.dsn,
    url: existing.url,
    preExisting,
  };
}

function deriveProjectName(directory: string): string {
  // Last non-empty path segment. `path.basename` works on Posix and Windows.
  const parts = directory
    .replaceAll("\\", "/")
    .split("/")
    .filter((p) => p.length > 0);
  return parts.at(-1) ?? "sentry-project";
}
