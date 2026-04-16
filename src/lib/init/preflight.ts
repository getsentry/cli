import { cancel, isCancel, log, select } from "@clack/prompts";
import type { SentryTeam } from "../../types/index.js";
import { listOrganizations } from "../api-client.js";
import { getAuthToken } from "../db/auth.js";
import { WizardError } from "../errors.js";
import { resolveOrCreateTeam } from "../resolve-team.js";
import { slugify } from "../utils.js";
import { WizardCancelledError } from "./clack-utils.js";
import { tryGetExistingProjectData } from "./existing-project.js";
import { resolveOrgPrefetched } from "./org-prefetch.js";
import type {
  ExistingProjectData,
  ResolvedInitContext,
  WizardOptions,
} from "./types.js";

const NUMERIC_ORG_ID_RE = /^\d+$/;

type ExistingProjectChoice = {
  project?: string;
  existingProject?: ExistingProjectData;
  shouldAbort?: boolean;
};

type InitContextSeed = {
  org?: string;
  project?: string;
  existingProject?: ExistingProjectData;
};

type ProjectSelection = Pick<
  ResolvedInitContext,
  "project" | "existingProject"
>;

/**
 * Resolve org, project, team, and auth state before the init workflow starts.
 */
export async function resolveInitContext(
  initial: WizardOptions
): Promise<ResolvedInitContext | null> {
  return await withPreflightHandling(async () => {
    const seed = await resolveInitContextSeed(initial);
    if (!seed) {
      return null;
    }

    const org = await ensureOrg(seed.org, initial);
    const projectSelection = await resolveProjectSelection(org, initial, seed);
    if (!projectSelection) {
      return null;
    }

    const team = await resolveTeam(org, initial);
    if (!team) {
      return null;
    }

    return buildResolvedInitContext(initial, org, team, projectSelection);
  });
}

async function withPreflightHandling(
  action: () => Promise<ResolvedInitContext | null>
): Promise<ResolvedInitContext | null> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      cancel("Setup cancelled.");
      process.exitCode = 0;
      return null;
    }

    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    cancel("Setup failed.");
    throw error instanceof WizardError ? error : new WizardError(message);
  }
}

function buildResolvedInitContext(
  initial: WizardOptions,
  org: string,
  team: string,
  selection: ProjectSelection
): ResolvedInitContext {
  return {
    directory: initial.directory,
    yes: initial.yes,
    dryRun: initial.dryRun,
    features: initial.features,
    org,
    team,
    project: selection.project,
    authToken: getAuthToken(),
    existingProject: selection.existingProject,
  };
}

async function resolveInitContextSeed(
  initial: WizardOptions
): Promise<InitContextSeed | null> {
  const detected = await resolveDetectedProject(initial);
  if (detected?.shouldAbort) {
    return null;
  }

  return {
    org: detected?.org ?? initial.org,
    project: detected?.project ?? initial.project,
    existingProject: detected?.existingProject,
  };
}

async function ensureOrg(
  org: string | undefined,
  initial: WizardOptions
): Promise<string> {
  if (org) {
    return org;
  }

  const orgResult = await resolveOrgSlug(initial.directory, initial.yes);
  if (typeof orgResult === "string") {
    return orgResult;
  }

  throw new WizardError(orgResult.error ?? "Failed to resolve organization.");
}

async function resolveProjectSelection(
  org: string,
  initial: WizardOptions,
  seed: InitContextSeed
): Promise<ProjectSelection | null> {
  if (!seed.project) {
    return {
      project: seed.project,
      existingProject: seed.existingProject,
    };
  }

  const resolved = await resolveExistingProjectChoice({
    org,
    project: seed.project,
    yes: initial.yes,
    promptOnExisting: Boolean(initial.project && !initial.org),
  });
  if (resolved.shouldAbort) {
    return null;
  }

  return mergeProjectSelection(seed, resolved);
}

function mergeProjectSelection(
  seed: InitContextSeed,
  resolved: ExistingProjectChoice
): ProjectSelection {
  const project = "project" in resolved ? resolved.project : seed.project;
  const clearedProject =
    "project" in resolved && resolved.project === undefined;

  return {
    project,
    existingProject: clearedProject
      ? undefined
      : (resolved.existingProject ?? seed.existingProject),
  };
}

async function resolveDetectedProject(initial: WizardOptions): Promise<{
  org?: string;
  project?: string;
  existingProject?: ExistingProjectData;
  shouldAbort?: boolean;
} | null> {
  if (initial.org || initial.project) {
    return null;
  }

  let detectedProject: { orgSlug: string; projectSlug: string } | null = null;
  try {
    detectedProject = await detectExistingProject(initial.directory);
  } catch {
    return null;
  }
  if (!detectedProject) {
    return null;
  }

  const existingProject = await tryGetExistingProjectData(
    detectedProject.orgSlug,
    detectedProject.projectSlug
  ).catch(() => null);

  if (initial.yes) {
    return {
      org: detectedProject.orgSlug,
      project: detectedProject.projectSlug,
      ...(existingProject ? { existingProject } : {}),
    };
  }

  const choice = await select({
    message: "Found an existing Sentry project in this codebase.",
    options: [
      {
        value: "existing" as const,
        label: `Use existing project (${detectedProject.orgSlug}/${detectedProject.projectSlug})`,
        hint: "Sentry is already configured here",
      },
      {
        value: "create" as const,
        label: "Create a new Sentry project",
      },
    ],
  });
  if (isCancel(choice)) {
    throw new WizardCancelledError();
  }
  if (choice === "existing") {
    return {
      org: detectedProject.orgSlug,
      project: detectedProject.projectSlug,
      ...(existingProject ? { existingProject } : {}),
    };
  }

  return {};
}

async function resolveExistingProjectChoice(opts: {
  org: string;
  project: string;
  yes: boolean;
  promptOnExisting: boolean;
}): Promise<ExistingProjectChoice> {
  const slug = slugify(opts.project);
  if (!slug) {
    return { project: opts.project };
  }

  const existingProject = await tryGetExistingProjectData(opts.org, slug).catch(
    () => null
  );
  if (!existingProject) {
    return { project: opts.project };
  }

  if (!opts.promptOnExisting || opts.yes) {
    return {
      project: existingProject.projectSlug,
      existingProject,
    };
  }

  const choice = await select({
    message: `Found existing project '${slug}' in ${opts.org}.`,
    options: [
      {
        value: "existing" as const,
        label: `Use existing (${opts.org}/${slug})`,
        hint: "Already configured",
      },
      {
        value: "create" as const,
        label: "Create a new project",
        hint: "Wizard will detect the project name from your codebase",
      },
    ],
  });
  if (isCancel(choice)) {
    throw new WizardCancelledError();
  }
  if (choice === "create") {
    return { project: undefined };
  }

  return {
    project: existingProject.projectSlug,
    existingProject,
  };
}

async function resolveTeam(
  org: string,
  initial: WizardOptions
): Promise<string | null> {
  try {
    const result = await resolveOrCreateTeam(org, {
      team: initial.team,
      autoCreateSlug: "default",
      usageHint: "sentry init",
      dryRun: initial.dryRun,
      onAmbiguous: initial.yes
        ? async (candidates) => (candidates[0] as SentryTeam).slug
        : async (candidates) => {
            const selected = await select({
              message: "Which team should own this project?",
              options: candidates.map((team) => ({
                value: team.slug,
                label: team.slug,
                hint: team.name !== team.slug ? team.name : undefined,
              })),
            });
            if (isCancel(selected)) {
              throw new WizardCancelledError();
            }
            return selected;
          },
    });
    return result.slug;
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      throw error;
    }
    throw error instanceof WizardError
      ? error
      : new WizardError(error instanceof Error ? error.message : String(error));
  }
}

async function resolveOrgSlug(
  cwd: string,
  yes: boolean
): Promise<string | { ok: false; error: string }> {
  const resolved = await resolveOrgPrefetched(cwd);
  if (resolved && !NUMERIC_ORG_ID_RE.test(resolved.org)) {
    return resolved.org;
  }

  const orgs = await listOrganizations();
  if (orgs.length === 0) {
    return {
      ok: false,
      error: "Not authenticated. Run 'sentry login' first.",
    };
  }
  if (orgs.length === 1 && orgs[0]) {
    return orgs[0].slug;
  }

  if (yes) {
    const slugs = orgs.map((org) => org.slug).join(", ");
    return {
      ok: false,
      error: `Multiple organizations found (${slugs}). Set SENTRY_ORG to specify which one.`,
    };
  }

  const selected = await select({
    message: "Which organization should the project be created in?",
    options: orgs.map((org) => ({
      value: org.slug,
      label: org.name,
      hint: org.slug,
    })),
  });
  if (isCancel(selected)) {
    throw new WizardCancelledError();
  }
  return selected;
}

async function detectExistingProject(
  cwd: string
): Promise<{ orgSlug: string; projectSlug: string } | null> {
  const { detectDsn } = await import("../dsn/index.js");
  const dsn = await detectDsn(cwd);
  if (!dsn?.publicKey) {
    return null;
  }

  try {
    const { resolveDsnByPublicKey } = await import("../resolve-target.js");
    const resolved = await resolveDsnByPublicKey(dsn);
    if (!resolved) {
      return null;
    }
    return {
      orgSlug: resolved.org,
      projectSlug: resolved.project,
    };
  } catch {
    return null;
  }
}
