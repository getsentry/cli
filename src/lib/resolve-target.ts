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
 * 3. `.sentryclirc` config file (walked up from CWD, merged with global)
 * 4. Config defaults (SQLite)
 * 5. DSN auto-detection (source code, .env files, environment variables)
 * 6. Directory name inference (matches project slugs with word boundaries)
 */

import { basename } from "node:path";
import pLimit from "p-limit";
import type { SentryProject } from "../types/index.js";
import {
  findProjectByDsnKey,
  findProjectsByPattern,
  findProjectsBySlug,
  getProject,
  listProjects,
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
import { getOrgByNumericId } from "./db/regions.js";
import type { DetectedDsn, DsnDetectionResult } from "./dsn/index.js";
import {
  detectAllDsns,
  detectDsn,
  findProjectRoot,
  formatMultipleProjectsFooter,
  getDsnSourceDescription,
} from "./dsn/index.js";
import { getEnv } from "./env.js";
import {
  ApiError,
  ContextError,
  ResolutionError,
  ValidationError,
  withAuthGuard,
} from "./errors.js";
import { fuzzyMatch } from "./fuzzy.js";
import { logger } from "./logger.js";
import { resolveEffectiveOrg } from "./region.js";
import { CONFIG_FILENAME, loadSentryCliRc } from "./sentryclirc.js";
import { setOrgProjectContext, withTracingSpan } from "./telemetry.js";
import { isAllDigits } from "./utils.js";

const log = logger.withTag("resolve-target");

/**
 * Set telemetry context from a resolved target and return it.
 * Eliminates boilerplate — every resolution function can call this on success.
 */
function withTelemetryContext<T extends { org: string; project?: string }>(
  result: T
): T {
  setOrgProjectContext([result.org], result.project ? [result.project] : []);
  return result;
}

/**
 * Convert a string or numeric ID to a positive integer, or `undefined` if the
 * value is absent, non-numeric, or not a positive integer.
 *
 * Sentry project/org IDs are always positive integers, so `0` and negative
 * values are treated as absent rather than valid IDs.
 */
export function toNumericId(
  id: string | number | null | undefined
): number | undefined {
  if (id === null || id === undefined) {
    return;
  }
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Resolved organization and project target for API calls.
 */
export type ResolvedTarget = {
  /** Organization slug for API calls */
  org: string;
  /** Project slug for API calls */
  project: string;
  /** Numeric project ID for API query params (avoids "not actively selected" errors) */
  projectId?: number;
  /** Human-readable org name (falls back to slug) */
  orgDisplay: string;
  /** Human-readable project name (falls back to slug) */
  projectDisplay: string;
  /** Source description if auto-detected (e.g., ".env.local", "src/index.ts") */
  detectedFrom?: string;
  /** Package path in monorepo (e.g., "packages/frontend") */
  packagePath?: string;
  /** Full project data when already fetched (avoids redundant getProject re-fetch) */
  projectData?: SentryProject;
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
  const cached = getCachedProject(dsn.orgId, dsn.projectId);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      projectId: toNumericId(cached.projectId),
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
    };
  }

  // Cache miss — fetch project details and cache them
  const projectInfo = await getProject(dsn.orgId, dsn.projectId);

  if (projectInfo.organization) {
    setCachedProject(dsn.orgId, dsn.projectId, {
      orgSlug: projectInfo.organization.slug,
      orgName: projectInfo.organization.name,
      projectSlug: projectInfo.slug,
      projectName: projectInfo.name,
      projectId: projectInfo.id,
    });

    return {
      org: projectInfo.organization.slug,
      project: projectInfo.slug,
      projectId: toNumericId(projectInfo.id),
      orgDisplay: projectInfo.organization.name,
      projectDisplay: projectInfo.name,
      detectedFrom,
    };
  }

  // Fallback to numeric IDs if org info missing (rare edge case)
  return {
    org: dsn.orgId,
    project: dsn.projectId,
    projectId: toNumericId(projectInfo.id),
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
    const cached = getCachedProject(dsn.orgId, dsn.projectId);
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
 * Normalize a bare numeric org ID to an org slug.
 *
 * When the project cache is cold, resolveOrgFromDsn returns the raw numeric
 * org ID from the DSN host (e.g., "1169445"). Many API endpoints reject
 * numeric IDs (dashboards return 404/403). This resolves them:
 *
 * 1. Local DB cache lookup (getOrgByNumericId — fast, no API call)
 * 2. Refresh org list via listOrganizationsUncached to populate mapping
 * 3. Falls back to original ID if resolution fails
 *
 * Non-numeric identifiers (already slugs) are returned unchanged.
 *
 * @param orgId - Raw org identifier from DSN (numeric ID or slug)
 * @returns Org slug for API calls
 */
async function normalizeNumericOrg(orgId: string): Promise<string> {
  if (!isAllDigits(orgId)) {
    return orgId;
  }

  // Fast path: check local DB cache for numeric ID → slug mapping
  const cached = getOrgByNumericId(orgId);
  if (cached) {
    return cached.slug;
  }

  // Slow path: fetch org list to populate numeric ID → slug mapping.
  // resolveEffectiveOrg doesn't handle bare numeric IDs (only o-prefixed),
  // so we do a targeted refresh via listOrganizationsUncached().
  try {
    const { listOrganizationsUncached } = await import("./api-client.js");
    await listOrganizationsUncached();
  } catch {
    return orgId;
  }

  // Retry cache after refresh
  const afterRefresh = getOrgByNumericId(orgId);
  return afterRefresh?.slug ?? orgId;
}

/**
 * Resolve a DSN without orgId by searching for the project via DSN public key.
 * Uses the /api/0/projects?query=dsn:<key> endpoint.
 *
 * @param dsn - Detected DSN (must have publicKey)
 * @returns Resolved target or null if resolution failed
 */
export async function resolveDsnByPublicKey(
  dsn: DetectedDsn
): Promise<ResolvedTarget | null> {
  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache first (keyed by publicKey for DSNs without orgId)
  const cached = getCachedProjectByDsnKey(dsn.publicKey);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      projectId: toNumericId(cached.projectId),
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
      packagePath: dsn.packagePath,
    };
  }

  // Cache miss — search for project by DSN public key
  const result = await withAuthGuard(async () => {
    const projectInfo = await findProjectByDsnKey(dsn.publicKey);

    if (!projectInfo) {
      return null;
    }

    if (projectInfo.organization) {
      setCachedProjectByDsnKey(dsn.publicKey, {
        orgSlug: projectInfo.organization.slug,
        orgName: projectInfo.organization.name,
        projectSlug: projectInfo.slug,
        projectName: projectInfo.name,
        projectId: projectInfo.id,
      });

      return {
        org: projectInfo.organization.slug,
        project: projectInfo.slug,
        projectId: toNumericId(projectInfo.id),
        orgDisplay: projectInfo.organization.name,
        projectDisplay: projectInfo.name,
        detectedFrom,
        packagePath: dsn.packagePath,
      };
    }

    // Project found but no org info - unusual but handle gracefully
    return null;
  });
  return result.ok ? result.value : null;
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

  // Capture narrowed values before the closure (TS loses narrowing across closures)
  const orgId = dsn.orgId;
  const { projectId: dsnProjectId, packagePath } = dsn;
  const detectedFrom = getDsnSourceDescription(dsn);

  // Check cache first
  const cached = getCachedProject(orgId, dsnProjectId);
  if (cached) {
    return {
      org: cached.orgSlug,
      project: cached.projectSlug,
      projectId: toNumericId(cached.projectId),
      orgDisplay: cached.orgName,
      projectDisplay: cached.projectName,
      detectedFrom,
      packagePath,
    };
  }

  // Cache miss — fetch project details and cache them
  const result = await withAuthGuard(async () => {
    const projectInfo = await getProject(orgId, dsnProjectId);

    if (projectInfo.organization) {
      setCachedProject(orgId, dsnProjectId, {
        orgSlug: projectInfo.organization.slug,
        orgName: projectInfo.organization.name,
        projectSlug: projectInfo.slug,
        projectName: projectInfo.name,
        projectId: projectInfo.id,
      });

      return {
        org: projectInfo.organization.slug,
        project: projectInfo.slug,
        projectId: toNumericId(projectInfo.id),
        orgDisplay: projectInfo.organization.name,
        projectDisplay: projectInfo.name,
        detectedFrom,
        packagePath,
      };
    }

    // Fallback to numeric IDs if org info missing
    return {
      org: orgId,
      project: dsnProjectId,
      projectId: toNumericId(projectInfo.id),
      orgDisplay: orgId,
      projectDisplay: projectInfo.name,
      detectedFrom,
      packagePath,
    };
  });
  return result.ok ? result.value : null;
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
  const cached = getCachedDsn(projectRoot);
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

    setCachedDsn(projectRoot, {
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
    projectId: toNumericId(m.id),
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
  const rawProject = getEnv().SENTRY_PROJECT?.trim();

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
    const envOrg = getEnv().SENTRY_ORG?.trim();
    return envOrg ? { org: envOrg, detectedFrom: "SENTRY_ORG env var" } : null;
  }

  const envOrg = getEnv().SENTRY_ORG?.trim();

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
 * Find project slugs in the org that are similar to the given slug.
 *
 * Delegates to the shared {@link fuzzyMatch} utility which provides
 * exact, prefix, substring, and Levenshtein distance matching — so
 * typos like "senry" → "sentry" are caught in addition to simple
 * prefix/substring matches. Falls back gracefully on API errors
 * since this is a best-effort hint, not a critical path.
 *
 * @param org - Organization slug to search in
 * @param slug - The project slug that wasn't found
 * @returns Up to 3 similar project slugs, or empty array on error
 */
async function findSimilarProjects(
  org: string,
  slug: string
): Promise<string[]> {
  try {
    const projects = await listProjects(org);
    const slugs = projects.map((p) => p.slug);
    return fuzzyMatch(slug, slugs, { maxResults: 3 });
  } catch {
    // Best-effort — don't let listing failures block the error message
    return [];
  }
}

/**
 * Find similar project slugs across all accessible organizations.
 *
 * Used by project-search resolution when an exact slug match fails.
 * Lists projects in each org, then fuzzy-matches the slug against all
 * available project slugs. Best-effort: API or auth failures for individual
 * orgs are silently skipped.
 *
 * @param slug - The project slug that wasn't found
 * @param orgs - Accessible organizations to search
 * @returns Up to 5 similar projects with their org context, or empty array
 */
async function findSimilarProjectsAcrossOrgs(
  slug: string,
  orgs: { slug: string }[]
): Promise<{ slug: string; orgSlug: string }[]> {
  try {
    const concurrency = pLimit(5);
    const orgProjects = await Promise.all(
      orgs.map((org) =>
        concurrency(async () => {
          const result = await withAuthGuard(() => listProjects(org.slug));
          if (!result.ok) {
            return [];
          }
          return result.value.map((p) => ({
            slug: p.slug,
            orgSlug: org.slug,
          }));
        })
      )
    );
    const allProjects = orgProjects.flat();
    // Deduplicate slugs so fuzzyMatch doesn't waste slots on the same
    // project appearing in multiple orgs.
    const uniqueSlugs = [...new Set(allProjects.map((p) => p.slug))];
    const matches = fuzzyMatch(slug, uniqueSlugs, { maxResults: 5 });
    // Expand matched slugs back to org-qualified entries (may include
    // the same slug from multiple orgs — that's correct for suggestions).
    return matches.flatMap((matched) =>
      allProjects.filter((p) => p.slug === matched)
    );
  } catch {
    return [];
  }
}

/**
 * Attempt fuzzy auto-recovery when a project slug isn't found.
 *
 * If exactly one similar project is found (prefix/substring/close edit
 * distance), auto-recovers by returning it with a warning. With multiple
 * matches, adds suggestions to the thrown ResolutionError.
 *
 * @returns The resolved org/project pair if auto-recovered, or undefined
 */
export async function tryFuzzyProjectRecovery(
  slug: string,
  orgs: { slug: string }[],
  errorFactory: (suggestions: string[]) => ResolutionError
): Promise<{ org: string; project: string } | undefined> {
  const similar = await findSimilarProjectsAcrossOrgs(slug, orgs);
  if (similar.length === 1) {
    const match = similar[0] as (typeof similar)[0];
    log.warn(
      `Project '${slug}' not found. Using similar project '${match.slug}' in org '${match.orgSlug}'.`
    );
    return { org: match.orgSlug, project: match.slug };
  }
  if (similar.length > 1) {
    const suggestions = [
      `Similar projects: ${similar.map((s) => `'${s.orgSlug}/${s.slug}'`).join(", ")}`,
    ];
    throw errorFactory(suggestions);
  }
}

/**
 * Fetch the numeric project ID for an explicit org/project pair.
 *
 * Throws on auth errors and 404s (user-actionable). Returns undefined
 * for transient failures (network, 500s) so the command can still
 * attempt slug-based querying as a fallback.
 *
 * On 404, attempts to list similar projects in the org to help the
 * user find the correct slug (CLI-C0, 36 users).
 */
export async function fetchProjectId(
  org: string,
  project: string
): Promise<number | undefined> {
  const projectResult = await withAuthGuard(() => getProject(org, project));
  if (!projectResult.ok) {
    if (
      projectResult.error instanceof ApiError &&
      projectResult.error.status === 404
    ) {
      const similar = await findSimilarProjects(org, project);
      const suggestions: string[] = [];
      if (similar.length > 0) {
        suggestions.push(
          `Similar projects: ${similar.map((s) => `'${s}'`).join(", ")}`
        );
      }
      suggestions.push(
        `Check the project slug at https://sentry.io/organizations/${org}/projects/`
      );
      throw new ResolutionError(
        `Project '${project}'`,
        `not found in organization '${org}'`,
        `sentry project list ${org}/`,
        suggestions
      );
    }
    return;
  }
  return toNumericId(projectResult.value.id);
}

/**
 * Maximum concurrent DSN resolution API calls.
 * Prevents overwhelming the Sentry API with parallel requests when
 * many DSNs are detected (e.g., monorepos or repos with test fixtures).
 */
const DSN_RESOLVE_CONCURRENCY = 5;

/**
 * Maximum time (ms) to spend resolving DSNs before returning partial results.
 * Prevents indefinite hangs when the API is slow or rate-limiting.
 */
const DSN_RESOLVE_TIMEOUT_MS = 15_000;

/**
 * Resolve DSNs with a concurrency limit and overall timeout.
 *
 * Uses p-limit's `map` helper for concurrency control and races it
 * against `AbortSignal.timeout` so the CLI never hangs indefinitely.
 * Queued tasks check the abort signal before doing work (same pattern
 * as code-scanner's earlyExit flag from PR #414). In-flight tasks that
 * already started are abandoned on timeout — their individual HTTP
 * timeouts (30s in sentry-client.ts) bound them independently.
 *
 * Results are written to a shared array so that tasks completing before
 * the deadline are captured even when the overall operation times out.
 *
 * @param dsns - Deduplicated DSNs to resolve
 * @returns Array of resolved targets (null for failures/timeouts)
 */
async function resolveDsnsWithTimeout(
  dsns: DetectedDsn[]
): Promise<(ResolvedTarget | null)[]> {
  const limit = pLimit(DSN_RESOLVE_CONCURRENCY);
  const signal = AbortSignal.timeout(DSN_RESOLVE_TIMEOUT_MS);

  // Shared results array — tasks write their result as they complete,
  // so partial results survive timeout.
  const results: (ResolvedTarget | null)[] = new Array(dsns.length).fill(null);

  const mapDone = limit.map(dsns, (dsn, i) => {
    if (signal.aborted) {
      return Promise.resolve(null);
    }
    return resolveDsnToTarget(dsn).then((target) => {
      results[i] = target;
      return target;
    });
  });

  // Race limit.map against the abort signal so in-flight tasks
  // don't block the timeout.
  const aborted = new Promise<"timeout">((resolve) => {
    signal.addEventListener("abort", () => resolve("timeout"), { once: true });
  });
  const raceResult = await Promise.race([
    mapDone.then(() => "done" as const),
    aborted,
  ]);

  if (raceResult === "timeout") {
    log.warn(
      `DSN resolution timed out after ${DSN_RESOLVE_TIMEOUT_MS / 1000}s, returning partial results`
    );
  }

  return results;
}

/**
 * Resolve all targets for monorepo-aware commands.
 *
 * When multiple DSNs are detected, resolves all of them in parallel
 * (with concurrency limiting) and returns a footer message for display.
 *
 * Resolution priority:
 * 1. Explicit org and project - returns single target
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars - returns single target
 * 3. `.sentryclirc` config file - returns single target
 * 4. Config defaults - returns single target
 * 5. DSN auto-detection - may return multiple targets
 * 6. Directory name inference - matches project slugs with word boundaries
 *
 * @param options - Resolution options with org, project, and cwd
 * @returns All resolved targets and optional footer message
 * @throws Error if only one of org/project is provided
 */
export async function resolveAllTargets(
  options: ResolveOptions
): Promise<ResolvedTargets> {
  return await withTracingSpan(
    "resolveAllTargets",
    "resolve",
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Priority-based resolution cascade requires sequential checks.
    async (span) => {
      const { org, project, cwd } = options;

      // 1. CLI flags take priority (both must be provided together)
      if (org && project) {
        span.setAttribute("resolve.method", "flags");
        setOrgProjectContext([org], [project]);
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

      log.debug("No explicit org/project flags provided, trying env vars");

      // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
      const envVars = resolveFromEnvVars();
      if (envVars?.project) {
        span.setAttribute("resolve.method", "env_vars");
        setOrgProjectContext([envVars.org], [envVars.project]);
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

      log.debug(
        `No SENTRY_ORG/SENTRY_PROJECT env vars, trying ${CONFIG_FILENAME} config file`
      );

      // 3. .sentryclirc config file (walked up from cwd, merged with global)
      const rcConfig = await loadSentryCliRc(cwd);
      if (rcConfig.org && rcConfig.project) {
        span.setAttribute("resolve.method", "sentryclirc");
        setOrgProjectContext([rcConfig.org], [rcConfig.project]);
        return {
          targets: [
            {
              org: rcConfig.org,
              project: rcConfig.project,
              orgDisplay: rcConfig.org,
              projectDisplay: rcConfig.project,
              detectedFrom: `${CONFIG_FILENAME} (${rcConfig.sources.project})`,
            },
          ],
        };
      }

      log.debug(`No ${CONFIG_FILENAME} org/project, trying config defaults`);

      // 4. Config defaults
      const defaultOrg = getDefaultOrganization();
      const defaultProject = getDefaultProject();
      if (defaultOrg && defaultProject) {
        span.setAttribute("resolve.method", "defaults");
        setOrgProjectContext([defaultOrg], [defaultProject]);
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

      log.debug("No config defaults set, trying DSN auto-detection");

      // 5. DSN auto-detection (may find multiple in monorepos)
      const detection = await detectAllDsns(cwd);

      if (detection.all.length === 0) {
        log.debug(
          "No DSNs found in source code or env files, trying directory name inference"
        );
        // 6. Fallback: infer from directory name
        const result = await inferFromDirectoryName(cwd);
        if (result.targets.length === 0) {
          span.setAttribute("resolve.method", "none");
          log.debug(
            "Directory name inference found no matching projects — auto-detection failed"
          );
        } else {
          span.setAttribute("resolve.method", "inference");
          const uniqueOrgs = [...new Set(result.targets.map((t) => t.org))];
          const uniqueProjects = [
            ...new Set(result.targets.map((t) => t.project)),
          ];
          setOrgProjectContext(uniqueOrgs, uniqueProjects);
        }
        return result;
      }

      span.setAttribute("resolve.method", "dsn");
      return resolveDetectedDsns(detection);
    },
    { "resolve.mode": "multi" }
  );
}

/**
 * Deduplicate detected DSNs and resolve them with concurrency limiting.
 *
 * Groups DSNs by (orgId, projectId) or publicKey, resolves one per unique
 * combination, then deduplicates resolved targets by org+project slug.
 *
 * @param detection - DSN detection result with all found DSNs
 * @returns Resolved targets with optional footer message
 */
async function resolveDetectedDsns(
  detection: DsnDetectionResult
): Promise<ResolvedTargets> {
  // Deduplicate DSNs by (orgId, projectId) or publicKey before resolution.
  // Multiple DSNs in test fixtures or monorepos can share the same org+project
  // — resolving each unique pair once avoids redundant API calls.
  const uniqueDsnMap = new Map<string, DetectedDsn>();
  for (const dsn of detection.all) {
    const dedupeKey = dsn.orgId
      ? `${dsn.orgId}:${dsn.projectId}`
      : `key:${dsn.publicKey}`;
    if (!uniqueDsnMap.has(dedupeKey)) {
      uniqueDsnMap.set(dedupeKey, dsn);
    }
  }
  const uniqueDsns = [...uniqueDsnMap.values()];

  log.debug(
    `Resolving ${uniqueDsns.length} unique DSN targets (${detection.all.length} total detected)`
  );

  // Resolve with concurrency limit to avoid overwhelming the Sentry API.
  // Without this, large repos can fire 100+ concurrent HTTP requests,
  // triggering rate limiting (429) and retry storms.
  const resolvedTargets = await resolveDsnsWithTimeout(uniqueDsns);

  // Filter out failed resolutions and deduplicate by org+project
  // (different orgId forms can resolve to the same org slug)
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

  // Set telemetry context for all resolved targets
  const uniqueOrgs = [...new Set(targets.map((t) => t.org))];
  const uniqueProjects = [...new Set(targets.map((t) => t.project))];
  setOrgProjectContext(uniqueOrgs, uniqueProjects);

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
 * 3. `.sentryclirc` config file
 * 4. Config defaults
 * 5. DSN auto-detection
 * 6. Directory name inference - matches project slugs with word boundaries
 *
 * @param options - Resolution options with org, project, and cwd
 * @returns Resolved target, or null if resolution failed
 * @throws Error if only one of org/project is provided
 */
export async function resolveOrgAndProject(
  options: ResolveOptions
): Promise<ResolvedTarget | null> {
  return await withTracingSpan(
    "resolveOrgAndProject",
    "resolve",
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Priority-based resolution cascade requires sequential checks.
    async (span) => {
      const { org, project, cwd } = options;

      // 1. CLI flags take priority (both must be provided together)
      if (org && project) {
        span.setAttribute("resolve.method", "flags");
        return withTelemetryContext({
          org,
          project,
          orgDisplay: org,
          projectDisplay: project,
        });
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
        span.setAttribute("resolve.method", "env_vars");
        return withTelemetryContext({
          org: envVars.org,
          project: envVars.project,
          orgDisplay: envVars.org,
          projectDisplay: envVars.project,
          detectedFrom: envVars.detectedFrom,
        });
      }

      // 3. .sentryclirc config file
      const rcConfig = await loadSentryCliRc(cwd);
      if (rcConfig.org && rcConfig.project) {
        span.setAttribute("resolve.method", "sentryclirc");
        return withTelemetryContext({
          org: rcConfig.org,
          project: rcConfig.project,
          orgDisplay: rcConfig.org,
          projectDisplay: rcConfig.project,
          detectedFrom: `${CONFIG_FILENAME} (${rcConfig.sources.project})`,
        });
      }

      // 4. Config defaults
      const defaultOrg = getDefaultOrganization();
      const defaultProject = getDefaultProject();
      if (defaultOrg && defaultProject) {
        span.setAttribute("resolve.method", "defaults");
        return withTelemetryContext({
          org: defaultOrg,
          project: defaultProject,
          orgDisplay: defaultOrg,
          projectDisplay: defaultProject,
        });
      }

      // 5. DSN auto-detection
      try {
        const dsnResult = await resolveFromDsn(cwd);
        if (dsnResult) {
          span.setAttribute("resolve.method", "dsn");
          return withTelemetryContext(dsnResult);
        }
      } catch {
        // Fall through to directory inference
      }

      // 6. Fallback: infer from directory name
      const inferred = await inferFromDirectoryName(cwd);
      const [first] = inferred.targets;
      if (!first) {
        span.setAttribute("resolve.method", "none");
        return null;
      }

      span.setAttribute("resolve.method", "inference");
      // If multiple matches, note it in detectedFrom
      return withTelemetryContext({
        ...first,
        detectedFrom:
          inferred.targets.length > 1
            ? `${first.detectedFrom} (1 of ${inferred.targets.length} matches)`
            : first.detectedFrom,
      });
    },
    { "resolve.mode": "single" }
  );
}

/**
 * Resolve organization only from multiple sources.
 *
 * Resolution priority:
 * 1. Positional argument
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars
 * 3. `.sentryclirc` config file
 * 4. Config defaults
 * 5. DSN auto-detection
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
    setOrgProjectContext([org], []);
    return { org };
  }

  // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
  const envVars = resolveFromEnvVars();
  if (envVars) {
    setOrgProjectContext([envVars.org], []);
    return { org: envVars.org, detectedFrom: envVars.detectedFrom };
  }

  // 3. .sentryclirc config file (org only)
  const rcConfig = await loadSentryCliRc(cwd);
  if (rcConfig.org) {
    setOrgProjectContext([rcConfig.org], []);
    return {
      org: rcConfig.org,
      detectedFrom: `${CONFIG_FILENAME} (${rcConfig.sources.org})`,
    };
  }

  // 4. Config defaults
  const defaultOrg = getDefaultOrganization();
  if (defaultOrg) {
    setOrgProjectContext([defaultOrg], []);
    return { org: defaultOrg };
  }

  // 5. DSN auto-detection
  try {
    const result = await resolveOrgFromDsn(cwd);
    if (result) {
      // resolveOrgFromDsn may return a bare numeric org ID when the project
      // cache is cold. Normalize to a slug so API endpoints that reject
      // numeric IDs (e.g., dashboards) work correctly.
      const resolvedOrg = await normalizeNumericOrg(result.org);
      setOrgProjectContext([resolvedOrg], []);
      return { org: resolvedOrg, detectedFrom: result.detectedFrom };
    }
    return result;
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
 * @returns Resolved org, project slugs, and the full project data (avoids redundant re-fetch)
 * @throws {ContextError} If no project found
 * @throws {ValidationError} If project exists in multiple organizations
 */
export async function resolveProjectBySlug(
  projectSlug: string,
  usageHint: string,
  disambiguationExample?: string
): Promise<{ org: string; project: string; projectData: SentryProject }> {
  const { projects, orgs } = await findProjectsBySlug(projectSlug);
  if (projects.length === 0) {
    // Check if the slug matches an organization — common mistake
    const isOrg = orgs.some((o) => o.slug === projectSlug);
    if (isOrg) {
      throw new ResolutionError(
        `'${projectSlug}'`,
        "is an organization, not a project",
        usageHint.replace("<org>/<project>", `${projectSlug}/<project>`),
        [
          `List projects: sentry project list ${projectSlug}/`,
          `Specify a project: ${projectSlug}/<project>`,
        ]
      );
    }

    // Attempt fuzzy auto-recovery before throwing
    const recovered = await tryFuzzyProjectRecovery(
      projectSlug,
      orgs,
      (suggestions) =>
        new ResolutionError(
          `Project "${projectSlug}"`,
          "not found",
          usageHint,
          suggestions
        )
    );
    if (recovered) {
      const proj = await withAuthGuard(() =>
        getProject(recovered.org, recovered.project)
      );
      if (proj.ok) {
        return withTelemetryContext({
          org: recovered.org,
          project: recovered.project,
          projectData: proj.value,
        });
      }
    }

    throw new ResolutionError(
      `Project "${projectSlug}"`,
      "not found",
      usageHint,
      [
        isAllDigits(projectSlug)
          ? "No project with this ID was found — check the ID or use the project slug instead"
          : "Check that you have access to a project with this slug",
      ]
    );
  }
  if (projects.length > 1) {
    const orgList = projects.map((p) => `  ${p.orgSlug}/${p.slug}`).join("\n");
    const example = disambiguationExample
      ? `\n\nExample: ${disambiguationExample}`
      : "";
    throw new ValidationError(
      `Project "${projectSlug}" exists in multiple organizations.\n\n` +
        `Specify the organization:\n${orgList}${example}`
    );
  }
  const foundProject = projects[0] as (typeof projects)[0];

  // When a numeric project ID resolved successfully, hint about using the slug
  if (isAllDigits(projectSlug) && foundProject.slug !== projectSlug) {
    log.warn(
      `Tip: Resolved project ID ${projectSlug} to ${foundProject.orgSlug}/${foundProject.slug}. ` +
        "Use the slug form for faster lookups."
    );
  }

  // Strip orgSlug (from ProjectWithOrg) so projectData is a clean SentryProject
  // — prevents leaking the extra field into JSON output when callers spread it.
  const { orgSlug: _org, ...projectData } = foundProject;
  return withTelemetryContext({
    org: foundProject.orgSlug,
    project: foundProject.slug,
    projectData,
  });
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
 * 2. SENTRY_ORG / SENTRY_PROJECT env vars → use that org
 * 3. `.sentryclirc` config file → use org from config
 * 4. Config default org → use that org
 * 5. DSN auto-detection → extract unique orgs from detected targets
 * 6. No context found → empty list (caller must decide to show all orgs or error)
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
    setOrgProjectContext([orgFlag], []);
    return { orgs: [orgFlag] };
  }

  // 2. SENTRY_ORG / SENTRY_PROJECT environment variables
  const envVars = resolveFromEnvVars();
  if (envVars) {
    setOrgProjectContext([envVars.org], []);
    return { orgs: [envVars.org] };
  }

  // 3. .sentryclirc config file
  const rcConfig = await loadSentryCliRc(cwd);
  if (rcConfig.org) {
    setOrgProjectContext([rcConfig.org], []);
    return { orgs: [rcConfig.org] };
  }

  // 4. Config defaults
  const defaultOrg = getDefaultOrganization();
  if (defaultOrg) {
    setOrgProjectContext([defaultOrg], []);
    return { orgs: [defaultOrg] };
  }

  const targetsResult = await withAuthGuard(() => resolveAllTargets({ cwd }));
  if (targetsResult.ok) {
    const { targets, footer, skippedSelfHosted } = targetsResult.value;
    if (targets.length > 0) {
      const uniqueOrgs = [
        ...new Set(targets.map((t: ResolvedTarget) => t.org)),
      ];
      setOrgProjectContext(uniqueOrgs, []);
      return { orgs: uniqueOrgs, footer, skippedSelfHosted };
    }
    return { orgs: [], skippedSelfHosted };
  }

  return { orgs: [] };
}

/** Resolved org and project returned by `resolveOrgProjectTarget` */
export type ResolvedOrgProject = {
  /** Organization slug */
  org: string;
  /** Project slug */
  project: string;
  /** Full project data when resolved via project-search (avoids redundant re-fetch) */
  projectData?: SentryProject;
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
    case "explicit": {
      const org = await resolveEffectiveOrg(parsed.org);
      return withTelemetryContext({ org, project: parsed.project });
    }

    case "org-all":
      throw new ContextError(
        "Project",
        `sentry ${commandName} ${parsed.org}/<project>`
      );

    case "project-search": {
      const { projects, orgs } = await findProjectsBySlug(parsed.projectSlug);

      if (projects.length === 0) {
        // Check if the slug matches an organization — common mistake
        const isOrg = orgs.some((o) => o.slug === parsed.projectSlug);
        if (isOrg) {
          throw new ResolutionError(
            `'${parsed.projectSlug}'`,
            "is an organization, not a project",
            `sentry ${commandName} ${parsed.projectSlug}/<project>`,
            [`List projects: sentry project list ${parsed.projectSlug}/`]
          );
        }

        // Attempt fuzzy auto-recovery before throwing
        const recovered = await tryFuzzyProjectRecovery(
          parsed.projectSlug,
          orgs,
          (suggestions) =>
            new ResolutionError(
              `Project '${parsed.projectSlug}'`,
              "not found",
              `sentry ${commandName} <org>/${parsed.projectSlug}`,
              suggestions
            )
        );
        if (recovered) {
          return withTelemetryContext({
            org: recovered.org,
            project: recovered.project,
          });
        }

        throw new ResolutionError(
          `Project '${parsed.projectSlug}'`,
          "not found",
          `sentry ${commandName} <org>/${parsed.projectSlug}`,
          ["No project with this slug found in any accessible organization"]
        );
      }

      if (projects.length > 1) {
        const options = projects
          .map((m) => `  sentry ${commandName} ${m.orgSlug}/${m.slug}`)
          .join("\n");
        throw new ResolutionError(
          `Project '${parsed.projectSlug}'`,
          "is ambiguous",
          `sentry ${commandName} <org>/${parsed.projectSlug}`,
          [
            `Found in ${projects.length} organizations. Specify one:\n${options}`,
          ]
        );
      }

      const match = projects[0] as (typeof projects)[number];
      const { orgSlug: _org, ...matchData } = match;
      return withTelemetryContext({
        org: match.orgSlug,
        project: match.slug,
        projectData: matchData,
      });
    }

    case "auto-detect": {
      // resolveOrgAndProject already sets telemetry context
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
