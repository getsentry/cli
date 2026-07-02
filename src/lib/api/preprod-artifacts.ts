/**
 * Preprod artifacts (mobile build) API.
 *
 * Backs `sentry build download`: resolves a preprod build's install/download
 * URL via the preprod-artifacts `install-details` endpoint and streams the
 * binary (APK/IPA) to disk.
 *
 * The install URL is Sentry-hosted (same origin as the org's region). iOS
 * install URLs point at a `response_format=plist` manifest; rewrite it to
 * `response_format=ipa` to fetch the actual binary. The auth token is attached
 * to the download only when the URL matches the region origin — never a
 * third-party/signed storage URL — to avoid leaking the token.
 */

import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { customFetch } from "../custom-ca.js";
import { getAuthToken } from "../db/auth.js";
import { ApiError, ValidationError } from "../errors.js";
import { logger } from "../logger.js";
import { resolveOrgRegion } from "../region.js";
import { apiRequestToRegion } from "./infrastructure.js";

const log = logger.withTag("api.preprod-artifacts");

/** Downloadable mobile build formats. */
export type BuildFormat = "ipa" | "apk";

/**
 * Response from `organizations/{org}/preprodartifacts/{id}/install-details/`.
 */
export const BuildInstallDetailsSchema = z.object({
  /** Whether the build has a downloadable/installable artifact. */
  isInstallable: z.boolean(),
  /** Absolute URL to download the artifact, or `null` when unavailable. */
  installUrl: z.string().nullable(),
});

/** Install/download details for a preprod build artifact. */
export type BuildInstallDetails = z.infer<typeof BuildInstallDetailsSchema>;

/**
 * Fetch install/download details for a preprod build artifact.
 *
 * @param org - Organization slug.
 * @param buildId - Preprod artifact (build) ID.
 * @returns Whether the build is installable and its (absolute) download URL.
 * @throws {ApiError} On a non-2xx response.
 */
export async function getBuildInstallDetails(
  org: string,
  buildId: string
): Promise<BuildInstallDetails> {
  const regionUrl = await resolveOrgRegion(org);
  const endpoint = `organizations/${org}/preprodartifacts/${encodeURIComponent(
    buildId
  )}/install-details/`;
  const { data } = await apiRequestToRegion(regionUrl, endpoint, {
    schema: BuildInstallDetailsSchema,
  });
  return data;
}

/**
 * Rewrite an iOS install URL that points at a plist manifest so it fetches the
 * IPA binary directly. Non-plist URLs are returned unchanged.
 *
 * @param installUrl - The install URL from {@link getBuildInstallDetails}.
 */
export function toBinaryDownloadUrl(installUrl: string): string {
  return installUrl.replace("response_format=plist", "response_format=ipa");
}

/**
 * Infer the artifact file extension from the download URL's `response_format`.
 *
 * @param url - The (binary) download URL.
 * @throws {ValidationError} When the URL carries no recognized `response_format`.
 */
export function buildFormatFromUrl(url: string): BuildFormat {
  if (url.includes("response_format=ipa")) {
    return "ipa";
  }
  if (url.includes("response_format=apk")) {
    return "apk";
  }
  throw new ValidationError(
    "Unsupported build format in download URL",
    "installUrl"
  );
}

/**
 * Compare a URL's origin against the region base URL.
 *
 * @returns `true` only when both parse and share an origin; `false` otherwise
 *   (including parse failures, in which case the auth token is withheld).
 */
function isRegionOrigin(url: string, regionUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(regionUrl).origin;
  } catch (err) {
    log.debug(
      "Could not compare download URL origin; withholding auth token",
      err
    );
    return false;
  }
}

/**
 * Stream a build artifact to a local file.
 *
 * The auth token is attached only when `url` shares the region origin, so it is
 * never sent to a third-party/signed storage URL.
 *
 * @param regionUrl - The org's region base URL (origin gate for the token).
 * @param url - The absolute (binary) download URL.
 * @param destPath - Local path to write the artifact to.
 * @throws {ApiError} On a non-2xx response or missing body.
 */
export async function downloadBuildArtifact(
  regionUrl: string,
  url: string,
  destPath: string
): Promise<void> {
  const headers: Record<string, string> = {};
  if (isRegionOrigin(url, regionUrl)) {
    const token = getAuthToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await customFetch(url, { headers });
  if (!(response.ok && response.body)) {
    throw new ApiError(
      "Failed to download build artifact",
      response.status,
      response.statusText || "Download failed",
      url
    );
  }

  // Stream to disk so large (hundreds-of-MB) artifacts never buffer in memory.
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(destPath)
  );
}
