/**
 * Repository API functions
 *
 * Functions for listing Sentry repositories in an organization.
 */

import { listAnOrganization_sRepositories } from "@sentry/api";

import type { SentryRepository } from "../../types/index.js";
import { getCachedRepos, setCachedRepos } from "../db/repo-cache.js";
import { logger } from "../logger.js";

import {
  API_MAX_PER_PAGE,
  getOrgSdkConfig,
  MAX_PAGINATION_PAGES,
  type PaginatedResponse,
  unwrapPaginatedResult,
  unwrapResult,
} from "./infrastructure.js";

const log = logger.withTag("api.repositories");

/**
 * List repositories in an organization.
 * Uses region-aware routing for multi-region support.
 *
 * Returns a single unpaginated page (typically 25 items). For the full
 * list, use {@link listAllRepositories} — it walks every page.
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

/**
 * List **all** repositories in an organization by walking every page.
 *
 * Used by the offline repo cache and anywhere else we need the complete
 * set (not just the first page). Stops at {@link MAX_PAGINATION_PAGES}
 * as a safety net for pathological cases.
 *
 * @param orgSlug - Organization slug
 * @returns All Sentry-registered repositories across all pages
 */
export async function listAllRepositories(
  orgSlug: string
): Promise<SentryRepository[]> {
  const all: SentryRepository[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await listRepositoriesPaginated(orgSlug, {
      cursor,
      perPage: API_MAX_PER_PAGE,
    });
    all.push(...data);
    if (!nextCursor) {
      return all;
    }
    cursor = nextCursor;
  }
  log.warn(
    `Stopped paginating repositories for '${orgSlug}' after ${MAX_PAGINATION_PAGES} pages — ` +
      "some repos may be missing from the cache."
  );
  return all;
}

/**
 * List repositories in an organization, preferring the offline cache.
 *
 * On cache hit: returns the stored list immediately (no network).
 * On cache miss (or stale): refetches the **complete** list via
 * {@link listAllRepositories} (walks all pages) and refreshes the cache.
 * Network/API failures bubble up — callers should decide how to handle
 * them (typically a hard error, since repo resolution has no other
 * source of truth).
 *
 * The cache write is wrapped in try/catch so a read-only or corrupted
 * SQLite database doesn't crash a command whose primary API fetch
 * already succeeded — following the project's established cache-write
 * resilience pattern.
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
  const fresh = await listAllRepositories(orgSlug);
  try {
    setCachedRepos(orgSlug, fresh);
  } catch (error) {
    // Non-essential: the primary API fetch already succeeded. A read-only
    // DB or transient write failure shouldn't fail the whole command.
    log.debug(
      `Could not persist repo cache for '${orgSlug}': ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return fresh;
}
