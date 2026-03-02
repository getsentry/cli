/**
 * GHCR (GitHub Container Registry) Client
 *
 * Encapsulates the OCI download protocol for fetching nightly CLI binaries
 * from ghcr.io/getsentry/cli. Nightly builds are pushed as OCI artifacts
 * via ORAS with the version baked into the manifest annotation.
 *
 * Key design decisions:
 * - Anonymous access: nightly package is public; no token needed beyond the
 *   standard ghcr.io anonymous token exchange.
 * - Version discovery from manifest annotation: `annotations.version` in the
 *   OCI manifest holds the nightly version. Checking the latest version only
 *   requires a token exchange + manifest fetch (2 HTTP requests total).
 * - Redirect quirk: ghcr.io blob downloads return 307 to Azure Blob Storage.
 *   Using `fetch` with `redirect: "follow"` would forward the Authorization
 *   header to Azure, which returns 404. Must follow the redirect manually
 *   without the auth header.
 */

import { getUserAgent } from "./constants.js";
import { UpgradeError } from "./errors.js";

/** GHCR repository for CLI distribution */
export const GHCR_REPO = "getsentry/cli";

/** OCI tag for nightly builds */
export const GHCR_TAG = "nightly";

/** Base URL for GHCR registry API */
const GHCR_REGISTRY = "https://ghcr.io";

/** OCI manifest media type */
const OCI_MANIFEST_TYPE = "application/vnd.oci.image.manifest.v1+json";

/**
 * A single layer entry from an OCI manifest.
 *
 * Each binary in the nightly push is stored as a separate layer.
 * The `annotations` map includes `org.opencontainers.image.title` (filename)
 * and `org.opencontainers.image.created` (push time).
 */
export type OciLayer = {
  /** Content-addressable digest for the blob (e.g., "sha256:abc123...") */
  digest: string;
  /** MIME type of the layer content */
  mediaType: string;
  /** Size in bytes */
  size: number;
  /** Per-layer OCI annotations */
  annotations?: Record<string, string>;
};

/**
 * OCI image manifest returned by the registry.
 *
 * The `annotations` map at the manifest level holds metadata about the
 * nightly push, including the `version` string baked in during `oras push`.
 */
export type OciManifest = {
  /** OCI manifest schema version (always 2) */
  schemaVersion: number;
  /** Manifest media type */
  mediaType?: string;
  /** Config layer (empty for ORAS artifacts) */
  config?: OciLayer;
  /** Content layers — one per binary/file pushed */
  layers: OciLayer[];
  /** Manifest-level annotations, including `version` */
  annotations?: Record<string, string>;
};

/**
 * Fetch a short-lived anonymous bearer token for read-only access to the
 * public `ghcr.io/getsentry/cli` package.
 *
 * The token exchange endpoint returns a JSON object with a `token` field.
 * No credentials are required for public packages.
 *
 * @returns Bearer token string
 * @throws {UpgradeError} On network failure or malformed response
 */
export async function getAnonymousToken(): Promise<string> {
  const url = `${GHCR_REGISTRY}/token?scope=repository:${GHCR_REPO}:pull`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": getUserAgent() },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new UpgradeError(
      "network_error",
      `Failed to connect to GHCR: ${msg}`
    );
  }

  if (!response.ok) {
    throw new UpgradeError(
      "network_error",
      `GHCR token exchange failed: HTTP ${response.status}`
    );
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    throw new UpgradeError(
      "network_error",
      "GHCR token exchange returned no token"
    );
  }

  return data.token;
}

/**
 * Fetch the OCI manifest for the `:nightly` tag.
 *
 * @param token - Anonymous bearer token from {@link getAnonymousToken}
 * @returns Parsed OCI manifest
 * @throws {UpgradeError} On network failure or non-200 response
 */
export async function fetchNightlyManifest(
  token: string
): Promise<OciManifest> {
  const url = `${GHCR_REGISTRY}/v2/${GHCR_REPO}/manifests/${GHCR_TAG}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: OCI_MANIFEST_TYPE,
        "User-Agent": getUserAgent(),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new UpgradeError(
      "network_error",
      `Failed to connect to GHCR: ${msg}`
    );
  }

  if (!response.ok) {
    throw new UpgradeError(
      "network_error",
      `Failed to fetch nightly manifest: HTTP ${response.status}`
    );
  }

  return (await response.json()) as OciManifest;
}

/**
 * Extract the nightly version string from a manifest's annotations.
 *
 * The version is set via `--annotation "version=<ver>"` during `oras push`.
 *
 * @param manifest - OCI manifest from {@link fetchNightlyManifest}
 * @returns Version string (e.g., "0.13.0-dev.1740000000")
 * @throws {UpgradeError} When the version annotation is missing
 */
export function getNightlyVersion(manifest: OciManifest): string {
  const version = manifest.annotations?.version;
  if (!version) {
    throw new UpgradeError(
      "network_error",
      "Nightly manifest has no version annotation"
    );
  }
  return version;
}

/**
 * Find the layer matching a given filename in an OCI manifest.
 *
 * ORAS sets `org.opencontainers.image.title` to the filename for each pushed
 * file. This function searches layers for the matching title annotation.
 *
 * @param manifest - OCI manifest containing layers
 * @param filename - Filename to find (e.g., "sentry-linux-x64.gz")
 * @returns Matching layer
 * @throws {UpgradeError} When no layer matches the filename
 */
export function findLayerByFilename(
  manifest: OciManifest,
  filename: string
): OciLayer {
  const layer = manifest.layers.find(
    (l) => l.annotations?.["org.opencontainers.image.title"] === filename
  );
  if (!layer) {
    throw new UpgradeError(
      "version_not_found",
      `No nightly build found for ${filename}`
    );
  }
  return layer;
}

/**
 * Download a nightly binary blob from GHCR and write it to disk.
 *
 * The blob endpoint returns a 307 redirect to a signed Azure Blob Storage URL.
 * `fetch` with `redirect: "follow"` would forward the Authorization header
 * to Azure, which returns 404. We must:
 * 1. Fetch the blob URL without following redirects to get the redirect URL.
 * 2. Follow the redirect URL without the Authorization header.
 *
 * @param token - Anonymous bearer token from {@link getAnonymousToken}
 * @param digest - Layer digest to download (e.g., "sha256:abc123...")
 * @returns Raw response body (gzip-compressed binary)
 * @throws {UpgradeError} On network failure or bad response
 */
export async function downloadNightlyBlob(
  token: string,
  digest: string
): Promise<Response> {
  const blobUrl = `${GHCR_REGISTRY}/v2/${GHCR_REPO}/blobs/${digest}`;

  // Step 1: GET blob URL with auth, but do NOT follow redirects.
  // ghcr.io returns 307 → Azure Blob Storage signed URL.
  let blobResponse: Response;
  try {
    blobResponse = await fetch(blobUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": getUserAgent(),
      },
      redirect: "manual",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new UpgradeError(
      "network_error",
      `Failed to connect to GHCR: ${msg}`
    );
  }

  // ghcr.io may serve the blob directly (200) or redirect (301/302/307/308)
  if (blobResponse.status === 200) {
    return blobResponse;
  }

  if (
    blobResponse.status === 301 ||
    blobResponse.status === 302 ||
    blobResponse.status === 307 ||
    blobResponse.status === 308
  ) {
    const redirectUrl = blobResponse.headers.get("location");
    if (!redirectUrl) {
      throw new UpgradeError(
        "network_error",
        `GHCR blob redirect (${blobResponse.status}) had no Location header`
      );
    }

    // Step 2: Follow the redirect WITHOUT the Authorization header.
    // Azure rejects requests that include a Bearer token alongside its own
    // signed query-string credentials (returns 404).
    let redirectResponse: Response;
    try {
      redirectResponse = await fetch(redirectUrl, {
        headers: { "User-Agent": getUserAgent() },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new UpgradeError(
        "network_error",
        `Failed to download from blob storage: ${msg}`
      );
    }

    if (!redirectResponse.ok) {
      throw new UpgradeError(
        "network_error",
        `Blob storage download failed: HTTP ${redirectResponse.status}`
      );
    }

    return redirectResponse;
  }

  throw new UpgradeError(
    "network_error",
    `Unexpected GHCR blob response: HTTP ${blobResponse.status}`
  );
}
