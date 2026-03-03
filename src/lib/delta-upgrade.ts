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
  listTags,
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
export type GitHubAsset = {
  name: string;
  size: number;
  /** SHA-256 digest in the form "sha256:<hex>" */
  digest?: string;
  browser_download_url: string;
};

/** GitHub Release metadata (subset of API response) */
export type GitHubRelease = {
  tag_name: string;
  assets: GitHubAsset[];
};

/**
 * Fetch recent releases from GitHub, ordered newest-first.
 *
 * A single API call returns full release metadata including assets,
 * eliminating the need for per-release fetches during chain resolution.
 *
 * @returns Array of releases (newest first), or empty array on failure
 */
export async function fetchRecentReleases(): Promise<GitHubRelease[]> {
  const perPage = MAX_CHAIN_DEPTH + 2;
  let response: Response;
  try {
    response = await fetch(`${GITHUB_RELEASES_URL}?per_page=${perPage}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "sentry-cli",
      },
    });
  } catch {
    return [];
  }
  if (!response.ok) {
    return [];
  }
  return (await response.json()) as GitHubRelease[];
}

/**
 * Extract SHA-256 hex digest from a GitHub asset's digest field.
 *
 * GitHub provides digests as "sha256:<hex>". This strips the prefix.
 *
 * @param asset - GitHub Release asset
 * @returns Hex digest string, or null if no digest available
 */
export function extractSha256(asset: GitHubAsset): string | null {
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
export async function downloadStablePatch(
  url: string
): Promise<Uint8Array | null> {
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
export function getStableTargetSha256(
  release: GitHubRelease,
  binaryName: string
): string | null {
  const binaryAsset = release.assets.find((a) => a.name === binaryName);
  if (!binaryAsset) {
    return null;
  }
  return extractSha256(binaryAsset);
}

/** Options for extracting the stable version chain from a release list */
export type ExtractStableChainOpts = {
  releases: GitHubRelease[];
  currentVersion: string;
  targetVersion: string;
  binaryName: string;
  fullGzSize: number;
};

/** Extracted stable chain info (patch URLs in apply order + target hash) */
export type StableChainInfo = {
  /** Patch download URLs in apply order (oldest patch first) */
  patchUrls: string[];
  /** Expected SHA-256 of the final target binary */
  expectedSha256: string;
};

/**
 * Extract the chain of patch URLs from an already-fetched release list.
 *
 * Pure computation over the release array — no HTTP calls. Validates that
 * every release in the chain has a patch asset and that the cumulative
 * size stays under the threshold.
 *
 * @returns Chain info with URLs in apply order, or null if unavailable
 */
export function extractStableChain(
  opts: ExtractStableChainOpts
): StableChainInfo | null {
  const { releases, currentVersion, targetVersion, binaryName, fullGzSize } =
    opts;
  const patchAssetName = `${binaryName}.patch`;

  // Releases are newest-first; find target and current positions
  const targetIdx = releases.findIndex((r) => r.tag_name === targetVersion);
  const currentIdx = releases.findIndex((r) => r.tag_name === currentVersion);
  if (targetIdx === -1 || currentIdx === -1 || targetIdx >= currentIdx) {
    return null;
  }

  // Chain: [target, ..., current+1] (newest first, excludes current)
  const chainReleases = releases.slice(targetIdx, currentIdx);
  if (chainReleases.length > MAX_CHAIN_DEPTH) {
    return null;
  }

  // SHA-256 comes from the target release's binary asset
  const targetRelease = chainReleases[0];
  if (!targetRelease) {
    return null;
  }
  const expectedSha256 = getStableTargetSha256(targetRelease, binaryName) ?? "";
  if (!expectedSha256) {
    return null;
  }

  // Collect patch URLs and validate size threshold
  const patchUrls: string[] = [];
  let totalSize = 0;
  for (const release of chainReleases) {
    const patchAsset = release.assets.find((a) => a.name === patchAssetName);
    if (!patchAsset) {
      return null;
    }
    patchUrls.push(patchAsset.browser_download_url);
    totalSize += patchAsset.size;
    if (totalSize > fullGzSize * SIZE_THRESHOLD_RATIO) {
      return null;
    }
  }

  // Reverse to get apply order: oldest patch first
  patchUrls.reverse();
  return { patchUrls, expectedSha256 };
}

/**
 * Resolve a chain of stable patches from current to target version.
 *
 * 1. Single API call: fetch recent releases (includes full asset metadata)
 * 2. Extract chain info from the list (pure computation, no I/O)
 * 3. Parallel: download all patch files concurrently
 *
 * @param currentVersion - Currently installed version
 * @param targetVersion - Version to upgrade to
 * @returns Resolved patch chain, or null if unavailable
 */
export async function resolveStableChain(
  currentVersion: string,
  targetVersion: string
): Promise<PatchChain | null> {
  const binaryName = getPlatformBinaryName();
  const releases = await fetchRecentReleases();

  // Get .gz size from the target release for threshold calculation
  const targetRelease = releases.find((r) => r.tag_name === targetVersion);
  if (!targetRelease) {
    return null;
  }
  const gzAsset = targetRelease.assets.find(
    (a) => a.name === `${binaryName}.gz`
  );
  if (!gzAsset) {
    return null;
  }

  const chainInfo = extractStableChain({
    releases,
    currentVersion,
    targetVersion,
    binaryName,
    fullGzSize: gzAsset.size,
  });
  if (!chainInfo) {
    return null;
  }

  // Parallel patch download
  const downloadResults = await Promise.all(
    chainInfo.patchUrls.map((url) => downloadStablePatch(url))
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

  return { patches, totalSize, expectedSha256: chainInfo.expectedSha256 };
}

// Nightly channel: GHCR

/**
 * Extract the `from-version` annotation from a patch manifest.
 *
 * @param manifest - OCI manifest for a `:patch-<version>` tag
 * @returns The base version this patch applies to, or null if missing
 */
export function getPatchFromVersion(manifest: OciManifest): string | null {
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
export function getPatchTargetSha256(
  manifest: OciManifest,
  binaryName: string
): string | null {
  return manifest.annotations?.[`sha256-${binaryName}`] ?? null;
}

/** GHCR tag prefix for patch manifests */
const PATCH_TAG_PREFIX = "patch-";

/** A node in the patch graph: maps a fromVersion to the next version + manifest */
export type PatchGraphEntry = {
  /** Version this patch produces */
  version: string;
  /** Full OCI manifest (contains layer digests and annotations) */
  manifest: OciManifest;
};

/**
 * Build a directed graph of all available nightly patches.
 *
 * Fetches all `patch-*` tags from GHCR and their manifests in parallel,
 * then indexes by `from-version` annotation. The resulting map allows
 * instant chain walking from any version to its successor.
 *
 * @param token - GHCR anonymous bearer token
 * @returns Map from fromVersion → { version, manifest }
 */
export async function buildNightlyPatchGraph(
  token: string
): Promise<Map<string, PatchGraphEntry>> {
  const tags = await listTags(token, PATCH_TAG_PREFIX);
  const graph = new Map<string, PatchGraphEntry>();

  const entries = await Promise.all(
    tags.map(async (tag): Promise<[string, PatchGraphEntry] | null> => {
      const version = tag.slice(PATCH_TAG_PREFIX.length);
      try {
        const manifest = await fetchManifest(token, tag);
        const fromVersion = getPatchFromVersion(manifest);
        if (!fromVersion) {
          return null;
        }
        return [fromVersion, { version, manifest }];
      } catch {
        return null;
      }
    })
  );

  for (const entry of entries) {
    if (entry) {
      graph.set(entry[0], entry[1]);
    }
  }

  return graph;
}

/** Options for walking the nightly patch chain through the graph */
export type WalkNightlyChainOpts = {
  graph: Map<string, PatchGraphEntry>;
  currentVersion: string;
  targetVersion: string;
  patchLayerName: string;
  binaryName: string;
  fullGzSize: number;
};

/** Result of walking the nightly patch chain */
export type NightlyChainInfo = {
  /** Layer digests in apply order (oldest first) */
  layerDigests: string[];
  /** Expected SHA-256 of the final target binary */
  expectedSha256: string;
};

/**
 * Walk the pre-built patch graph from current to target version.
 *
 * Pure in-memory traversal — no HTTP calls. Validates that each step
 * has the expected platform layer and that cumulative size stays under
 * the threshold.
 *
 * @returns Chain info with layer digests in apply order, or null
 */
export function walkNightlyChain(
  opts: WalkNightlyChainOpts
): NightlyChainInfo | null {
  const {
    graph,
    currentVersion,
    targetVersion,
    patchLayerName,
    binaryName,
    fullGzSize,
  } = opts;
  const digests: string[] = [];
  let totalSize = 0;
  let version = currentVersion;

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    const entry = graph.get(version);
    if (!entry) {
      return null;
    }

    const layer = entry.manifest.layers.find((l) => {
      const title = l.annotations?.["org.opencontainers.image.title"];
      return title === patchLayerName;
    });
    if (!layer) {
      return null;
    }

    digests.push(layer.digest);
    totalSize += layer.size;

    if (totalSize > fullGzSize * SIZE_THRESHOLD_RATIO) {
      return null;
    }

    if (entry.version === targetVersion) {
      const sha256 = getPatchTargetSha256(entry.manifest, binaryName) ?? "";
      if (!sha256) {
        return null;
      }
      return { layerDigests: digests, expectedSha256: sha256 };
    }

    version = entry.version;
  }

  return null;
}

/**
 * Resolve a chain of nightly patches from current to target version.
 *
 * 1. Single API call: list all `patch-*` tags
 * 2. Parallel: fetch all patch manifests concurrently → build graph
 * 3. Walk graph in-memory to find chain (pure computation, no I/O)
 * 4. Parallel: download all patch layer blobs concurrently
 *
 * @param token - GHCR anonymous bearer token
 * @param currentVersion - Currently installed nightly version
 * @param targetVersion - Target nightly version
 * @param fullGzSize - Size of the full .gz layer for threshold calculation
 * @returns Resolved patch chain, or null if unavailable
 */
export async function resolveNightlyChain(
  token: string,
  currentVersion: string,
  targetVersion: string,
  fullGzSize: number
): Promise<PatchChain | null> {
  const binaryName = getPlatformBinaryName();
  const patchLayerName = `${binaryName}.patch`;

  const graph = await buildNightlyPatchGraph(token);

  const chainInfo = walkNightlyChain({
    graph,
    currentVersion,
    targetVersion,
    patchLayerName,
    binaryName,
    fullGzSize,
  });
  if (!chainInfo) {
    return null;
  }

  // Parallel blob download
  const downloadResults = await Promise.all(
    chainInfo.layerDigests.map((digest) =>
      downloadLayerBlob(token, digest).then((buf) => new Uint8Array(buf))
    )
  );

  const patches: PatchLink[] = [];
  let totalSize = 0;
  for (const data of downloadResults) {
    patches.push({ data, size: data.byteLength });
    totalSize += data.byteLength;
  }

  return { patches, totalSize, expectedSha256: chainInfo.expectedSha256 };
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
export async function resolveStableDelta(
  targetVersion: string,
  oldBinaryPath: string,
  destPath: string
): Promise<string | null> {
  const chain = await resolveStableChain(CLI_VERSION, targetVersion);
  if (!chain) {
    return null;
  }

  return await applyPatchChain(chain, oldBinaryPath, destPath);
}

/**
 * Resolve and apply nightly delta patches.
 *
 * @returns SHA-256 hex of the output, or null if delta is unavailable
 */
export async function resolveNightlyDelta(
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
export async function applyPatchChain(
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
