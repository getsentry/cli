/**
 * Project API functions
 *
 * CRUD operations, search, and DSN key retrieval for Sentry projects.
 */

import {
  createANewProject,
  deleteAProject,
  listAnOrganization_sProjects,
  listAProject_sClientKeys,
  retrieveAProject,
} from "@sentry/api";

import type {
  ProjectKey,
  Region,
  SentryOrganization,
  SentryProject,
} from "../../types/index.js";

import { type AuthGuardSuccess, withAuthGuard } from "../errors.js";
import { logger } from "../logger.js";
import { getApiBaseUrl } from "../sentry-client.js";
import { isAllDigits } from "../utils.js";

import {
  API_MAX_PER_PAGE,
  apiRequestToRegion,
  getOrgSdkConfig,
  MAX_PAGINATION_PAGES,
  type PaginatedResponse,
  unwrapPaginatedResult,
  unwrapResult,
} from "./infrastructure.js";
import { getUserRegions, listOrganizations } from "./organizations.js";

/**
 * List all projects in an organization.
 * Automatically paginates through all API pages to return the complete list.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug
 * @returns All projects in the organization
 */
export async function listProjects(orgSlug: string): Promise<SentryProject[]> {
  const config = await getOrgSdkConfig(orgSlug);
  const allResults: SentryProject[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const result = await listAnOrganization_sProjects({
      ...config,
      path: { organization_id_or_slug: orgSlug },
      // per_page is supported by Sentry's pagination framework at runtime
      // but not yet in the OpenAPI spec
      query: { cursor, per_page: API_MAX_PER_PAGE } as { cursor?: string },
    });

    const { data, nextCursor } = unwrapPaginatedResult<SentryProject[]>(
      result as
        | { data: SentryProject[]; error: undefined }
        | { data: undefined; error: unknown },
      "Failed to list projects"
    );
    allResults.push(...data);

    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;

    if (page === MAX_PAGINATION_PAGES - 1) {
      logger.warn(
        `Pagination limit reached (${MAX_PAGINATION_PAGES} pages, ${allResults.length} items). ` +
          "Results may be incomplete for this organization."
      );
    }
  }

  return allResults;
}

/**
 * List projects in an organization with pagination control.
 * Returns a single page of results with cursor metadata for manual pagination.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - Organization slug
 * @param options - Pagination options
 * @returns Single page of projects with cursor metadata
 */
export async function listProjectsPaginated(
  orgSlug: string,
  options: { cursor?: string; perPage?: number } = {}
): Promise<PaginatedResponse<SentryProject[]>> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sProjects({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    query: {
      cursor: options.cursor,
      per_page: options.perPage ?? API_MAX_PER_PAGE,
    } as { cursor?: string },
  });

  return unwrapPaginatedResult<SentryProject[]>(
    result as
      | { data: SentryProject[]; error: undefined }
      | { data: undefined; error: unknown },
    "Failed to list projects"
  );
}

/** Project with its organization context */
export type ProjectWithOrg = SentryProject & {
  /** Organization slug the project belongs to */
  orgSlug: string;
};

/** Request body for creating a new project */
type CreateProjectBody = {
  name: string;
  platform?: string;
  default_rules?: boolean;
};

/**
 * Create a new project in an organization under a team.
 *
 * @param orgSlug - The organization slug
 * @param teamSlug - The team slug to create the project under
 * @param body - Project creation parameters (name is required)
 * @returns The created project
 * @throws {ApiError} 409 if a project with the same slug already exists
 */
export async function createProject(
  orgSlug: string,
  teamSlug: string,
  body: CreateProjectBody
): Promise<SentryProject> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await createANewProject({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      team_id_or_slug: teamSlug,
    },
    body,
  });
  const data = unwrapResult(result, "Failed to create project");
  return data as unknown as SentryProject;
}

/**
 * Delete a project from an organization.
 *
 * Sends a DELETE request to the Sentry API. Returns 204 No Content on success.
 *
 * @param orgSlug - The organization slug
 * @param projectSlug - The project slug to delete
 * @throws {ApiError} 403 if the user lacks permission, 404 if the project doesn't exist
 */
export async function deleteProject(
  orgSlug: string,
  projectSlug: string
): Promise<void> {
  const config = await getOrgSdkConfig(orgSlug);
  const result = await deleteAProject({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      project_id_or_slug: projectSlug,
    },
  });
  unwrapResult(result, "Failed to delete project");
}

/** Result of searching for projects by slug across all organizations. */
export type ProjectSearchResult = {
  /** Matching projects with their org context */
  projects: ProjectWithOrg[];
  /** All organizations fetched during the search — reuse for fallback checks */
  orgs: SentryOrganization[];
};

/**
 * Search for projects matching a slug across all accessible organizations.
 *
 * Used for `sentry issue list <project-name>` when no org is specified.
 * Searches all orgs the user has access to and returns matches.
 *
 * Returns both the matching projects and the full org list that was fetched,
 * so callers can check whether a slug matches an organization without an
 * additional API call (useful for "did you mean org/?" fallbacks).
 *
 * @param projectSlug - Project slug to search for (exact match)
 * @returns Matching projects and the org list used during search
 */
export async function findProjectsBySlug(
  projectSlug: string
): Promise<ProjectSearchResult> {
  const orgs = await listOrganizations();
  const isNumericId = isAllDigits(projectSlug);

  // Direct lookup in parallel — one API call per org instead of paginating all projects
  const searchResults = await Promise.all(
    orgs.map((org) =>
      withAuthGuard(async () => {
        const project = await getProject(org.slug, projectSlug);
        // The API accepts project_id_or_slug, so a numeric input could
        // resolve by ID instead of slug. When the input is all digits,
        // accept the match (the user passed a numeric project ID).
        // For non-numeric inputs, verify the slug actually matches to
        // avoid false positives from coincidental ID collisions.
        // Note: Sentry enforces that project slugs must start with a letter,
        // so an all-digits input can only ever be a numeric ID, never a slug.
        if (!isNumericId && project.slug !== projectSlug) {
          return null;
        }
        return { ...project, orgSlug: org.slug };
      })
    )
  );

  return {
    projects: searchResults
      .filter((r): r is AuthGuardSuccess<ProjectWithOrg | null> => r.ok)
      .map((r) => r.value)
      .filter((v): v is ProjectWithOrg => v !== null),
    orgs,
  };
}

/**
 * Escape special regex characters in a string.
 * Uses native RegExp.escape if available (Node.js 23.6+, Bun), otherwise polyfills.
 */
const escapeRegex: (str: string) => string =
  typeof RegExp.escape === "function"
    ? RegExp.escape
    : (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Check if two strings match with word-boundary semantics (bidirectional).
 *
 * Returns true if either:
 * - `a` appears in `b` at a word boundary
 * - `b` appears in `a` at a word boundary
 *
 * @example
 * matchesWordBoundary("cli", "cli-website")  // true: "cli" in "cli-website"
 * matchesWordBoundary("sentry-docs", "docs") // true: "docs" in "sentry-docs"
 * matchesWordBoundary("cli", "eclipse")      // false: no word boundary
 *
 * @internal Exported for testing
 */
export function matchesWordBoundary(a: string, b: string): boolean {
  const aInB = new RegExp(`\\b${escapeRegex(a)}\\b`, "i");
  const bInA = new RegExp(`\\b${escapeRegex(b)}\\b`, "i");
  return aInB.test(b) || bInA.test(a);
}

/**
 * Find projects matching a pattern with bidirectional word-boundary matching.
 * Used for directory name inference when DSN detection fails.
 *
 * Uses `\b` regex word boundary, which matches:
 * - Start/end of string
 * - Between word char (`\w`) and non-word char (like "-")
 *
 * Matching is bidirectional:
 * - Directory name in project slug: dir "cli" matches project "cli-website"
 * - Project slug in directory name: project "docs" matches dir "sentry-docs"
 *
 * @param pattern - Directory name to match against project slugs
 * @returns Array of matching projects with their org context
 */
export async function findProjectsByPattern(
  pattern: string
): Promise<ProjectWithOrg[]> {
  const orgs = await listOrganizations();

  const searchResults = await Promise.all(
    orgs.map((org) =>
      withAuthGuard(async () => {
        const projects = await listProjects(org.slug);
        return projects
          .filter((p) => matchesWordBoundary(pattern, p.slug))
          .map((p) => ({ ...p, orgSlug: org.slug }));
      })
    )
  );

  return searchResults
    .filter((r): r is AuthGuardSuccess<ProjectWithOrg[]> => r.ok)
    .flatMap((r) => r.value);
}

/**
 * Find a project by DSN public key.
 *
 * Uses the /api/0/projects/ endpoint with query=dsn:<key> to search
 * across all accessible projects in all regions. This works for both
 * SaaS and self-hosted DSNs, even when the org ID is not embedded in the DSN.
 *
 * @param publicKey - The DSN public key (username portion of DSN URL)
 * @returns The matching project, or null if not found
 */
export async function findProjectByDsnKey(
  publicKey: string
): Promise<SentryProject | null> {
  const regionsResult = await withAuthGuard(() => getUserRegions());
  const regions = regionsResult.ok ? regionsResult.value : ([] as Region[]);

  if (regions.length === 0) {
    // Fall back to default region for self-hosted
    // This uses an internal query parameter not in the public API
    const { data: projects } = await apiRequestToRegion<SentryProject[]>(
      getApiBaseUrl(),
      "/projects/",
      { params: { query: `dsn:${publicKey}` } }
    );
    return projects[0] ?? null;
  }

  const results = await Promise.all(
    regions.map(async (region) => {
      try {
        const { data } = await apiRequestToRegion<SentryProject[]>(
          region.url,
          "/projects/",
          { params: { query: `dsn:${publicKey}` } }
        );
        return data;
      } catch {
        return [];
      }
    })
  );

  for (const projects of results) {
    if (projects.length > 0) {
      return projects[0] ?? null;
    }
  }

  return null;
}

/**
 * Get a specific project.
 * Uses region-aware routing for multi-region support.
 */
export async function getProject(
  orgSlug: string,
  projectSlug: string
): Promise<SentryProject> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveAProject({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      project_id_or_slug: projectSlug,
    },
  });

  const data = unwrapResult(result, "Failed to get project");
  return data as unknown as SentryProject;
}

/**
 * Get project keys (DSNs) for a project.
 * Uses region-aware routing for multi-region support.
 */
export async function getProjectKeys(
  orgSlug: string,
  projectSlug: string
): Promise<ProjectKey[]> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAProject_sClientKeys({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      project_id_or_slug: projectSlug,
    },
  });

  const data = unwrapResult(result, "Failed to get project keys");
  return data as unknown as ProjectKey[];
}

/**
 * Fetch the primary DSN for a project.
 * Returns the public DSN of the first active key, or null on any error.
 *
 * Best-effort: failures are silently swallowed so callers can treat
 * DSN display as optional (e.g., after project creation or in views).
 *
 * @param orgSlug - Organization slug
 * @param projectSlug - Project slug
 * @returns Public DSN string, or null if unavailable
 */
export async function tryGetPrimaryDsn(
  orgSlug: string,
  projectSlug: string
): Promise<string | null> {
  try {
    const keys = await getProjectKeys(orgSlug, projectSlug);
    const activeKey = keys.find((k) => k.isActive);
    return activeKey?.dsn.public ?? keys[0]?.dsn.public ?? null;
  } catch {
    return null;
  }
}
