/**
 * Repository API functions
 *
 * Functions for listing Sentry repositories in an organization.
 */

import { listAnOrganization_sRepositories } from "@sentry/api";

import type { SentryRepository } from "../../types/index.js";
import { getCachedRepos, setCachedRepos } from "../db/repo-cache.js";

import {
  getOrgSdkConfig,
  type PaginatedResponse,
  unwrapPaginatedResult,
  unwrapResult,
} from "./infrastructure.js";

/**
 * List repositories in an organization.
 * Uses region-aware routing for multi-region support.
 */
export async function listRepositories(
  orgSlug: string
): Promise<SentryRepository[]> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sRepositories({
    ...config,
    path: { organization_id_or_slug: orgSlug },
  });

  const data = unwrapResult(result, "Failed to list repositories");
  return data as unknown as SentryRepository[];
}

/**
 * List repositories in an organization with pagination control.
 * Returns a single page of results with cursor metadata.
 *
 * @param orgSlug - Organization slug
 * @param options - Pagination options
 * @returns Single page of repositories with cursor metadata
 */
/**
 * List repositories in an organization, preferring the offline cache.
 *
 * On cache hit: returns the stored list immediately (no network).
 * On cache miss (or stale): refetches via {@link listRepositories} and
 * refreshes the cache. Failures bubble up — callers should decide how
 * to handle an API error (typically a hard error, since repo resolution
 * has no other source of truth).
 *
 * @param orgSlug - Organization slug
 * @returns All Sentry-registered repositories for the org
 */
export async function listRepositoriesCached(
  orgSlug: string
): Promise<SentryRepository[]> {
  const cached = getCachedRepos(orgSlug);
  if (cached) {
    return cached;
  }
  const fresh = await listRepositories(orgSlug);
  setCachedRepos(orgSlug, fresh);
  return fresh;
}

export async function listRepositoriesPaginated(
  orgSlug: string,
  options: { cursor?: string; perPage?: number } = {}
): Promise<PaginatedResponse<SentryRepository[]>> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sRepositories({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    // per_page is supported by Sentry's pagination framework at runtime
    // but not yet in the OpenAPI spec
    query: {
      cursor: options.cursor,
      per_page: options.perPage ?? 25,
    } as { cursor?: string },
  });

  return unwrapPaginatedResult<SentryRepository[]>(
    result as
      | { data: SentryRepository[]; error: undefined }
      | { data: undefined; error: unknown },
    "Failed to list repositories"
  );
}
