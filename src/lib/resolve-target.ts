/**
 * Target Resolution
 *
 * Shared utilities for resolving organization and project context from
 * various sources: CLI flags, environment variables, config defaults,
 * and DSN detection.
 *
 * Resolution priority (highest to lowest):
 * 1. Explicit CLI flags
 * 2. SENTRY_ORG / SENTRY_PROJECT environment variables
 * 3. Config defaults
 * 4. DSN auto-detection (source code, .env files, environment variables)
 * 5. Directory name inference (matches project slugs with word boundaries)
 */

import { basename } from "node:path";
import {
  findProjectByDsnKey,
  findProjectsByPattern,
  findProjectsBySlug,
  getProject,
} from "./api-client.js";
import { type ParsedOrgProject, parseOrgProjectArg } from "./arg-parsing.js";
import { getDefaultOrganization, getDefaultProject } from "./db/defaults.js";
import { getCachedDsn, setCachedDsn } from "./db/dsn-cache.js";
import {
  getCachedProject,
  getCachedProjectByDsnKey,
  setCachedProject,
  setCachedProjectByDsnKey,
} from "./db/project-cache.js";
import type { DetectedDsn } from "./dsn/index.js";
import {
  detectAllDsns,
  detectDsn,
  findProjectRoot,
  formatMultipleProjectsFooter,
  getDsnSourceDescription,
} from "./dsn/index.js";
import { AuthError, ContextError, ValidationError } from "./errors.js";

/**
 * Resolved organization and project target for API calls.
 */
export type ResolvedTarget = {
  /** Organization slug for API calls */
  org: string;
  /** Project slug for API calls */
  project: string;
  /** Human-readable org name (falls back to slug) */
  orgDisplay: string;
  /** Human-readable project name (falls back to slug) */
  projectDisplay: string;
  /** Source description if auto-detected (e.g., ".env.local", "src/index.ts") */
  detectedFrom?: string;
  /** Package path in monorepo (e.g., "packages/frontend") */
  packagePath?: string;
};

/**
 * Result of resolving all targets (for monorepo-aware commands).
 */
export type ResolvedTargets = {
  /** All resolved targets */
  targets: ResolvedTarget[];
  /** Footer message to display if multiple projects detected */
  footer?: string;
  /** Number of self-hosted DSNs that were detected but couldn't be resolved */
  skippedSelfHosted?: number;
  /** All detected DSNs (for fingerprinting in alias cache) */
  detectedDsns?: DetectedDsn[];
};

/**
 * Resolved organization for API calls (without project).
 */
export type ResolvedOrg = {
  /** Organization slug for API calls */
  org: string;
  /** Source description if auto-detected */
  detectedFrom?: string;
};

/**
 * Options for resolving org and project.
 */
export type ResolveOptions = {
  /** Organization slug */
  org?: string;
  /** Project slug */
  project?: string;
  /** Current working directory for DSN detection */
  cwd: string;
  /** Usage hint shown when only one of org/project is provided */
  usageHint?: string;
};

/**
 * Options for resolving org only.
 */
export type ResolveOrgOptions = {
  /** Organization slug */
  org?: string;
  /** Current working directory for DSN detection */
  cwd: string;
};

/**
 * Resolve organization and project from DSN detection.
 * Uses cached project info when available, otherwise fetches and caches it.
 *
 * @param cwd - Current working directory to search for DSN
 * @returns Resolved target with org/project info, or null if DSN not found
 */
export async function resolveFromDsn(
  cwd: string
): Promise<ResolvedTarget | null> {
  const dsn = await detectDsn(cwd);
  if (!(dsn?.orgId && dsn.projectId)) {
    return null;
  }

  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache first
  const cached = await getCachedProject(dsn.orgId, dsn.projectId);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
    };
  }

  // Cache miss — fetch project details and cache them
  const projectInfo = await getProject(dsn.orgId, dsn.projectId);

  if (projectInfo.organization) {
    await setCachedProject(dsn.orgId, dsn.projectId, {
      orgSlug: projectInfo.organization.slug,
      orgName: projectInfo.organization.name,
      projectSlug: projectInfo.slug,
      projectName: projectInfo.name,
    });

    return {
      org: projectInfo.organization.slug,
      project: projectInfo.slug,
      orgDisplay: projectInfo.organization.name,
      projectDisplay: projectInfo.name,
      detectedFrom,
    };
  }

  // Fallback to numeric IDs if org info missing (rare edge case)
  return {
    org: dsn.orgId,
    project: dsn.projectId,
    orgDisplay: dsn.orgId,
    projectDisplay: projectInfo.name,
    detectedFrom,
  };
}

/**
 * Resolve organization only from DSN detection.
 *
 * @param cwd - Current working directory to search for DSN
 * @returns Resolved org info, or null if DSN not found
 */
export async function resolveOrgFromDsn(
  cwd: string
): Promise<ResolvedOrg | null> {
  const dsn = await detectDsn(cwd);
  if (!dsn?.orgId) {
    return null;
  }

  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache for org slug (only if we have both org and project IDs)
  if (dsn.projectId) {
    const cached = await getCachedProject(dsn.orgId, dsn.projectId);
    if (cached) {
      return {
        org: cached.orgSlug,
        detectedFrom,
      };
    }
  }

  // Fall back to numeric org ID (API accepts both slug and numeric ID)
  return {
    org: dsn.orgId,
    detectedFrom,
  };
}

/**
 * Resolve a DSN without orgId by searching for the project via DSN public key.
 * Uses the /api/0/projects?query=dsn:<key> endpoint.
 *
 * @param dsn - Detected DSN (must have publicKey)
 * @returns Resolved target or null if resolution failed
 */
async function resolveDsnByPublicKey(
  dsn: DetectedDsn
): Promise<ResolvedTarget | null> {
  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache first (keyed by publicKey for DSNs without orgId)
  const cached = await getCachedProjectByDsnKey(dsn.publicKey);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
      packagePath: dsn.packagePath,
    };
  }

  // Cache miss — search for project by DSN public key
  try {
    const projectInfo = await findProjectByDsnKey(dsn.publicKey);

    if (!projectInfo) {
      return null;
    }

    if (projectInfo.organization) {
      await setCachedProjectByDsnKey(dsn.publicKey, {
        orgSlug: projectInfo.organization.slug,
        orgName: projectInfo.organization.name,
        projectSlug: projectInfo.slug,
        projectName: projectInfo.name,
      });

      return {
        org: projectInfo.organization.slug,
        project: projectInfo.slug,
        orgDisplay: projectInfo.organization.name,
        projectDisplay: projectInfo.name,
        detectedFrom,
        packagePath: dsn.packagePath,
      };
    }

    // Project found but no org info - unusual but handle gracefully
    return null;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    return null;
  }
}

/**
 * Resolve a single detected DSN to a ResolvedTarget.
 * Uses cache when available, otherwise fetches from API.
 *
 * Supports two resolution paths:
 * 1. DSNs with orgId: Use getProject(orgId, projectId) API
 * 2. DSNs without orgId: Use findProjectByDsnKey(publicKey) API
 *
 * @param dsn - Detected DSN to resolve
 * @returns Resolved target or null if resolution failed
 */
async function resolveDsnToTarget(
  dsn: DetectedDsn
): Promise<ResolvedTarget | null> {
  // For DSNs without orgId (self-hosted or some SaaS patterns),
  // resolve by searching for the project via DSN public key
  if (!dsn.orgId) {
    return resolveDsnByPublicKey(dsn);
  }

  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache first
  const cached = await getCachedProject(dsn.orgId, dsn.projectId);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
      packagePath: dsn.packagePath,
    };
  }

  // Cache miss — fetch project details and cache them
  try {
    const projectInfo = await getProject(dsn.orgId, dsn.projectId);

    if (projectInfo.organization) {
      await setCachedProject(dsn.orgId, dsn.projectId, {
        orgSlug: projectInfo.organization.slug,
        orgName: projectInfo.organization.name,
        projectSlug: projectInfo.slug,
        projectName: projectInfo.name,
      });

      return {
        org: projectInfo.organization.slug,
        project: projectInfo.slug,
        orgDisplay: projectInfo.organization.name,
        projectDisplay: projectInfo.name,
        detectedFrom,
        packagePath: dsn.packagePath,
      };
    }

    // Fallback to numeric IDs if org info missing
    return {
      org: dsn.orgId,
      project: dsn.projectId,
      orgDisplay: dsn.orgId,
      projectDisplay: projectInfo.name,
      detectedFrom,
      packagePath: dsn.packagePath,
    };
  } catch (error) {
    // Auth errors should propagate - user needs to log in
    if (error instanceof AuthError) {
      throw error;
    }
    // Other errors (API, network) - skip this DSN silently
    return null;
  }
}

/** Minimum directory name length for inference (avoids matching too broadly) */
const MIN_DIR_NAME_LENGTH = 2;

/**
 * Check if a directory name is valid for project inference.
 * Rejects empty strings, hidden directories, and names that are too short.
 *
 * @internal Exported for testing
 */
export function isValidDirNameForInference(dirName: string): boolean {
  if (!dirName || dirName.length < MIN_DIR_NAME_LENGTH) {
    return false;
  }
  // Reject hidden directories (starting with .) - includes ".", "..", ".git", ".env"
  if (dirName.startsWith(".")) {
    return false;
  }
  return true;
}

/**
 * Infer project(s) from directory name when DSN detection fails.
 * Uses word-boundary matching (`\b`) against all accessible projects.
 *
 * Caches results in dsn_cache with source: "inferred" for performance.
 * Cache is invalidated when directory mtime changes or after 24h TTL.
 *
 * @param cwd - Current working directory
 * @returns Resolved targets, or empty if no matches found
 */
async function inferFromDirectoryName(cwd: string): Promise<ResolvedTargets> {
  const { projectRoot } = await findProjectRoot(cwd);
  const dirName = basename(projectRoot);

  // Skip inference for invalid directory names
  if (!isValidDirNameForInference(dirName)) {
    return { targets: [] };
  }

  // Check cache first (reuse DSN cache with source: "inferred")
  const cached = await getCachedDsn(projectRoot);
  if (cached?.source === "inferred") {
    const detectedFrom = `directory name "${dirName}"`;

    // Return all cached targets if available
    if (cached.allResolved && cached.allResolved.length > 0) {
      const targets = cached.allResolved.map((r) => ({
        org: r.orgSlug,
        project: r.projectSlug,
        orgDisplay: r.orgName,
        projectDisplay: r.projectName,
        detectedFrom,
      }));
      return {
        targets,
        footer:
          targets.length > 1
            ? `Found ${targets.length} projects matching directory "${dirName}"`
            : undefined,
      };
    }

    // Fallback to single resolved target (legacy cache entries)
    if (cached.resolved) {
      return {
        targets: [
          {
            org: cached.resolved.orgSlug,
            project: cached.resolved.projectSlug,
            orgDisplay: cached.resolved.orgName,
            projectDisplay: cached.resolved.projectName,
            detectedFrom,
          },
        ],
      };
    }
  }

  // Search for matching projects using word-boundary matching
  let matches: Awaited<ReturnType<typeof findProjectsByPattern>>;
  try {
    matches = await findProjectsByPattern(dirName);
  } catch {
    // If not authenticated or API fails, skip inference silently
    return { targets: [] };
  }

  if (matches.length === 0) {
    return { targets: [] };
  }

  // Cache all matches for faster subsequent lookups
  const [primary] = matches;
  if (primary) {
    const allResolved = matches.map((m) => ({
      orgSlug: m.orgSlug,
      orgName: m.organization?.name ?? m.orgSlug,
      projectSlug: m.slug,
      projectName: m.name,
    }));

    await setCachedDsn(projectRoot, {
      dsn: "", // No DSN for inferred
      projectId: primary.id,
      source: "inferred",
      resolved: allResolved[0], // Primary for backwards compatibility
      allResolved,
    });
  }

  const detectedFrom = `directory name "${dirName}"`;
  const targets: ResolvedTarget[] = matches.map((m) => ({
    org: m.orgSlug,
    project: m.slug,
    orgDisplay: m.organization?.name ?? m.orgSlug,
    projectDisplay: m.name,
    detectedFrom,
  }));

  return {
    targets,
    footer:
      matches.length > 1
        ? `Found ${matches.length} projects matching directory "${dirName}"`
        : undefined,
  };
}

/**
 * Read org/project from SENTRY_ORG and SENTRY_PROJECT environment variables.
 *
 * SENTRY_PROJECT supports the `<org>/<project>` combo notation (presence of
 * `/` distinguishes it from a plain project slug). When the combo form is
 * used, SENTRY_ORG is ignored.
 *
 * @returns Resolved org+project, org-only, or null if no env vars are set
 */
function resolveFromEnvVars(): {
  org: string;
  project?: string;
  detectedFrom: string;
} | null {
  const rawProject = process.env.SENTRY_PROJECT?.trim();

  // SENTRY_PROJECT=org/project combo takes priority.
  // If the value contains a slash it is always treated as combo notation;
  // a malformed combo (empty org or project part) is discarded entirely
  // so it cannot leak a slash into a project slug.
  if (rawProject?.includes("/")) {
    const slashIdx = rawProject.indexOf("/");
    const org = rawProject.slice(0, slashIdx);
    const project = rawProject.slice(slashIdx + 1);
    if (org && project) {
      return { org, project, detectedFrom: "SENTRY_PROJECT env var" };
    }
    // Malformed combo — fall through without using rawProject as a slug
    const envOrg = process.env.SENTRY_ORG?.trim();
    return envOrg ? { org: envOrg, detectedFrom: "SENTRY_ORG env var" } : null;
  }

  const envOrg = process.env.SENTRY_ORG?.trim();

  if (envOrg && rawProject) {
    return {
      org: envOrg,
      project: rawProject,
      detectedFrom: "SENTRY_ORG / SENTRY_PROJECT env vars",
    };
  }

  if (envOrg) {
    return { org: envOrg, detectedFrom: "SENTRY_ORG env var" };
  }

  return null;
}

/**
 * Resolve all targets for monorepo-aware commands.
 *
 * When multiple DSNs are detected, resolves all of them in parallel
 * and returns a footer message for display.
 *
 * Resolution priority:
 * 1. Explicit org and project - returns single target
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars - returns single target
 * 3. Config defaults - returns single target
 * 4. DSN auto-detection - may return multiple targets
 * 5. Directory name inference - matches project slugs with word boundaries
 *
 * @param options - Resolution options with org, project, and cwd
 * @returns All resolved targets and optional footer message
 * @throws Error if only one of org/project is provided
 */
export async function resolveAllTargets(
  options: ResolveOptions
): Promise<ResolvedTargets> {
  const { org, project, cwd } = options;

  // 1. CLI flags take priority (both must be provided together)
  if (org && project) {
    return {
      targets: [
        {
          org,
          project,
          orgDisplay: org,
          projectDisplay: project,
        },
      ],
    };
  }

  // Error if only one flag is provided
  if (org || project) {
    throw new ContextError(
      "Organization and project",
      options.usageHint ?? "sentry <command> <org>/<project>"
    );
  }

  // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
  const envVars = resolveFromEnvVars();
  if (envVars?.project) {
    return {
      targets: [
        {
          org: envVars.org,
          project: envVars.project,
          orgDisplay: envVars.org,
          projectDisplay: envVars.project,
          detectedFrom: envVars.detectedFrom,
        },
      ],
    };
  }

  // 3. Config defaults
  const defaultOrg = await getDefaultOrganization();
  const defaultProject = await getDefaultProject();
  if (defaultOrg && defaultProject) {
    return {
      targets: [
        {
          org: defaultOrg,
          project: defaultProject,
          orgDisplay: defaultOrg,
          projectDisplay: defaultProject,
        },
      ],
    };
  }

  // 4. DSN auto-detection (may find multiple in monorepos)
  const detection = await detectAllDsns(cwd);

  if (detection.all.length === 0) {
    // 5. Fallback: infer from directory name
    return inferFromDirectoryName(cwd);
  }

  // Resolve all DSNs in parallel
  const resolvedTargets = await Promise.all(
    detection.all.map((dsn) => resolveDsnToTarget(dsn))
  );

  // Filter out failed resolutions and deduplicate by org+project
  // (multiple DSNs with different keys can point to same project)
  const seen = new Set<string>();
  const targets = resolvedTargets.filter((t): t is ResolvedTarget => {
    if (t === null) {
      return false;
    }
    const key = `${t.org}:${t.project}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  // Count DSNs that couldn't be resolved (API errors, permissions, etc.)
  const unresolvedCount = resolvedTargets.filter((t) => t === null).length;

  if (targets.length === 0) {
    return {
      targets: [],
      skippedSelfHosted: unresolvedCount > 0 ? unresolvedCount : undefined,
      detectedDsns: detection.all,
    };
  }

  // Format footer if multiple projects detected
  const footer =
    targets.length > 1 ? formatMultipleProjectsFooter(targets) : undefined;

  return {
    targets,
    footer,
    skippedSelfHosted: unresolvedCount > 0 ? unresolvedCount : undefined,
    detectedDsns: detection.all,
  };
}

/**
 * Resolve organization and project from multiple sources.
 *
 * Resolution priority:
 * 1. Explicit org and project - both must be provided together
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars
 * 3. Config defaults
 * 4. DSN auto-detection
 * 5. Directory name inference - matches project slugs with word boundaries
 *
 * @param options - Resolution options with org, project, and cwd
 * @returns Resolved target, or null if resolution failed
 * @throws Error if only one of org/project is provided
 */
export async function resolveOrgAndProject(
  options: ResolveOptions
): Promise<ResolvedTarget | null> {
  const { org, project, cwd } = options;

  // 1. CLI flags take priority (both must be provided together)
  if (org && project) {
    return {
      org,
      project,
      orgDisplay: org,
      projectDisplay: project,
    };
  }

  // Error if only one flag is provided
  if (org || project) {
    throw new ContextError(
      "Organization and project",
      options.usageHint ?? "sentry <command> <org>/<project>"
    );
  }

  // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
  const envVars = resolveFromEnvVars();
  if (envVars?.project) {
    return {
      org: envVars.org,
      project: envVars.project,
      orgDisplay: envVars.org,
      projectDisplay: envVars.project,
      detectedFrom: envVars.detectedFrom,
    };
  }

  // 3. Config defaults
  const defaultOrg = await getDefaultOrganization();
  const defaultProject = await getDefaultProject();
  if (defaultOrg && defaultProject) {
    return {
      org: defaultOrg,
      project: defaultProject,
      orgDisplay: defaultOrg,
      projectDisplay: defaultProject,
    };
  }

  // 4. DSN auto-detection
  try {
    const dsnResult = await resolveFromDsn(cwd);
    if (dsnResult) {
      return dsnResult;
    }
  } catch {
    // Fall through to directory inference
  }

  // 5. Fallback: infer from directory name
  const inferred = await inferFromDirectoryName(cwd);
  const [first] = inferred.targets;
  if (!first) {
    return null;
  }

  // If multiple matches, note it in detectedFrom
  return {
    ...first,
    detectedFrom:
      inferred.targets.length > 1
        ? `${first.detectedFrom} (1 of ${inferred.targets.length} matches)`
        : first.detectedFrom,
  };
}

/**
 * Resolve organization only from multiple sources.
 *
 * Resolution priority:
 * 1. Positional argument
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars
 * 3. Config defaults
 * 4. DSN auto-detection
 *
 * @param options - Resolution options with flag and cwd
 * @returns Resolved org, or null if resolution failed
 */
export async function resolveOrg(
  options: ResolveOrgOptions
): Promise<ResolvedOrg | null> {
  const { org, cwd } = options;

  // 1. CLI flag takes priority
  if (org) {
    return { org };
  }

  // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
  const envVars = resolveFromEnvVars();
  if (envVars) {
    return { org: envVars.org, detectedFrom: envVars.detectedFrom };
  }

  // 3. Config defaults
  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return { org: defaultOrg };
  }

  // 4. DSN auto-detection
  try {
    return await resolveOrgFromDsn(cwd);
  } catch {
    return null;
  }
}

/**
 * Search for a project by slug across all accessible organizations.
 *
 * Common resolution step used by commands that accept a bare project slug
 * (e.g., `sentry event view frontend <id>`). Throws helpful errors when
 * the project isn't found or exists in multiple orgs.
 *
 * @param projectSlug - Project slug to search for
 * @param usageHint - Usage example shown in error messages
 * @param disambiguationExample - Example command for multi-org disambiguation (e.g., "sentry event view <org>/frontend abc123")
 * @returns Resolved org and project slugs
 * @throws {ContextError} If no project found
 * @throws {ValidationError} If project exists in multiple organizations
 */
export async function resolveProjectBySlug(
  projectSlug: string,
  usageHint: string,
  disambiguationExample?: string
): Promise<{ org: string; project: string }> {
  const found = await findProjectsBySlug(projectSlug);
  if (found.length === 0) {
    throw new ContextError(`Project "${projectSlug}"`, usageHint, [
      "Check that you have access to a project with this slug",
    ]);
  }
  if (found.length > 1) {
    const orgList = found.map((p) => `  ${p.orgSlug}/${p.slug}`).join("\n");
    const example = disambiguationExample
      ? `\n\nExample: ${disambiguationExample}`
      : "";
    throw new ValidationError(
      `Project "${projectSlug}" exists in multiple organizations.\n\n` +
        `Specify the organization:\n${orgList}${example}`
    );
  }
  const foundProject = found[0] as (typeof found)[0];
  return {
    org: foundProject.orgSlug,
    project: foundProject.slug,
  };
}

/** Result of resolving organizations to fetch from for listing commands */
export type OrgListResolution = {
  /** Organization slugs to list from */
  orgs: string[];
  /** Optional multi-org footer to display after listing */
  footer?: string;
  /** Number of self-hosted DSNs that could not be resolved */
  skippedSelfHosted?: number;
};

/**
 * Resolve which organizations to fetch data from for listing commands (team, repo).
 *
 * Resolution priority:
 * 1. Explicit org flag → use that single org
 * 2. Config default org → use that org
 * 3. DSN auto-detection → extract unique orgs from detected targets
 * 4. No context found → empty list (caller must decide to show all orgs or error)
 *
 * @param orgFlag - Explicit org slug from CLI positional arg, or undefined
 * @param cwd - Current working directory for DSN detection
 * @returns Orgs to fetch and optional display metadata
 */
export async function resolveOrgsForListing(
  orgFlag: string | undefined,
  cwd: string
): Promise<OrgListResolution> {
  if (orgFlag) {
    return { orgs: [orgFlag] };
  }

  // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
  const envVars = resolveFromEnvVars();
  if (envVars) {
    return { orgs: [envVars.org] };
  }

  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return { orgs: [defaultOrg] };
  }

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

/** Resolved org and project returned by `resolveOrgProjectTarget` */
export type ResolvedOrgProject = {
  /** Organization slug */
  org: string;
  /** Project slug */
  project: string;
};

/**
 * Resolve an org/project target for commands that require a single project
 * (trace list, log list). Rejects `org-all` mode since these commands require
 * a specific project.
 *
 * Handles:
 * - explicit `<org>/<project>` → use directly
 * - project-search `<project>` → find project across all orgs
 * - auto-detect → use DSN detection or config defaults
 * - org-all `<org>/` → throw ContextError asking for a specific project
 *
 * @param parsed - Parsed org/project argument
 * @param cwd - Current working directory for DSN auto-detection
 * @param commandName - Command name used in error messages (e.g., "trace list")
 * @returns Resolved org and project slugs
 * @throws {ContextError} When target cannot be resolved or org-all is used
 */
export async function resolveOrgProjectTarget(
  parsed: ParsedOrgProject,
  cwd: string,
  commandName: string
): Promise<ResolvedOrgProject> {
  const usageHint = `sentry ${commandName} <org>/<project>`;

  switch (parsed.type) {
    case "explicit":
      return { org: parsed.org, project: parsed.project };

    case "org-all":
      throw new ContextError(
        "Project",
        `Please specify a project: sentry ${commandName} ${parsed.org}/<project>`
      );

    case "project-search": {
      const matches = await findProjectsBySlug(parsed.projectSlug);

      if (matches.length === 0) {
        throw new ContextError(
          "Project",
          `No project '${parsed.projectSlug}' found in any accessible organization.\n\n` +
            `Try: sentry ${commandName} <org>/${parsed.projectSlug}`
        );
      }

      if (matches.length > 1) {
        const options = matches
          .map((m) => `  sentry ${commandName} ${m.orgSlug}/${m.slug}`)
          .join("\n");
        throw new ContextError(
          "Project",
          `Found '${parsed.projectSlug}' in ${matches.length} organizations. Please specify:\n${options}`
        );
      }

      const match = matches[0] as (typeof matches)[number];
      return { org: match.orgSlug, project: match.slug };
    }

    case "auto-detect": {
      const resolved = await resolveOrgAndProject({
        cwd,
        usageHint,
      });
      if (!resolved) {
        throw new ContextError("Organization and project", usageHint);
      }
      return { org: resolved.org, project: resolved.project };
    }

    default: {
      const _exhaustiveCheck: never = parsed;
      throw new Error(`Unexpected parsed type: ${_exhaustiveCheck}`);
    }
  }
}

/**
 * Resolve an org/project target from a raw CLI argument string for commands
 * that require a single project (trace list, log list).
 *
 * Convenience wrapper around `resolveOrgProjectTarget` that also calls
 * `parseOrgProjectArg` on the raw string argument.
 *
 * @param target - Raw CLI argument string (or undefined for auto-detect)
 * @param cwd - Current working directory for DSN auto-detection
 * @param commandName - Command name used in error messages (e.g., "trace list")
 * @returns Resolved org and project slugs
 */
export function resolveOrgProjectFromArg(
  target: string | undefined,
  cwd: string,
  commandName: string
): Promise<ResolvedOrgProject> {
  return resolveOrgProjectTarget(parseOrgProjectArg(target), cwd, commandName);
}
