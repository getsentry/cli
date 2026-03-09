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

import { unlinkSync } from "node:fs";

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";

import {
  GITHUB_RELEASES_URL,
  getPlatformBinaryName,
  isDowngrade,
  isNightlyVersion,
} from "./binary.js";
import { applyPatch } from "./bspatch.js";
import { CLI_VERSION } from "./constants.js";
import {
  downloadLayerBlob,
  fetchManifest,
  getAnonymousToken,
  listTags,
  type OciManifest,
} from "./ghcr.js";
import { logger } from "./logger.js";
import { loadCachedChain, savePatchesToCache } from "./patch-cache.js";
import { withTracing, withTracingSpan } from "./telemetry.js";

/** Scoped logger for delta upgrade operations */
const log = logger.withTag("delta-upgrade");

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

/** Pattern to extract hex from a GitHub asset digest like "sha256:<hex>" */
const SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]+)$/i;

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
  /**
   * Version step pairs in apply order (oldest first).
   * Present when the chain was resolved from network — used for cache storage.
   */
  steps?: { fromVersion: string; toVersion: string }[];
};

/** Result of a successful delta upgrade */
export type DeltaResult = {
  /** SHA-256 hex digest of the output binary */
  sha256: string;
  /** Total bytes downloaded for the patch chain */
  patchBytes: number;
  /** Number of patches in the chain (1 = direct, >1 = multi-hop) */
  chainLength: number;
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

  // Downgrades have no forward patch path — skip immediately
  if (isDowngrade(CLI_VERSION, targetVersion)) {
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
export async function fetchRecentReleases(
  signal?: AbortSignal
): Promise<GitHubRelease[]> {
  const perPage = MAX_CHAIN_DEPTH + 2;
  let response: Response;
  try {
    response = await fetch(`${GITHUB_RELEASES_URL}?per_page=${perPage}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "sentry-cli",
      },
      signal,
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
  // Normalize to lowercase — Bun.CryptoHasher.digest("hex") returns lowercase
  return match ? (match[1]?.toLowerCase() ?? null) : null;
}

/**
 * Download a patch file from a GitHub Release asset URL.
 *
 * @param url - Browser download URL for the asset
 * @returns Patch file data, or null on failure
 */
export async function downloadStablePatch(
  url: string,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "sentry-cli" },
      signal,
    });
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
  /** Version step pairs in apply order (oldest first) */
  steps: { fromVersion: string; toVersion: string }[];
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

  // Build version steps in apply order (oldest first, matching patchUrls)
  const reversedReleases = [...chainReleases].reverse();
  const steps: { fromVersion: string; toVersion: string }[] = [];
  let prevVersion = currentVersion;
  for (const release of reversedReleases) {
    steps.push({ fromVersion: prevVersion, toVersion: release.tag_name });
    prevVersion = release.tag_name;
  }

  return { patchUrls, expectedSha256, steps };
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
  targetVersion: string,
  signal?: AbortSignal
): Promise<PatchChain | null> {
  const binaryName = getPlatformBinaryName();
  const releases = await withTracing("fetch-releases", "http.client", () =>
    fetchRecentReleases(signal)
  );

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
  const downloadResults = await withTracing(
    "download-patches",
    "http.client",
    () =>
      Promise.all(
        chainInfo.patchUrls.map((url) => downloadStablePatch(url, signal))
      )
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

  return {
    patches,
    totalSize,
    expectedSha256: chainInfo.expectedSha256,
    steps: chainInfo.steps,
  };
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
export const PATCH_TAG_PREFIX = "patch-";

/**
 * Filter patch tags to only those in the upgrade chain from current to target,
 * and sort them in apply order (oldest first).
 *
 * Since nightly patches are sequential (each `patch-<V_n>` patches from V_{n-1}),
 * the chain tags are those where the version is strictly greater than
 * currentVersion and less than or equal to targetVersion.
 *
 * @param allTags - All patch tags from GHCR (e.g., `["patch-0.14.0-dev.100", ...]`)
 * @param currentVersion - Version to upgrade from
 * @param targetVersion - Version to upgrade to
 * @returns Sorted tag names in apply order, or empty array if none match
 */
export function filterAndSortChainTags(
  allTags: string[],
  currentVersion: string,
  targetVersion: string
): string[] {
  const chainTags: { tag: string; version: string }[] = [];

  for (const tag of allTags) {
    const version = tag.slice(PATCH_TAG_PREFIX.length);
    // Include tags where: currentVersion < version <= targetVersion
    if (
      Bun.semver.order(version, currentVersion) === 1 &&
      Bun.semver.order(version, targetVersion) !== 1
    ) {
      chainTags.push({ tag, version });
    }
  }

  // Sort by version (chronological for nightlies)
  chainTags.sort((a, b) => Bun.semver.order(a.version, b.version));

  return chainTags.map((t) => t.tag);
}

/** Result of validating a nightly chain of manifests */
type NightlyChainValidation = {
  /** Layer digests in apply order (oldest first) */
  digests: string[];
  /** Total size of all patch layers */
  totalSize: number;
  /** Expected SHA-256 of the final target binary */
  expectedSha256: string;
};

/** Options for validating a nightly chain */
type ValidateChainOpts = {
  manifests: OciManifest[];
  chainTags: string[];
  currentVersion: string;
  targetVersion: string;
  patchLayerName: string;
  binaryName: string;
  fullGzSize: number;
};

/**
 * Validate a single step in the nightly chain.
 *
 * @returns Layer digest and size if valid, or null if the step is invalid
 */
function validateChainStep(
  manifest: OciManifest,
  opts: { expectedFrom: string; patchLayerName: string; sizeLimit: number }
): { digest: string; size: number } | null {
  const fromVersion = getPatchFromVersion(manifest);
  if (fromVersion !== opts.expectedFrom) {
    return null;
  }

  const layer = manifest.layers.find((l) => {
    const title = l.annotations?.["org.opencontainers.image.title"];
    return title === opts.patchLayerName;
  });
  if (!layer || layer.size > opts.sizeLimit) {
    return null;
  }

  return { digest: layer.digest, size: layer.size };
}

/**
 * Validate a chain of manifests and extract patch layer info.
 *
 * Checks that each manifest's `from-version` links to the previous step,
 * that the platform patch layer exists, and that cumulative size stays
 * under the threshold.
 *
 * @returns Validated chain info, or null if the chain is invalid
 */
function validateNightlyChain(
  opts: ValidateChainOpts
): NightlyChainValidation | null {
  const {
    manifests,
    chainTags,
    currentVersion,
    targetVersion,
    patchLayerName,
    binaryName,
    fullGzSize,
  } = opts;
  const digests: string[] = [];
  let totalSize = 0;
  let prevVersion = currentVersion;

  for (let i = 0; i < manifests.length; i++) {
    const manifest = manifests[i];
    const tag = chainTags[i];
    if (!(manifest && tag)) {
      return null;
    }

    const remainingBudget = fullGzSize * SIZE_THRESHOLD_RATIO - totalSize;
    const step = validateChainStep(manifest, {
      expectedFrom: prevVersion,
      patchLayerName,
      sizeLimit: remainingBudget,
    });
    if (!step) {
      return null;
    }

    digests.push(step.digest);
    totalSize += step.size;
    prevVersion = tag.slice(PATCH_TAG_PREFIX.length);

    if (i === manifests.length - 1) {
      // Verify the last tag actually corresponds to the target version.
      // Without this check, a missing patch-<targetVersion> tag could
      // cause the chain to silently stop at an intermediate version.
      if (prevVersion !== targetVersion) {
        return null;
      }
      const sha256 = getPatchTargetSha256(manifest, binaryName) ?? "";
      if (!sha256) {
        return null;
      }
      return { digests, totalSize, expectedSha256: sha256 };
    }
  }

  return null;
}

/** Options for fetching chain manifests */
type FetchManifestsOpts = {
  token: string;
  tags: string[];
  allTagCount: number;
  chainTagCount: number;
  signal?: AbortSignal;
};

/**
 * Fetch manifests for the given chain tags.
 *
 * @returns Map from tag → manifest for the tags that were fetched
 */
async function fetchChainManifests(
  opts: FetchManifestsOpts
): Promise<Map<string, OciManifest>> {
  const { token, tags, allTagCount, chainTagCount, signal } = opts;
  const fetchedManifests = new Map<string, OciManifest>();

  const results = await withTracingSpan(
    "fetch-chain-manifests",
    "http.client",
    (span) => {
      span.setAttribute("chain.tags_total", allTagCount);
      span.setAttribute("chain.tags_filtered", chainTagCount);
      span.setAttribute("chain.fetched_count", tags.length);

      return Promise.all(
        tags.map(async (tag) => {
          try {
            const manifest = await fetchManifest(token, tag, signal);
            return { tag, manifest };
          } catch {
            return { tag, manifest: null };
          }
        })
      );
    }
  );

  for (const { tag, manifest } of results) {
    if (manifest) {
      fetchedManifests.set(tag, manifest);
    }
  }

  return fetchedManifests;
}

/**
 * Resolve a chain of nightly patches from current to target version.
 *
 * Uses a lazy approach that only fetches manifests actually needed:
 * 1. Single API call: list all `patch-*` tags (cheap — just names)
 * 2. Filter to tags in the upgrade range and sort by version
 * 3. Fetch manifests for chain tags (typically 1-2 HTTP calls)
 * 4. Validate chain linkage and size threshold
 * 5. Parallel: download all patch layer blobs concurrently
 *
 * @param opts.token - GHCR anonymous bearer token
 * @param opts.currentVersion - Currently installed nightly version
 * @param opts.targetVersion - Target nightly version
 * @param opts.fullGzSize - Size of the full .gz layer for threshold calculation
 * @param opts.preloadedTags - Pre-fetched patch tags from `listTags`. When provided,
 *   skips the `listTags` call. Used by `resolveNightlyDelta` to run the tag
 *   listing in parallel with the target manifest fetch.
 * @returns Resolved patch chain, or null if unavailable
 */
export async function resolveNightlyChain(opts: {
  token: string;
  currentVersion: string;
  targetVersion: string;
  fullGzSize: number;
  preloadedTags?: string[];
  signal?: AbortSignal;
}): Promise<PatchChain | null> {
  const {
    token,
    currentVersion,
    targetVersion,
    fullGzSize,
    preloadedTags,
    signal,
  } = opts;
  const binaryName = getPlatformBinaryName();
  const patchLayerName = `${binaryName}.patch`;

  // Step 1: Use pre-fetched tags or fetch them (for backward compat / direct callers)
  const allTags =
    preloadedTags ?? (await listTags(token, PATCH_TAG_PREFIX, signal));

  // Step 2: Extract versions, filter to chain range, sort chronologically
  const chainTags = filterAndSortChainTags(
    allTags,
    currentVersion,
    targetVersion
  );
  if (chainTags.length === 0 || chainTags.length > MAX_CHAIN_DEPTH) {
    return null;
  }

  // Step 3: Fetch manifests for chain tags
  const fetchedManifests = await fetchChainManifests({
    token,
    tags: chainTags,
    allTagCount: allTags.length,
    chainTagCount: chainTags.length,
    signal,
  });

  // Build ordered manifests — any missing manifest means chain is broken
  const manifests: (OciManifest | undefined)[] = chainTags.map((tag) =>
    fetchedManifests.get(tag)
  );
  if (manifests.some((m) => !m)) {
    return null;
  }

  // Step 4: Validate chain and collect patch info
  const validation = validateNightlyChain({
    manifests: manifests as OciManifest[],
    chainTags,
    currentVersion,
    targetVersion,
    patchLayerName,
    binaryName,
    fullGzSize,
  });
  if (!validation) {
    return null;
  }

  // Step 5: Parallel blob download
  const downloadResults = await withTracing(
    "download-patches",
    "http.client",
    () =>
      Promise.all(
        validation.digests.map((digest) =>
          downloadLayerBlob(token, digest, signal).then(
            (buf) => new Uint8Array(buf)
          )
        )
      )
  );

  const patches: PatchLink[] = [];
  let downloadedSize = 0;
  for (const data of downloadResults) {
    patches.push({ data, size: data.byteLength });
    downloadedSize += data.byteLength;
  }

  // Build version steps from chain tags (oldest first)
  const steps: { fromVersion: string; toVersion: string }[] = [];
  let prevVersion = currentVersion;
  for (const tag of chainTags) {
    const toVersion = tag.slice(PATCH_TAG_PREFIX.length);
    steps.push({ fromVersion: prevVersion, toVersion });
    prevVersion = toVersion;
  }

  return {
    patches,
    totalSize: downloadedSize,
    expectedSha256: validation.expectedSha256,
    steps,
  };
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
 * @returns Delta result with SHA-256 and size info, or null if delta is unavailable
 */
export function attemptDeltaUpgrade(
  targetVersion: string,
  oldBinaryPath: string,
  destPath: string
): Promise<DeltaResult | null> {
  if (!canAttemptDelta(targetVersion)) {
    return Promise.resolve(null);
  }

  const channel = isNightlyVersion(targetVersion) ? "nightly" : "stable";

  return withTracingSpan(
    "delta-upgrade",
    "upgrade.delta",
    async (span) => {
      span.setAttribute("delta.from_version", CLI_VERSION);
      span.setAttribute("delta.to_version", targetVersion);

      log.debug(
        `Attempting delta upgrade from ${CLI_VERSION} to ${targetVersion}`
      );

      try {
        const result =
          channel === "nightly"
            ? await resolveNightlyDelta(targetVersion, oldBinaryPath, destPath)
            : await resolveStableDelta(targetVersion, oldBinaryPath, destPath);

        if (result) {
          span.setAttribute("delta.patch_bytes", result.patchBytes);
          span.setAttribute("delta.chain_length", result.chainLength);
          span.setAttribute("delta.sha256", result.sha256.slice(0, 12));
          span.setStatus({ code: 1 }); // OK

          Sentry.metrics.distribution(
            "upgrade.delta.patch_bytes",
            result.patchBytes,
            {
              attributes: { channel },
            }
          );
          Sentry.metrics.distribution(
            "upgrade.delta.chain_length",
            result.chainLength,
            {
              attributes: { channel },
            }
          );
        } else {
          // No patch available — not an error, just unavailable
          span.setAttribute("delta.result", "unavailable");
          span.setStatus({ code: 1 }); // OK — graceful fallback
        }
        return result;
      } catch (error) {
        // Record the error in Sentry so we can see delta failures in telemetry.
        // Marked non-fatal: the upgrade continues via full download.
        Sentry.captureException(error, {
          level: "warning",
          tags: {
            "delta.from_version": CLI_VERSION,
            "delta.to_version": targetVersion,
            "delta.channel": channel,
          },
          contexts: {
            delta_upgrade: {
              from_version: CLI_VERSION,
              to_version: targetVersion,
              channel,
              old_binary_path: oldBinaryPath,
            },
          },
        });

        const msg = error instanceof Error ? error.message : String(error);
        log.warn(
          `Delta upgrade failed (${msg}), falling back to full download`
        );
        span.setStatus({ code: 2 }); // Error
        span.setAttribute("delta.result", "error");
        span.setAttribute("delta.error", msg);
        return null;
      }
    },
    { "delta.channel": channel }
  );
}

/**
 * Build a cache key for Sentry Cache Insights instrumentation.
 * Format: `patch-chain:{from}-{to}` (e.g., `patch-chain:0.13.0-0.14.0`).
 */
function patchCacheKey(fromVersion: string, toVersion: string): string {
  return `patch-chain:${fromVersion}-${toVersion}`;
}

/**
 * Try to load a cached patch chain, catching and suppressing errors.
 *
 * Emits a `cache.get` span with standard Sentry Cache Module attributes
 * so the operation appears in the Cache Insights dashboard.
 *
 * @returns Cached chain data, or null if unavailable or on any error
 */
async function tryLoadCachedChain(
  currentVersion: string,
  targetVersion: string
): Promise<PatchChain | null> {
  const key = patchCacheKey(currentVersion, targetVersion);
  try {
    return await withTracingSpan(key, "cache.get", async (span) => {
      span.setAttribute("cache.key", [key]);
      const result = await loadCachedChain(currentVersion, targetVersion);
      const hit = result !== null;
      span.setAttribute("cache.hit", hit);
      if (hit) {
        span.setAttribute("cache.item_size", result.totalSize);
      }
      return result;
    });
  } catch {
    return null;
  }
}

/**
 * Apply a cached or network-resolved chain and return the delta result.
 */
async function applyChainAndReturn(
  chain: PatchChain,
  oldBinaryPath: string,
  destPath: string
): Promise<DeltaResult> {
  const sha256 = await withTracing(
    "apply-patch-chain",
    "upgrade.delta.apply",
    () => applyPatchChain(chain, oldBinaryPath, destPath)
  );
  return {
    sha256,
    patchBytes: chain.totalSize,
    chainLength: chain.patches.length,
  };
}

/** Options for the shared cache-first resolve + apply logic */
type ResolveAndApplyOpts = {
  targetVersion: string;
  oldBinaryPath: string;
  destPath: string;
  /** Channel-specific chain resolution callback */
  resolveFromNetwork: () => Promise<PatchChain | null>;
  /** Channel label for log messages (e.g., "stable", "nightly") */
  channel: string;
};

/**
 * Shared cache-first resolve + apply logic for both stable and nightly channels.
 *
 * 1. Check the patch cache for a fully offline upgrade
 * 2. If no cache hit, resolve a fresh chain from the network
 * 3. Apply the chain and return the delta result
 */
async function resolveAndApplyDelta(
  opts: ResolveAndApplyOpts
): Promise<DeltaResult | null> {
  const {
    targetVersion,
    oldBinaryPath,
    destPath,
    resolveFromNetwork,
    channel,
  } = opts;
  // Check patch cache first — enables fully offline upgrades
  const cached = await tryLoadCachedChain(CLI_VERSION, targetVersion);
  if (cached) {
    Sentry.getActiveSpan()?.setAttribute("delta.source", "cache");
    log.debug(
      `Using cached patches: ${cached.patches.length} patch(es), ${cached.totalSize} bytes total`
    );
    return await applyChainAndReturn(cached, oldBinaryPath, destPath);
  }
  Sentry.getActiveSpan()?.setAttribute("delta.source", "network");

  const chain = await resolveFromNetwork();
  if (chain) {
    log.debug(
      `Resolved ${channel} chain: ${chain.patches.length} patch(es), ${chain.totalSize} bytes total`
    );
  }
  if (!chain) {
    return null;
  }

  return await applyChainAndReturn(chain, oldBinaryPath, destPath);
}

/**
 * Resolve and apply stable delta patches.
 *
 * Checks the patch cache first for fully offline upgrades.
 * Falls back to network resolution if the cache is empty.
 *
 * @returns Delta result with SHA-256 and size info, or null if delta is unavailable
 */
export function resolveStableDelta(
  targetVersion: string,
  oldBinaryPath: string,
  destPath: string
): Promise<DeltaResult | null> {
  return resolveAndApplyDelta({
    targetVersion,
    oldBinaryPath,
    destPath,
    resolveFromNetwork: () =>
      withTracing("resolve-stable-chain", "upgrade.delta.resolve", () =>
        resolveStableChain(CLI_VERSION, targetVersion)
      ),
    channel: "stable",
  });
}

/**
 * Resolve and apply nightly delta patches.
 *
 * Checks the patch cache first for fully offline upgrades.
 * Falls back to network resolution if the cache is empty.
 *
 * @returns Delta result with SHA-256 and size info, or null if delta is unavailable
 */
export function resolveNightlyDelta(
  targetVersion: string,
  oldBinaryPath: string,
  destPath: string
): Promise<DeltaResult | null> {
  return resolveAndApplyDelta({
    targetVersion,
    oldBinaryPath,
    destPath,
    resolveFromNetwork: () => resolveNightlyChainWithContext(targetVersion),
    channel: "nightly",
  });
}

/**
 * Resolve a nightly chain with full context setup (token, manifest, tags).
 *
 * Extracted to share between `resolveNightlyDelta` and `prefetchNightlyPatches`.
 * Fetches the GHCR token, target manifest, and patch tags in parallel,
 * then resolves the patch chain.
 */
async function resolveNightlyChainWithContext(
  targetVersion: string,
  signal?: AbortSignal
): Promise<PatchChain | null> {
  const token = await withTracing("ghcr-token", "http.client", () =>
    getAnonymousToken(signal)
  );

  const binaryName = getPlatformBinaryName();
  const targetTag = `nightly-${targetVersion}`;

  // Fetch target manifest and list patch tags in parallel — both only need token
  const [nightlyManifest, patchTags] = await Promise.all([
    withTracing("fetch-target-manifest", "http.client", () =>
      fetchManifest(token, targetTag, signal)
    ),
    withTracing("list-patch-tags", "http.client", () =>
      listTags(token, PATCH_TAG_PREFIX, signal)
    ),
  ]);

  const gzLayer = nightlyManifest.layers.find((l) => {
    const title = l.annotations?.["org.opencontainers.image.title"];
    return title === `${binaryName}.gz`;
  });
  if (!gzLayer) {
    return null;
  }

  return await withTracing(
    "resolve-nightly-chain",
    "upgrade.delta.resolve",
    () =>
      resolveNightlyChain({
        token,
        currentVersion: CLI_VERSION,
        targetVersion,
        fullGzSize: gzLayer.size,
        preloadedTags: patchTags,
        signal,
      })
  );
}

/** Remove intermediate patching files, ignoring errors. */
function cleanupIntermediates(destPath: string): void {
  for (const suffix of [".patching.a", ".patching.b"]) {
    try {
      unlinkSync(`${destPath}${suffix}`);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Apply patches sequentially, alternating between two intermediate files.
 *
 * Extracted to keep cognitive complexity manageable when the caller wraps
 * this in a tracing span.
 *
 * @returns SHA-256 hex of the final output
 */
async function applyPatchesSequentially(
  chain: PatchChain,
  oldBinaryPath: string,
  destPath: string
): Promise<string> {
  let currentOldPath = oldBinaryPath;
  let sha256 = "";

  // Alternate between two intermediate paths to avoid reading and writing
  // the same file (mmap'd read + writer truncation = corruption).
  const intermediateA = `${destPath}.patching.a`;
  const intermediateB = `${destPath}.patching.b`;

  try {
    for (let i = 0; i < chain.patches.length; i++) {
      const patch = chain.patches[i];
      if (!patch) {
        throw new Error(`Missing patch at index ${i}`);
      }
      const isLast = i === chain.patches.length - 1;
      const intermediate = i % 2 === 0 ? intermediateA : intermediateB;
      const outputPath = isLast ? destPath : intermediate;

      sha256 = await withTracing(
        `apply-patch-${i}`,
        "upgrade.delta.apply",
        () => applyPatch(currentOldPath, patch.data, outputPath)
      );

      if (!isLast) {
        currentOldPath = outputPath;
      }
    }
  } finally {
    // Always clean up intermediate files, even on failure
    if (chain.patches.length > 1) {
      cleanupIntermediates(destPath);
    }
  }

  return sha256;
}

/**
 * Apply a resolved patch chain sequentially and verify the result.
 *
 * For single-patch chains, applies directly from old binary to dest.
 * For multi-patch chains, alternates between two intermediate files
 * so that read and write never target the same path — writing to the
 * source would truncate it and corrupt the output.
 *
 * Does **not** set executable permissions — the caller
 * (`downloadBinaryToTemp`) handles that uniformly for both delta
 * and full-download paths.
 *
 * @param chain - Resolved patch chain with patches and expected hash
 * @param oldBinaryPath - Path to the original binary
 * @param destPath - Final output path
 * @returns SHA-256 hex of the final output
 * @throws {Error} When SHA-256 verification fails
 */
export function applyPatchChain(
  chain: PatchChain,
  oldBinaryPath: string,
  destPath: string
): Promise<string> {
  return withTracingSpan(
    "apply-patches",
    "upgrade.delta.apply",
    async (span) => {
      span.setAttribute("patches.count", chain.patches.length);
      span.setAttribute(
        "patches.total_bytes",
        chain.patches.reduce((sum, p) => sum + p.size, 0)
      );

      log.debug(
        `Applying ${chain.patches.length} patch(es), expected SHA-256: ${chain.expectedSha256.slice(0, 12)}...`
      );

      const sha256 = await applyPatchesSequentially(
        chain,
        oldBinaryPath,
        destPath
      );

      // Verify the final SHA-256 matches
      if (sha256 !== chain.expectedSha256) {
        throw new Error(
          `SHA-256 mismatch after patching: got ${sha256}, expected ${chain.expectedSha256}`
        );
      }

      return sha256;
    }
  );
}

// ===================================================================
// Patch Pre-fetching (called from version-check.ts)
// ===================================================================

/**
 * Resolve a chain and save it to the cache for offline upgrades.
 *
 * Shared by both nightly and stable prefetch paths. Checks abort signal
 * at key checkpoints to bail early when the process is exiting.
 *
 * @param targetVersion - The newly discovered version
 * @param signal - Abort signal (process may exit)
 * @param resolveChain - Channel-specific chain resolution callback
 */
async function prefetchAndCache(
  targetVersion: string,
  signal: AbortSignal | undefined,
  resolveChain: () => Promise<PatchChain | null>
): Promise<void> {
  if (!canAttemptDelta(targetVersion) || signal?.aborted) {
    return;
  }

  const chain = await resolveChain();
  if (!chain?.steps || signal?.aborted) {
    return;
  }

  const key = patchCacheKey(CLI_VERSION, targetVersion);
  const steps = chain.steps;
  await withTracingSpan(key, "cache.put", async (span) => {
    span.setAttribute("cache.key", [key]);
    span.setAttribute("cache.item_size", chain.totalSize);
    await savePatchesToCache(chain, steps);
  });
}

/**
 * Pre-fetch nightly delta patches for a future upgrade.
 *
 * Called during background version check after discovering a new version.
 * Downloads the patch chain and caches it to disk so that the subsequent
 * `sentry cli upgrade` can apply patches offline.
 *
 * Runs as fire-and-forget — errors are silently ignored since this is
 * a best-effort optimization.
 *
 * @param targetVersion - The newly discovered nightly version
 * @param signal - Abort signal (process may exit)
 */
export function prefetchNightlyPatches(
  targetVersion: string,
  signal?: AbortSignal
): Promise<void> {
  return prefetchAndCache(targetVersion, signal, () =>
    resolveNightlyChainWithContext(targetVersion, signal)
  );
}

/**
 * Pre-fetch stable delta patches for a future upgrade.
 *
 * Called during background version check after discovering a new stable version.
 * Downloads the patch chain and caches it to disk so that the subsequent
 * `sentry cli upgrade` can apply patches offline.
 *
 * @param targetVersion - The newly discovered stable version
 * @param signal - Abort signal (process may exit)
 */
export function prefetchStablePatches(
  targetVersion: string,
  signal?: AbortSignal
): Promise<void> {
  return prefetchAndCache(targetVersion, signal, () =>
    resolveStableChain(CLI_VERSION, targetVersion, signal)
  );
}
