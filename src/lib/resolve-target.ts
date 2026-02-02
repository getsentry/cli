/**
 * Target Resolution
 *
 * Shared utilities for resolving organization and project context from
 * various sources: CLI flags, config defaults, and DSN detection.
 *
 * Resolution priority (highest to lowest):
 * 1. Explicit CLI flags
 * 2. Config defaults
 * 3. DSN auto-detection (source code, .env files, environment variables)
 */

import { findProjectByDsnKey, getProject } from "./api-client.js";
import { getDefaultOrganization, getDefaultProject } from "./db/defaults.js";
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
  formatMultipleProjectsFooter,
  getDsnSourceDescription,
} from "./dsn/index.js";
import { AuthError, ContextError } from "./errors.js";

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
  /** Organization slug from CLI flag */
  org?: string;
  /** Project slug from CLI flag */
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
  /** Organization slug from CLI flag */
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

/**
 * Resolve all targets for monorepo-aware commands.
 *
 * When multiple DSNs are detected, resolves all of them in parallel
 * and returns a footer message for display.
 *
 * Resolution priority:
 * 1. CLI flags (--org and --project) - returns single target
 * 2. Config defaults - returns single target
 * 3. DSN auto-detection - may return multiple targets
 *
 * @param options - Resolution options with flags and cwd
 * @returns All resolved targets and optional footer message
 * @throws Error if only one of org/project flags is provided
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
      options.usageHint ?? "sentry <command> --org <org> --project <project>"
    );
  }

  // 2. Config defaults
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

  // 3. DSN auto-detection (may find multiple in monorepos)
  const detection = await detectAllDsns(cwd);

  if (detection.all.length === 0) {
    return { targets: [] };
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
 * 1. CLI flags (--org and --project) - both must be provided together
 * 2. Config defaults
 * 3. DSN auto-detection
 *
 * @param options - Resolution options with flags and cwd
 * @returns Resolved target, or null if resolution failed
 * @throws Error if only one of org/project flags is provided
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
      options.usageHint ?? "sentry <command> --org <org> --project <project>"
    );
  }

  // 2. Config defaults
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

  // 3. DSN auto-detection
  try {
    return await resolveFromDsn(cwd);
  } catch {
    return null;
  }
}

/**
 * Resolve organization only from multiple sources.
 *
 * Resolution priority:
 * 1. CLI flag (--org)
 * 2. Config defaults
 * 3. DSN auto-detection
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

  // 2. Config defaults
  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return { org: defaultOrg };
  }

  // 3. DSN auto-detection
  try {
    return await resolveOrgFromDsn(cwd);
  } catch {
    return null;
  }
}

/**
 * Discriminated union type values for `ParsedOrgProject`.
 * Use these constants instead of string literals for type safety.
 */
export const ProjectSpecificationType = {
  /** Explicit org/project provided (e.g., "sentry/cli") */
  Explicit: "explicit",
  /** Org with trailing slash for all projects (e.g., "sentry/") */
  OrgAll: "org-all",
  /** Project slug only, search across all orgs (e.g., "cli") */
  ProjectSearch: "project-search",
  /** No input, auto-detect from DSN/config */
  AutoDetect: "auto-detect",
} as const;

/**
 * Parsed result from an org/project positional argument.
 * Discriminated union based on the `type` field.
 */
export type ParsedOrgProject =
  | {
      type: typeof ProjectSpecificationType.Explicit;
      org: string;
      project: string;
    }
  | { type: typeof ProjectSpecificationType.OrgAll; org: string }
  | { type: typeof ProjectSpecificationType.ProjectSearch; projectSlug: string }
  | { type: typeof ProjectSpecificationType.AutoDetect };

/**
 * Parse an org/project positional argument string.
 *
 * Supports the following patterns:
 * - `undefined` or empty → auto-detect from DSN/config
 * - `sentry/cli` → explicit org and project
 * - `sentry/` → org with all projects
 * - `/cli` → search for project across all orgs (leading slash)
 * - `cli` → search for project across all orgs
 *
 * @param arg - Input string from CLI positional argument
 * @returns Parsed result with type discrimination
 *
 * @example
 * parseOrgProjectArg(undefined)     // { type: "auto-detect" }
 * parseOrgProjectArg("sentry/cli")  // { type: "explicit", org: "sentry", project: "cli" }
 * parseOrgProjectArg("sentry/")     // { type: "org-all", org: "sentry" }
 * parseOrgProjectArg("/cli")        // { type: "project-search", projectSlug: "cli" }
 * parseOrgProjectArg("cli")         // { type: "project-search", projectSlug: "cli" }
 */
export function parseOrgProjectArg(arg: string | undefined): ParsedOrgProject {
  if (!arg || arg.trim() === "") {
    return { type: "auto-detect" };
  }

  const trimmed = arg.trim();

  if (trimmed.includes("/")) {
    const slashIndex = trimmed.indexOf("/");
    const org = trimmed.slice(0, slashIndex);
    const project = trimmed.slice(slashIndex + 1);

    if (!org) {
      // "/cli" → search for project across all orgs
      return { type: "project-search", projectSlug: project };
    }

    if (!project) {
      // "sentry/" → list all projects in org
      return { type: "org-all", org };
    }

    // "sentry/cli" → explicit org and project
    return { type: "explicit", org, project };
  }

  // No slash → search for project across all orgs
  return { type: "project-search", projectSlug: trimmed };
}
