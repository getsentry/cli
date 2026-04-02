/**
 * Release API functions
 *
 * Functions for listing, creating, updating, deleting, and deploying
 * Sentry releases in an organization.
 */

import type { DeployResponse, OrgReleaseResponse } from "@sentry/api";
import {
  createADeploy,
  createANewReleaseForAnOrganization,
  deleteAnOrganization_sRelease,
  listAnOrganization_sReleases,
  listARelease_sDeploys,
  retrieveAnOrganization_sRelease,
  updateAnOrganization_sRelease,
} from "@sentry/api";

import { ApiError } from "../errors.js";
import { getHeadCommit, getRepositoryName } from "../git.js";
import { resolveOrgRegion } from "../region.js";
import {
  apiRequestToRegion,
  getOrgSdkConfig,
  type PaginatedResponse,
  unwrapPaginatedResult,
  unwrapResult,
} from "./infrastructure.js";
import { listRepositories } from "./repositories.js";

// We cast through `unknown` to bridge the gap between the SDK's internal
// return types and the public response types — the shapes are compatible
// at runtime.

/**
 * List releases in an organization with pagination control.
 * Returns a single page of results with cursor metadata.
 *
 * @param orgSlug - Organization slug
 * @param options - Pagination, query, and sort options
 * @returns Single page of releases with cursor metadata
 */
export async function listReleasesPaginated(
  orgSlug: string,
  options: {
    cursor?: string;
    perPage?: number;
    query?: string;
    sort?: string;
  } = {}
): Promise<PaginatedResponse<OrgReleaseResponse[]>> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listAnOrganization_sReleases({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    // per_page and sort are supported at runtime but not in the OpenAPI spec
    query: {
      cursor: options.cursor,
      per_page: options.perPage ?? 25,
      query: options.query,
      sort: options.sort,
    } as { cursor?: string },
  });

  return unwrapPaginatedResult<OrgReleaseResponse[]>(
    result as
      | { data: OrgReleaseResponse[]; error: undefined }
      | { data: undefined; error: unknown },
    "Failed to list releases"
  );
}

/**
 * Get a single release by version.
 * Version is URL-encoded by the SDK.
 *
 * @param orgSlug - Organization slug
 * @param version - Release version string (e.g., "1.0.0", "sentry-cli@0.24.0")
 * @returns Full release detail
 */
export async function getRelease(
  orgSlug: string,
  version: string
): Promise<OrgReleaseResponse> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveAnOrganization_sRelease({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      version,
    },
  });

  const data = unwrapResult(result, `Failed to get release '${version}'`);
  return data as unknown as OrgReleaseResponse;
}

/**
 * Create a new release.
 *
 * @param orgSlug - Organization slug
 * @param body - Release creation payload
 * @returns Created release detail
 */
export async function createRelease(
  orgSlug: string,
  body: {
    version: string;
    projects?: string[];
    ref?: string;
    url?: string;
    dateReleased?: string;
    commits?: Array<{
      id: string;
      repository?: string;
      message?: string;
      author_name?: string;
      author_email?: string;
      timestamp?: string;
    }>;
  }
): Promise<OrgReleaseResponse> {
  const config = await getOrgSdkConfig(orgSlug);

  // Cast body through unknown — the SDK's body type requires `projects: string[]`
  // as non-optional, but the API accepts it as optional at runtime.
  const result = await createANewReleaseForAnOrganization({
    ...config,
    path: { organization_id_or_slug: orgSlug },
    body: body as unknown as Parameters<
      typeof createANewReleaseForAnOrganization
    >[0]["body"],
  });

  // 208 = release already exists (idempotent) — treat as success
  if (result.data) {
    return result.data as unknown as OrgReleaseResponse;
  }
  const data = unwrapResult(result, "Failed to create release");
  return data as unknown as OrgReleaseResponse;
}

/**
 * Update a release. Used for finalization, setting refs, etc.
 *
 * @param orgSlug - Organization slug
 * @param version - Release version (URL-encoded by SDK)
 * @param body - Fields to update
 * @returns Updated release detail
 */
export async function updateRelease(
  orgSlug: string,
  version: string,
  body: {
    ref?: string;
    url?: string;
    dateReleased?: string;
    commits?: Array<{
      id: string;
      repository?: string;
      message?: string;
      author_name?: string;
      author_email?: string;
      timestamp?: string;
    }>;
  }
): Promise<OrgReleaseResponse> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await updateAnOrganization_sRelease({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      version,
    },
    body: body as unknown as Parameters<
      typeof updateAnOrganization_sRelease
    >[0]["body"],
  });

  const data = unwrapResult(result, `Failed to update release '${version}'`);
  return data as unknown as OrgReleaseResponse;
}

/**
 * Delete a release.
 *
 * @param orgSlug - Organization slug
 * @param version - Release version
 */
export async function deleteRelease(
  orgSlug: string,
  version: string
): Promise<void> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await deleteAnOrganization_sRelease({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      version,
    },
  });

  unwrapResult(result, `Failed to delete release '${version}'`);
}

/**
 * List deploys for a release.
 *
 * @param orgSlug - Organization slug
 * @param version - Release version
 * @returns Array of deploy details
 */
export async function listReleaseDeploys(
  orgSlug: string,
  version: string
): Promise<DeployResponse[]> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await listARelease_sDeploys({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      version,
    },
  });

  const data = unwrapResult(
    result,
    `Failed to list deploys for release '${version}'`
  );
  return data as unknown as DeployResponse[];
}

/**
 * Create a deploy for a release.
 *
 * @param orgSlug - Organization slug
 * @param version - Release version
 * @param body - Deploy creation payload
 * @returns Created deploy detail
 */
export async function createReleaseDeploy(
  orgSlug: string,
  version: string,
  body: {
    environment: string;
    name?: string;
    url?: string;
    dateStarted?: string;
    dateFinished?: string;
  }
): Promise<DeployResponse> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await createADeploy({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      version,
    },
    body: body as unknown as Parameters<typeof createADeploy>[0]["body"],
  });

  const data = unwrapResult(result, "Failed to create deploy");
  return data as unknown as DeployResponse;
}

/**
 * Set commits on a release using auto-discovery mode.
 *
 * Lists the org's repositories from the Sentry API, matches against the
 * local git remote URL to find the corresponding Sentry repo, then sends
 * a refs payload with the HEAD commit SHA. This is the equivalent of the
 * reference sentry-cli's `--auto` mode.
 *
 * Requires a GitHub/GitLab/Bitbucket integration configured in Sentry
 * AND a local git repository whose origin remote matches a Sentry repo.
 *
 * @param orgSlug - Organization slug
 * @param version - Release version
 * @param cwd - Working directory to discover git remote and HEAD from
 * @returns Updated release detail with commit count
 * @throws {ApiError} When the org has no repository integrations (400)
 */
export async function setCommitsAuto(
  orgSlug: string,
  version: string,
  cwd?: string
): Promise<OrgReleaseResponse> {
  const repos = await listRepositories(orgSlug);
  if (repos.length === 0) {
    throw new ApiError(
      "No repository integrations configured for this organization.",
      400,
      `organizations/${orgSlug}/releases/${encodeURIComponent(version)}/`
    );
  }

  const localRepo = getRepositoryName(cwd);
  if (!localRepo) {
    throw new ApiError(
      "Could not determine repository name from local git remote.",
      400,
      `organizations/${orgSlug}/releases/${encodeURIComponent(version)}/`
    );
  }

  // Match local remote (e.g., "getsentry/cli") against Sentry repo names
  const matchedRepo = repos.find(
    (r) => r.name.toLowerCase() === localRepo.toLowerCase()
  );
  if (!matchedRepo) {
    throw new ApiError(
      `No Sentry repository matching '${localRepo}'. ` +
        `Available: ${repos.map((r) => r.name).join(", ")}`,
      400,
      `organizations/${orgSlug}/releases/${encodeURIComponent(version)}/`
    );
  }

  const headCommit = getHeadCommit(cwd);
  return setCommitsWithRefs(orgSlug, version, [
    { repository: matchedRepo.name, commit: headCommit },
  ]);
}

/**
 * Set commits on a release using explicit refs (repository + commit range).
 *
 * Sends the refs format which supports previous commit for range-based
 * commit association (matching the reference sentry-cli's `--commit REPO@PREV..SHA`).
 *
 * @param orgSlug - Organization slug
 * @param version - Release version
 * @param refs - Array of ref objects
 * @returns Updated release detail
 */
export async function setCommitsWithRefs(
  orgSlug: string,
  version: string,
  refs: Array<{
    repository: string;
    commit: string;
    previousCommit?: string;
  }>
): Promise<OrgReleaseResponse> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const encodedVersion = encodeURIComponent(version);
  const { data } = await apiRequestToRegion<OrgReleaseResponse>(
    regionUrl,
    `organizations/${orgSlug}/releases/${encodedVersion}/`,
    {
      method: "PUT",
      body: { refs },
    }
  );
  return data;
}

/**
 * Set commits on a release using explicit commit data.
 *
 * @param orgSlug - Organization slug
 * @param version - Release version
 * @param commits - Array of commit data
 * @returns Updated release detail
 */
export function setCommitsLocal(
  orgSlug: string,
  version: string,
  commits: Array<{
    id: string;
    repository?: string;
    message?: string;
    author_name?: string;
    author_email?: string;
    timestamp?: string;
  }>
): Promise<OrgReleaseResponse> {
  return updateRelease(orgSlug, version, { commits });
}
