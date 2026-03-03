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

/** Metadata discovered for a single stable release (before downloading patch data) */
type StableChainLink = {
  /** Download URL for the patch asset */
  patchUrl: string;
  /** Reported size of the patch asset (bytes) */
  patchSize: number;
  /** Version this patch applies from */
  fromVersion: string;
  /** SHA-256 of the target binary (only set on the first/target release) */
  targetSha256: string | null;
};

/**
 * Discover metadata for a single stable release in the chain.
 *
 * Fetches the release JSON and previous-version info without downloading
 * the actual patch data. This keeps the serial discovery phase lightweight.
 *
 * @param version - Release tag to fetch
 * @param patchAssetName - Expected patch asset name for this platform
 * @param binaryName - Binary asset name for SHA-256 extraction
 * @param isTarget - Whether this is the target (first) release in the chain
 * @returns Chain link metadata, or null if any data is unavailable
 */
async function discoverStableLink(
  version: string,
  patchAssetName: string,
  binaryName: string,
  isTarget: boolean
): Promise<StableChainLink | null> {
  const release = await fetchRelease(version);
  if (!release) {
    return null;
  }

  const patchAsset = release.assets.find((a) => a.name === patchAssetName);
  if (!patchAsset) {
    return null;
  }

  const fromVersion = await findStablePreviousVersion(version);
  if (!fromVersion) {
    return null;
  }

  const targetSha256 = isTarget
    ? getStableTargetSha256(release, binaryName)
    : null;

  return {
    patchUrl: patchAsset.browser_download_url,
    patchSize: patchAsset.size,
    fromVersion,
    targetSha256,
  };
}

/** Result from the serial discovery phase of stable chain resolution */
type StableDiscoveryResult = {
  /** Ordered links (oldest first) forming the chain */
  links: StableChainLink[];
  /** Expected SHA-256 of the final target binary */
  expectedSha256: string;
};

/** Options for stable chain discovery */
type StableDiscoveryOpts = {
  currentVersion: string;
  targetVersion: string;
  fullGzSize: number;
  patchAssetName: string;
  binaryName: string;
};

/**
 * Discover the full chain of stable patches by walking release metadata.
 *
 * Serial phase: fetches only lightweight release JSON + previous-version
 * info, no patch data. Validates the size threshold against reported asset
 * sizes as it walks.
 *
 * @returns Discovery result, or null if the chain is broken/exceeds threshold
 */
async function discoverStableChain(
  opts: StableDiscoveryOpts
): Promise<StableDiscoveryResult | null> {
  const {
    currentVersion,
    targetVersion,
    fullGzSize,
    patchAssetName,
    binaryName,
  } = opts;
  const links: StableChainLink[] = [];
  let totalSize = 0;
  let expectedSha256 = "";
  let version = targetVersion;

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    const link = await discoverStableLink(
      version,
      patchAssetName,
      binaryName,
      depth === 0
    );
    if (!link) {
      return null;
    }

    if (depth === 0) {
      expectedSha256 = link.targetSha256 ?? "";
      if (!expectedSha256) {
        return null;
      }
    }

    links.unshift(link);
    totalSize += link.patchSize;

    if (totalSize > fullGzSize * SIZE_THRESHOLD_RATIO) {
      return null;
    }

    if (link.fromVersion === currentVersion) {
      return { links, expectedSha256 };
    }

    version = link.fromVersion;
  }

  return null;
}

/**
 * Attempt to resolve a chain of stable patches from current to target version.
 *
 * Phase 1 (serial): Walk backwards from the target release, fetching only
 * lightweight metadata (release JSON + previous-version) to discover the
 * full chain and check the size threshold.
 *
 * Phase 2 (parallel): Download all patch files concurrently.
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

  const discovered = await discoverStableChain({
    currentVersion,
    targetVersion,
    fullGzSize,
    patchAssetName,
    binaryName,
  });
  if (!discovered) {
    return null;
  }

  // Phase 2: Parallel patch download
  const downloadResults = await Promise.all(
    discovered.links.map((link) => downloadStablePatch(link.patchUrl))
  );

  const patches: PatchLink[] = [];
  let totalSize = 0;
  for (const data of downloadResults) {
    if (!data) {
      return null;
    }
    patches.push({ data, size: data.byteLength });
    totalSize += data.byteLength;
  }

  return { patches, totalSize, expectedSha256: discovered.expectedSha256 };
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

/** Metadata discovered for a single nightly patch manifest (before downloading blob) */
type NightlyChainLink = {
  /** Layer digest for downloading the patch blob */
  patchDigest: string;
  /** Reported size of the patch layer (bytes) */
  patchSize: number;
  /** Version this patch applies from */
  fromVersion: string;
  /** SHA-256 of the target binary (only set on the first/target link) */
  targetSha256: string | null;
};

/** Options for nightly chain discovery */
type NightlyDiscoveryOpts = {
  token: string;
  patchLayerName: string;
  binaryName: string;
};

/**
 * Discover metadata for a single nightly patch manifest.
 *
 * Fetches the GHCR `:patch-<version>` manifest to extract fromVersion
 * and patch layer digest, without downloading the actual blob data.
 *
 * @param opts - Discovery parameters (token, layer/binary names)
 * @param version - Nightly version to look up
 * @param isTarget - Whether to extract target SHA-256
 * @returns Chain link metadata, or null if unavailable
 */
async function discoverNightlyLink(
  opts: NightlyDiscoveryOpts,
  version: string,
  isTarget: boolean
): Promise<NightlyChainLink | null> {
  let manifest: OciManifest;
  try {
    manifest = await fetchManifest(opts.token, `${PATCH_TAG_PREFIX}${version}`);
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

  const targetSha256 = isTarget
    ? getPatchTargetSha256(manifest, opts.binaryName)
    : null;

  return {
    patchDigest: patchLayer.digest,
    patchSize: patchLayer.size,
    fromVersion,
    targetSha256,
  };
}

/** Result from the serial discovery phase of nightly chain resolution */
type NightlyDiscoveryResult = {
  /** Ordered links (oldest first) forming the chain */
  links: NightlyChainLink[];
  /** Expected SHA-256 of the final target binary */
  expectedSha256: string;
};

/**
 * Discover the full chain of nightly patches by walking manifest annotations.
 *
 * Serial phase: fetches only lightweight manifest JSON to extract
 * fromVersion and layer digest/size. Validates the size threshold
 * against reported layer sizes as it walks.
 *
 * @returns Discovery result, or null if the chain is broken/exceeds threshold
 */
async function discoverNightlyChain(
  opts: NightlyDiscoveryOpts,
  currentVersion: string,
  targetVersion: string,
  fullGzSize: number
): Promise<NightlyDiscoveryResult | null> {
  const links: NightlyChainLink[] = [];
  let totalSize = 0;
  let expectedSha256 = "";
  let version = targetVersion;

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    const link = await discoverNightlyLink(opts, version, depth === 0);
    if (!link) {
      return null;
    }

    if (depth === 0) {
      expectedSha256 = link.targetSha256 ?? "";
      if (!expectedSha256) {
        return null;
      }
    }

    links.unshift(link);
    totalSize += link.patchSize;

    if (totalSize > fullGzSize * SIZE_THRESHOLD_RATIO) {
      return null;
    }

    if (link.fromVersion === currentVersion) {
      return { links, expectedSha256 };
    }

    version = link.fromVersion;
  }

  return null;
}

/**
 * Attempt to resolve a chain of nightly patches from current to target version.
 *
 * Phase 1 (serial): Walk backwards using GHCR `:patch-<version>` manifest
 * annotations to discover the chain and validate size thresholds.
 *
 * Phase 2 (parallel): Download all patch layer blobs concurrently.
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
  const opts: NightlyDiscoveryOpts = { token, patchLayerName, binaryName };

  const discovered = await discoverNightlyChain(
    opts,
    currentVersion,
    targetVersion,
    fullGzSize
  );
  if (!discovered) {
    return null;
  }

  // Phase 2: Parallel patch download
  const downloadResults = await Promise.all(
    discovered.links.map((link) =>
      downloadLayerBlob(token, link.patchDigest).then(
        (buf) => new Uint8Array(buf)
      )
    )
  );

  const patches: PatchLink[] = [];
  let totalSize = 0;
  for (const data of downloadResults) {
    patches.push({ data, size: data.byteLength });
    totalSize += data.byteLength;
  }

  return { patches, totalSize, expectedSha256: discovered.expectedSha256 };
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
