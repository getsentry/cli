import type { SentryProject } from "../../types/index.js";
import { listOrganizations, listProjects } from "../api-client.js";
import { getAuthToken } from "../db/auth.js";
import { ApiError, AuthError, HostScopeError, WizardError } from "../errors.js";
import { resolveAllTargets } from "../resolve-target.js";
import type { ResolvedConcreteTeam } from "../resolve-team.js";
import { captureOAuthScopeRecoveryGate } from "../scope-recovery.js";
import { buildProjectUrl } from "../sentry-urls.js";
import { slugify } from "../utils.js";
import { WizardCancelledError } from "./clack-utils.js";
import { tryGetExistingProjectData } from "./existing-project.js";
import { resolveOrgPrefetched } from "./org-prefetch.js";
import type {
  ExistingProjectData,
  ResolvedInitContext,
  WizardOptions,
} from "./types.js";
import { isCancelled, type WizardUI } from "./ui/types.js";

const NUMERIC_ORG_ID_RE = /^\d+$/;

type ExistingProjectChoice = {
  project?: string;
  existingProject?: ExistingProjectData;
};

type CanonicalProjectCandidate = {
  org: string;
  project: string;
  existingProject?: ExistingProjectData;
};

type InitContextSeed = {
  org?: string;
  project?: string;
  existingProject?: ExistingProjectData;
  detectedProjects?: CanonicalProjectCandidate[];
};

type ProjectSelection = Pick<
  ResolvedInitContext,
  "project" | "existingProject"
>;

/**
 * Resolve org, project, team, and auth state before the init workflow starts.
 */
export async function resolveInitContext(
  initial: WizardOptions,
  ui: WizardUI
): Promise<ResolvedInitContext | null> {
  return await withPreflightHandling(ui, async () => {
    const seed = await resolveInitContextSeed(initial);

    const org = await ensureOrg(seed.org, initial, ui);
    const projectSelection = await resolveProjectSelection(
      org,
      initial,
      seed,
      ui
    );
    if (!projectSelection) {
      return null;
    }

    const team = initial.team
      ? ({ slug: initial.team, source: "explicit" } as const)
      : undefined;

    return buildResolvedInitContext(initial, org, team, projectSelection);
  });
}

async function withPreflightHandling(
  ui: WizardUI,
  action: () => Promise<ResolvedInitContext | null>
): Promise<ResolvedInitContext | null> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      ui.cancel("Setup cancelled.");
      ui.feedback("cancelled");
      process.exitCode = 0;
      return null;
    }

    if (
      error instanceof AuthError ||
      error instanceof HostScopeError ||
      (error instanceof ApiError &&
        (error.status === 401 || error.status === 403))
    ) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    ui.log.error(message);
    ui.cancel("Setup failed.");
    ui.feedback("failed");
    throw error instanceof WizardError ? error : new WizardError(message);
  }
}

function buildResolvedInitContext(
  initial: WizardOptions,
  org: string,
  team: ResolvedConcreteTeam | undefined,
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
    app: initial.app,
    authToken: getAuthToken(),
    existingProject: selection.existingProject,
  };
}

async function resolveInitContextSeed(
  initial: WizardOptions
): Promise<InitContextSeed> {
  const preferredOrg =
    initial.org ?? (await resolvePreferredOrg(initial.directory));
  const detected = await resolveCanonicalProjects(initial, preferredOrg);
  const candidates = preferredOrg
    ? detected.filter((candidate) => candidate.org === preferredOrg)
    : detected;
  const concrete = candidates.length === 1 ? candidates[0] : undefined;
  const candidateOrgs = [
    ...new Set(candidates.map((candidate) => candidate.org)),
  ];
  return {
    org:
      preferredOrg ??
      concrete?.org ??
      (candidateOrgs.length === 1 ? candidateOrgs[0] : undefined),
    project: concrete?.project ?? initial.project,
    existingProject: concrete?.existingProject,
    detectedProjects: candidates,
  };
}

/** Resolve organization-only context before project inference. */
async function resolvePreferredOrg(cwd: string): Promise<string | undefined> {
  const resolved = await resolveOrgPrefetched(cwd);
  return resolved && !NUMERIC_ORG_ID_RE.test(resolved.org)
    ? resolved.org
    : undefined;
}

async function ensureOrg(
  org: string | undefined,
  initial: WizardOptions,
  ui: WizardUI
): Promise<string> {
  if (org) {
    return org;
  }

  const orgResult = await resolveOrgSlug(initial.directory, initial.yes, ui);
  if (typeof orgResult === "string") {
    return orgResult;
  }

  throw new WizardError(orgResult.error ?? "Failed to resolve organization.");
}

async function resolveProjectSelection(
  org: string,
  initial: WizardOptions,
  seed: InitContextSeed,
  ui: WizardUI
): Promise<ProjectSelection | null> {
  if (seed.project) {
    const resolved = await resolveExistingProjectChoice({
      org,
      project: seed.project,
      existingProject: seed.existingProject,
    });
    return mergeProjectSelection(seed, resolved);
  }

  const candidates = seed.detectedProjects?.filter(
    (candidate) => candidate.org === org
  );
  if (candidates?.length === 1) {
    const candidate = candidates[0];
    if (candidate) {
      const resolved = await resolveExistingProjectChoice(candidate);
      return {
        project: resolved.project ?? candidate.project,
        existingProject: resolved.existingProject ?? candidate.existingProject,
      };
    }
  }

  return await resolveImplicitProjectSelection(org, initial, ui);
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

/**
 * Reuse the CLI-wide org/project resolver instead of maintaining an init-only
 * detection policy. Init auto-selects only a single concrete target; an empty
 * or ambiguous result continues to the create-first flow.
 */
async function resolveCanonicalProjects(
  initial: WizardOptions,
  organizationFilter?: string
): Promise<CanonicalProjectCandidate[]> {
  if (initial.project) {
    return [];
  }

  let resolved: Awaited<ReturnType<typeof resolveAllTargets>>;
  try {
    resolved = await resolveAllTargets({
      cwd: initial.directory,
      resolutionMode: "codebase",
      ...(organizationFilter ? { organizationFilter } : {}),
    });
  } catch {
    return [];
  }

  if (resolved.skippedSelfHosted) {
    return [];
  }

  return resolved.targets
    .filter((target) => target.matchStrength !== "fuzzy")
    .map((target) => {
      // Preserve the exact DSN provenance carried by the shared resolver so a
      // partial multi-DSN resolution can never attach another target's DSN.
      const existingProject = target.detectedDsn
        ? {
            orgSlug: target.org,
            projectSlug: target.project,
            projectId: String(target.projectId ?? target.detectedDsn.projectId),
            dsn: target.detectedDsn.raw,
            url: buildProjectUrl(target.org, target.project),
            ...(target.projectData?.platform
              ? { platform: target.projectData.platform }
              : {}),
          }
        : undefined;

      return {
        org: target.org,
        project: target.project,
        existingProject,
      };
    });
}

async function resolveExistingProjectChoice(opts: {
  org: string;
  project: string;
  existingProject?: ExistingProjectData;
}): Promise<ExistingProjectChoice> {
  const slug = slugify(opts.project);
  if (!slug) {
    return { project: opts.project };
  }

  const existingProject =
    opts.existingProject &&
    opts.existingProject.orgSlug === opts.org &&
    opts.existingProject.projectSlug === slug
      ? opts.existingProject
      : await tryGetExistingProjectData(opts.org, slug);
  if (!existingProject) {
    return { project: opts.project };
  }

  return {
    project: existingProject.projectSlug,
    existingProject,
  };
}

/**
 * Resolve new-project creation versus an existing project after the shared
 * resolver found no unique target. Creation is the default and selecting an
 * existing project is a separate, deliberate action.
 */
async function resolveImplicitProjectSelection(
  org: string,
  initial: WizardOptions,
  ui: WizardUI
): Promise<ProjectSelection | null> {
  if (initial.yes) {
    return {};
  }

  const intent = await ui.select<"create" | "existing">({
    message: "How should Sentry be configured for this codebase?",
    options: [
      {
        value: "create",
        label: "Create a new Sentry project",
        hint: "Recommended — no matching project was found",
      },
      {
        value: "existing",
        label: "Use an existing Sentry project",
      },
    ],
  });
  if (isCancelled(intent)) {
    throw new WizardCancelledError();
  }
  if (intent === "create") {
    return {};
  }

  let projects: SentryProject[];
  try {
    projects = await listProjects(org);
  } catch (error) {
    const reason = error instanceof ApiError ? error.format() : String(error);
    throw new WizardError(
      `Could not list existing projects in '${org}'.\n\n${reason}`
    );
  }
  if (projects.length === 0) {
    throw new WizardError(
      `There are no existing projects in '${org}'. Choose "Create a new Sentry project" instead.`
    );
  }

  const projectSlug = await ui.select<string>({
    message: "Which existing Sentry project should be used?",
    options: projects.map((project) => ({
      value: project.slug,
      label: project.name,
      ...(project.name !== project.slug ? { hint: project.slug } : {}),
    })),
  });
  if (isCancelled(projectSlug)) {
    throw new WizardCancelledError();
  }

  const existingProject = await loadExistingProject(
    org,
    projectSlug,
    "your project selection"
  );
  if (!existingProject) {
    throw new WizardError(
      `Project '${org}/${projectSlug}' is no longer available. Run sentry init again to refresh the project list.`
    );
  }
  return { project: existingProject.projectSlug, existingProject };
}

async function loadExistingProject(
  org: string,
  project: string,
  detectedFrom: string
): Promise<ExistingProjectData | null> {
  try {
    return await tryGetExistingProjectData(org, project);
  } catch (error) {
    const reason = error instanceof ApiError ? error.format() : String(error);
    throw new WizardError(
      `Found existing project '${org}/${project}' from ${detectedFrom}, but could not load its DSN.\n\n${reason}`
    );
  }
}

/**
 * Format a 403/401 ApiError from listOrganizations() into a { ok: false }
 * result, or re-throw if the error is something else.
 *
 * 403: token lacks org:read scope — user can bypass by supplying the org slug
 * directly. 401: token is invalid/expired — supplying an org won't help, only
 * re-authenticating will.
 */
function handleOrgListError(error: unknown): { ok: false; error: string } {
  if (error instanceof ApiError && error.status === 403) {
    const lines: string[] = ["Could not list organizations (403 Forbidden)."];
    if (error.detail) {
      lines.push(error.detail, "");
    }
    lines.push(
      "Specify the org on the command line:  sentry init <org-slug>/",
      "Or set an environment variable:       SENTRY_ORG=<org-slug> sentry init"
    );
    return { ok: false, error: lines.join("\n  ") };
  }
  if (error instanceof ApiError && error.status === 401) {
    const lines: string[] = [
      "Could not list organizations (401 Unauthorized).",
    ];
    if (error.detail) {
      lines.push(error.detail);
    }
    return { ok: false, error: lines.join("\n  ") };
  }
  throw error;
}

async function resolveOrgSlug(
  cwd: string,
  yes: boolean,
  ui: WizardUI
): Promise<string | { ok: false; error: string }> {
  const resolved = await resolveOrgPrefetched(cwd);
  if (resolved && !NUMERIC_ORG_ID_RE.test(resolved.org)) {
    return resolved.org;
  }

  let orgs: Awaited<ReturnType<typeof listOrganizations>>;
  const scopeRecovery = captureOAuthScopeRecoveryGate();
  try {
    orgs = await listOrganizations();
  } catch (error) {
    if (await scopeRecovery.shouldDelegate(error, { unattended: yes })) {
      throw error;
    }
    return handleOrgListError(error);
  }
  orgs.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug)
  );
  if (orgs.length === 0) {
    return {
      ok: false,
      error: "Not authenticated. Run 'sentry auth login' first.",
    };
  }
  if (orgs.length === 1 && orgs[0]) {
    return orgs[0].slug;
  }

  if (yes) {
    const slugs = orgs.map((org) => org.slug).join(", ");
    return {
      ok: false,
      error: [
        `Multiple organizations found (${slugs}).`,
        "Specify one with: sentry init <org-slug>/ [directory]",
        "  or set SENTRY_ORG=<org-slug>",
      ].join("\n"),
    };
  }

  const selected = await ui.select<string>({
    message: "Which organization should Sentry use?",
    options: orgs.map((org) => ({
      value: org.slug,
      label: org.name,
      hint: org.slug,
    })),
  });
  if (isCancelled(selected)) {
    throw new WizardCancelledError();
  }
  return selected;
}
