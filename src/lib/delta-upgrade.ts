/**
 * Delta Upgrade Module
 *
 * Discovers and applies binary delta patches for CLI self-upgrades.
 * Instead of downloading the full ~30 MB gzipped binary, downloads
 * tiny patches (50-500 KB) and applies them to the currently installed
 * binary using the TRDIFF10 format (zig-bsdiff with zstd compression).
 *
 * Supports two channels:
 * - **Stable**: patches stored as GitHub Release assets with predictable names
 * - **Nightly**: patches stored in GHCR with `:patch-<version>` tags
 *
 * Falls back to full download when:
 * - No patch is available (404)
 * - Chain of patches exceeds 60% of the full download size
 * - Chain exceeds the maximum depth (10 steps)
 * - Any error occurs during patch download or application
 */

import { chmodSync } from "node:fs";
import { applyPatch } from "./bspatch.js";
import { CLI_VERSION } from "./constants.js";
import {
  downloadLayerBlob,
  fetchManifest,
  getAnonymousToken,
  type OciManifest,
} from "./ghcr.js";
import { isNightlyVersion } from "./upgrade.js";

/**
 * Maximum number of patches to chain before falling back to full download.
 * Prevents runaway chains from consuming excessive time or bandwidth.
 */
const MAX_CHAIN_DEPTH = 10;

/**
 * Maximum ratio of total patch chain size to full download size.
 * If the sum of patches exceeds this fraction of the `.gz` download,
 * we fall back to full download since the savings are too small.
 */
const SIZE_THRESHOLD_RATIO = 0.6;

/** GitHub API base URL for releases */
const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/getsentry/cli/releases";

/** Pattern to extract hex from a GitHub asset digest like "sha256:<hex>" */
const SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]+)$/i;

/**
 * Build the platform-specific binary base name (without extension).
 *
 * Matches the naming convention used by both GitHub Releases and GHCR:
 * `sentry-<os>-<arch>` (e.g., `sentry-linux-x64`, `sentry-darwin-arm64`).
 *
 * @returns Platform binary base name
 */
export function getPlatformBinaryName(): string {
  let os: string;
  if (process.platform === "darwin") {
    os = "darwin";
  } else if (process.platform === "win32") {
    os = "windows";
  } else {
    os = "linux";
  }
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const suffix = process.platform === "win32" ? ".exe" : "";
  return `sentry-${os}-${arch}${suffix}`;
}

/** A single link in the patch chain */
type PatchLink = {
  /** Raw patch file data */
  data: Uint8Array;
  /** Byte size of the patch */
  size: number;
};

/** A resolved chain of patches from current version to target version */
export type PatchChain = {
  /** Ordered list of patches to apply (oldest first) */
  patches: PatchLink[];
  /** Total size of all patches in the chain (bytes) */
  totalSize: number;
  /** Expected SHA-256 hex digest of the final output binary */
  expectedSha256: string;
};

/**
 * Check whether delta upgrade can be attempted.
 *
 * Conditions that prevent delta upgrade:
 * - Running a dev build (CLI_VERSION = "0.0.0-dev")
 * - Cross-channel upgrade (stable→nightly or nightly→stable)
 * - Current executable path is not readable
 *
 * @param targetVersion - Version to upgrade to
 * @returns true if delta upgrade should be attempted
 */
export function canAttemptDelta(targetVersion: string): boolean {
  // Dev builds have no known base version to patch from
  if (CLI_VERSION === "0.0.0-dev") {
    return false;
  }

  // Cross-channel upgrades are rare one-off operations; skip delta
  if (isNightlyVersion(CLI_VERSION) !== isNightlyVersion(targetVersion)) {
    return false;
  }

  return true;
}

// Stable channel: GitHub Releases

/** GitHub Release asset metadata (subset of API response) */
type GitHubAsset = {
  name: string;
  size: number;
  /** SHA-256 digest in the form "sha256:<hex>" */
  digest?: string;
  browser_download_url: string;
};

/** GitHub Release metadata (subset of API response) */
type GitHubRelease = {
  tag_name: string;
  assets: GitHubAsset[];
};

/**
 * Fetch a GitHub Release by tag.
 *
 * @param tag - Git tag (e.g., "0.13.0")
 * @returns Release metadata, or null if not found
 */
async function fetchRelease(tag: string): Promise<GitHubRelease | null> {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_RELEASES_URL}/tags/${tag}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "sentry-cli",
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as GitHubRelease;
}

/**
 * Find the version that a stable release was patched from.
 *
 * Fetches the GitHub Release and looks for the previous release's tag.
 * Uses the GitHub API to find the release immediately before this one.
 *
 * @param tag - Git tag of the release to check
 * @returns Previous release tag, or null if unavailable
 */
async function findStablePreviousVersion(tag: string): Promise<string | null> {
  // List the 10 most recent releases and find our tag's position
  let response: Response;
  try {
    response = await fetch(`${GITHUB_RELEASES_URL}?per_page=10`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "sentry-cli",
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const releases = (await response.json()) as GitHubRelease[];

  // Find the release after our tag in the list (releases are newest-first)
  for (let i = 0; i < releases.length - 1; i++) {
    const current = releases[i];
    const next = releases[i + 1];
    if (current && next && current.tag_name === tag) {
      return next.tag_name;
    }
  }
  return null;
}

/**
 * Extract SHA-256 hex digest from a GitHub asset's digest field.
 *
 * GitHub provides digests as "sha256:<hex>". This strips the prefix.
 *
 * @param asset - GitHub Release asset
 * @returns Hex digest string, or null if no digest available
 */
function extractSha256(asset: GitHubAsset): string | null {
  if (!asset.digest) {
    return null;
  }
  const match = SHA256_DIGEST_PATTERN.exec(asset.digest);
  return match ? (match[1] ?? null) : null;
}

/**
 * Download a patch file from a GitHub Release asset URL.
 *
 * @param url - Browser download URL for the asset
 * @returns Patch file data, or null on failure
 */
async function downloadStablePatch(url: string): Promise<Uint8Array | null> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": "sentry-cli" } });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Extract the target binary SHA-256 from a GitHub Release.
 *
 * @param release - GitHub Release metadata
 * @param binaryName - Platform binary name (e.g., "sentry-linux-x64")
 * @returns Hex SHA-256 digest, or null if unavailable
 */
function getStableTargetSha256(
  release: GitHubRelease,
  binaryName: string
): string | null {
  const binaryAsset = release.assets.find((a) => a.name === binaryName);
  if (!binaryAsset) {
    return null;
  }
  return extractSha256(binaryAsset);
}

/** Result from fetching a single stable release's patch info */
type StablePatchStep = {
  /** Patch file data */
  patchData: Uint8Array;
  /** Version this patch applies from */
  fromVersion: string;
  /** SHA-256 of the target binary (only set on the target release) */
  targetSha256: string | null;
};

/**
 * Fetch patch data and metadata for a single stable release.
 *
 * @param version - Release tag to fetch
 * @param patchAssetName - Expected patch asset name for this platform
 * @param binaryName - Binary asset name for SHA-256 extraction
 * @param isTarget - Whether this is the target (first) release in the chain
 * @returns Step info, or null if any data is unavailable
 */
async function fetchStablePatchStep(
  version: string,
  patchAssetName: string,
  binaryName: string,
  isTarget: boolean
): Promise<StablePatchStep | null> {
  const release = await fetchRelease(version);
  if (!release) {
    return null;
  }

  const patchAsset = release.assets.find((a) => a.name === patchAssetName);
  if (!patchAsset) {
    return null;
  }

  const patchData = await downloadStablePatch(patchAsset.browser_download_url);
  if (!patchData) {
    return null;
  }

  const fromVersion = await findStablePreviousVersion(version);
  if (!fromVersion) {
    return null;
  }

  const targetSha256 = isTarget
    ? getStableTargetSha256(release, binaryName)
    : null;

  return { patchData, fromVersion, targetSha256 };
}

/**
 * Attempt to resolve a chain of stable patches from current to target version.
 *
 * Walks backwards from the target release, checking each release for a
 * patch file for the current platform. Stops when we reach the current
 * version or exhaust the chain.
 *
 * @param currentVersion - Currently installed version
 * @param targetVersion - Version to upgrade to
 * @param fullGzSize - Size of the full .gz download for threshold calculation
 * @returns Resolved patch chain, or null if unavailable
 */
async function resolveStableChain(
  currentVersion: string,
  targetVersion: string,
  fullGzSize: number
): Promise<PatchChain | null> {
  const binaryName = getPlatformBinaryName();
  const patchAssetName = `${binaryName}.patch`;

  const links: PatchLink[] = [];
  let totalSize = 0;
  let expectedSha256 = "";
  let version = targetVersion;

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    const step = await fetchStablePatchStep(
      version,
      patchAssetName,
      binaryName,
      depth === 0
    );
    if (!step) {
      return null;
    }

    if (depth === 0) {
      expectedSha256 = step.targetSha256 ?? "";
      if (!expectedSha256) {
        return null;
      }
    }

    links.unshift({ data: step.patchData, size: step.patchData.byteLength });
    totalSize += step.patchData.byteLength;

    if (totalSize > fullGzSize * SIZE_THRESHOLD_RATIO) {
      return null;
    }

    if (step.fromVersion === currentVersion) {
      return { patches: links, totalSize, expectedSha256 };
    }

    version = step.fromVersion;
  }

  return null;
}

// Nightly channel: GHCR

/**
 * Extract the `from-version` annotation from a patch manifest.
 *
 * @param manifest - OCI manifest for a `:patch-<version>` tag
 * @returns The base version this patch applies to, or null if missing
 */
function getPatchFromVersion(manifest: OciManifest): string | null {
  return manifest.annotations?.["from-version"] ?? null;
}

/**
 * Extract the SHA-256 annotation for a specific platform from a patch manifest.
 *
 * Annotations are stored as `sha256-<binaryName>=<hex>`.
 *
 * @param manifest - OCI manifest for a `:patch-<version>` tag
 * @param binaryName - Platform binary name (e.g., "sentry-linux-x64")
 * @returns Hex digest string, or null if not found
 */
function getPatchTargetSha256(
  manifest: OciManifest,
  binaryName: string
): string | null {
  return manifest.annotations?.[`sha256-${binaryName}`] ?? null;
}

/** GHCR tag prefix for patch manifests */
const PATCH_TAG_PREFIX = "patch-";

/** Result from fetching a single nightly patch manifest */
type NightlyPatchStep = {
  /** Patch file data */
  patchData: Uint8Array;
  /** Version this patch applies from */
  fromVersion: string;
  /** SHA-256 of the target binary (only if requested) */
  targetSha256: string | null;
};

/** Options for fetching a single nightly patch step */
type NightlyPatchOpts = {
  token: string;
  version: string;
  patchLayerName: string;
  binaryName: string;
};

/**
 * Fetch patch data and metadata for a single nightly version from GHCR.
 *
 * @param opts - Fetch parameters
 * @param isTarget - Whether to extract target SHA-256
 * @returns Step info, or null if unavailable
 */
async function fetchNightlyPatchStep(
  opts: NightlyPatchOpts,
  isTarget: boolean
): Promise<NightlyPatchStep | null> {
  let manifest: OciManifest;
  try {
    manifest = await fetchManifest(
      opts.token,
      `${PATCH_TAG_PREFIX}${opts.version}`
    );
  } catch {
    return null;
  }

  const fromVersion = getPatchFromVersion(manifest);
  if (!fromVersion) {
    return null;
  }

  const patchLayer = manifest.layers.find((l) => {
    const title = l.annotations?.["org.opencontainers.image.title"];
    return title === opts.patchLayerName;
  });
  if (!patchLayer) {
    return null;
  }

  const patchBuffer = await downloadLayerBlob(opts.token, patchLayer.digest);
  const patchData = new Uint8Array(patchBuffer);
  const targetSha256 = isTarget
    ? getPatchTargetSha256(manifest, opts.binaryName)
    : null;

  return { patchData, fromVersion, targetSha256 };
}

/**
 * Attempt to resolve a chain of nightly patches from current to target version.
 *
 * Uses GHCR `:patch-<version>` tags with `from-version` annotations to
 * walk backwards from the target version to the current version.
 *
 * @param token - GHCR anonymous bearer token
 * @param currentVersion - Currently installed nightly version
 * @param targetVersion - Target nightly version
 * @param fullGzSize - Size of the full .gz layer for threshold calculation
 * @returns Resolved patch chain, or null if unavailable
 */
async function resolveNightlyChain(
  token: string,
  currentVersion: string,
  targetVersion: string,
  fullGzSize: number
): Promise<PatchChain | null> {
  const binaryName = getPlatformBinaryName();
  const patchLayerName = `${binaryName}.patch`;
  const opts: NightlyPatchOpts = {
    token,
    version: targetVersion,
    patchLayerName,
    binaryName,
  };

  const links: PatchLink[] = [];
  let totalSize = 0;
  let expectedSha256 = "";

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    const step = await fetchNightlyPatchStep(opts, depth === 0);
    if (!step) {
      return null;
    }

    if (depth === 0) {
      expectedSha256 = step.targetSha256 ?? "";
      if (!expectedSha256) {
        return null;
      }
    }

    links.unshift({ data: step.patchData, size: step.patchData.byteLength });
    totalSize += step.patchData.byteLength;

    if (totalSize > fullGzSize * SIZE_THRESHOLD_RATIO) {
      return null;
    }

    if (step.fromVersion === currentVersion) {
      return { patches: links, totalSize, expectedSha256 };
    }

    opts.version = step.fromVersion;
  }

  return null;
}

/**
 * Attempt to download and apply delta patches instead of a full binary.
 *
 * This is the main entry point called by `downloadBinaryToTemp()` in
 * upgrade.ts. It discovers available patches, resolves a chain, downloads
 * the patches, applies them sequentially, and verifies the result.
 *
 * @param targetVersion - Version to upgrade to
 * @param oldBinaryPath - Path to the currently running binary (used as patch base)
 * @param destPath - Path to write the patched binary
 * @returns SHA-256 hex of the output, or null if delta is unavailable
 */
export async function attemptDeltaUpgrade(
  targetVersion: string,
  oldBinaryPath: string,
  destPath: string
): Promise<string | null> {
  if (!canAttemptDelta(targetVersion)) {
    return null;
  }

  try {
    if (isNightlyVersion(targetVersion)) {
      return await resolveNightlyDelta(targetVersion, oldBinaryPath, destPath);
    }
    return await resolveStableDelta(targetVersion, oldBinaryPath, destPath);
  } catch {
    // Any error during delta upgrade → fall back to full download
    return null;
  }
}

/**
 * Resolve and apply stable delta patches.
 *
 * @returns SHA-256 hex of the output, or null if delta is unavailable
 */
async function resolveStableDelta(
  targetVersion: string,
  oldBinaryPath: string,
  destPath: string
): Promise<string | null> {
  // Fetch the target release to get the .gz size for threshold
  const release = await fetchRelease(targetVersion);
  if (!release) {
    return null;
  }

  const binaryName = getPlatformBinaryName();
  const gzAsset = release.assets.find((a) => a.name === `${binaryName}.gz`);
  if (!gzAsset) {
    return null;
  }

  const chain = await resolveStableChain(
    CLI_VERSION,
    targetVersion,
    gzAsset.size
  );
  if (!chain) {
    return null;
  }

  return applyPatchChain(chain, oldBinaryPath, destPath);
}

/**
 * Resolve and apply nightly delta patches.
 *
 * @returns SHA-256 hex of the output, or null if delta is unavailable
 */
async function resolveNightlyDelta(
  targetVersion: string,
  oldBinaryPath: string,
  destPath: string
): Promise<string | null> {
  const token = await getAnonymousToken();

  // Get the .gz layer size from the nightly manifest for threshold
  const binaryName = getPlatformBinaryName();
  const nightlyManifest = await fetchManifest(token, "nightly");
  const gzLayer = nightlyManifest.layers.find((l) => {
    const title = l.annotations?.["org.opencontainers.image.title"];
    return title === `${binaryName}.gz`;
  });
  if (!gzLayer) {
    return null;
  }

  const chain = await resolveNightlyChain(
    token,
    CLI_VERSION,
    targetVersion,
    gzLayer.size
  );
  if (!chain) {
    return null;
  }

  return applyPatchChain(chain, oldBinaryPath, destPath);
}

/**
 * Apply a resolved patch chain sequentially and verify the result.
 *
 * For single-patch chains, applies directly from old binary to dest.
 * For multi-patch chains, uses an intermediate temp file: each step
 * produces a new file that becomes the input for the next step.
 *
 * @param chain - Resolved patch chain with patches and expected hash
 * @param oldBinaryPath - Path to the original binary
 * @param destPath - Final output path
 * @returns SHA-256 hex of the final output
 * @throws {Error} When SHA-256 verification fails
 */
async function applyPatchChain(
  chain: PatchChain,
  oldBinaryPath: string,
  destPath: string
): Promise<string> {
  let currentOldPath = oldBinaryPath;
  let sha256 = "";

  // For multi-step chains, intermediate results go to destPath with a step suffix
  const intermediatePath = `${destPath}.patching`;

  for (let i = 0; i < chain.patches.length; i++) {
    const patch = chain.patches[i];
    if (!patch) {
      throw new Error(`Missing patch at index ${i}`);
    }
    const isLast = i === chain.patches.length - 1;
    const outputPath = isLast ? destPath : intermediatePath;

    sha256 = await applyPatch(currentOldPath, patch.data, outputPath);

    // For multi-step: the output of this step becomes the input for the next
    if (!isLast) {
      currentOldPath = intermediatePath;
    }
  }

  // Clean up intermediate file if it exists
  if (chain.patches.length > 1) {
    try {
      const { unlinkSync: unlink } = await import("node:fs");
      unlink(intermediatePath);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Verify the final SHA-256 matches
  if (sha256 !== chain.expectedSha256) {
    throw new Error(
      `SHA-256 mismatch after patching: got ${sha256}, expected ${chain.expectedSha256}`
    );
  }

  // Set executable permission (Unix only)
  if (process.platform !== "win32") {
    chmodSync(destPath, 0o755);
  }

  return sha256;
}
