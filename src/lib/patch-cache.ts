/**
 * Patch Cache
 *
 * File-based cache for delta upgrade patches. Patches are downloaded
 * during background version checks so that `sentry cli upgrade` can
 * apply them offline without any network calls.
 *
 * Cache location: <configDir>/patch-cache/
 * - <fromVersion>-<toVersion>.patch — raw binary patch data
 * - chain-<fromVersion>-<toVersion>.json — chain metadata
 *
 * Uses file-based storage (not SQLite) to avoid bloating the DB with
 * 50-80KB binary blobs. The cache is channel-agnostic — the same
 * version-based naming works for both nightly (GHCR) and stable
 * (GitHub Releases) channels.
 *
 * Patches accumulate across version check runs: if a user skips 3
 * checks, all 3 patches are cached and a multi-hop upgrade is fully
 * offline.
 */

import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "./db/index.js";

const PATCH_CACHE_DIR = "patch-cache";

/** 7-day TTL for cached patches (milliseconds) */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum number of chain steps to prevent infinite loops from corrupt metadata */
const MAX_CHAIN_WALK_DEPTH = 10;

/** Metadata for a single patch step */
export type PatchStepMeta = {
  fromVersion: string;
  toVersion: string;
  size: number;
};

/** Chain metadata stored alongside patch files */
export type ChainMeta = {
  fromVersion: string;
  toVersion: string;
  expectedSha256: string;
  cachedAt: number;
  patches: PatchStepMeta[];
};

function getCacheDir(): string {
  return join(getConfigDir(), PATCH_CACHE_DIR);
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(getCacheDir(), { recursive: true, mode: 0o700 });
}

/**
 * Sanitize version strings for safe filenames.
 * Replaces any character that isn't alphanumeric, dot, or hyphen with underscore.
 */
function sanitizeVersion(version: string): string {
  return version.replace(/[^a-zA-Z0-9.-]/g, "_");
}

/** Build the filename for a patch file given a from→to version pair. */
export function patchFileName(fromVersion: string, toVersion: string): string {
  return `${sanitizeVersion(fromVersion)}-${sanitizeVersion(toVersion)}.patch`;
}

/** Build the filename for a chain metadata file. */
export function chainFileName(fromVersion: string, toVersion: string): string {
  return `chain-${sanitizeVersion(fromVersion)}-${sanitizeVersion(toVersion)}.json`;
}

/**
 * Check whether an error is a "file not found" error (ENOENT).
 * Used to avoid TOCTOU races from `exists()` + `read()`.
 */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

/**
 * Save a patch file and its chain metadata to the cache.
 *
 * Each patch in the chain is stored individually (keyed by from-to version),
 * plus one chain metadata file per resolved chain. This allows patches from
 * different version check runs to accumulate and form complete chains.
 *
 * @param chain - The resolved patch chain (patches with data and expected hash)
 * @param steps - Version pairs for each patch (ordered, oldest first)
 */
export async function savePatchesToCache(
  chain: {
    patches: { data: Uint8Array; size: number }[];
    expectedSha256: string;
  },
  steps: { fromVersion: string; toVersion: string }[]
): Promise<void> {
  await ensureCacheDir();
  const cacheDir = getCacheDir();

  // Save all patch files in parallel
  await Promise.all(
    chain.patches.flatMap((patch, i) => {
      const step = steps[i];
      if (!(step && patch)) {
        return [];
      }
      const filePath = join(
        cacheDir,
        patchFileName(step.fromVersion, step.toVersion)
      );
      return [Bun.write(filePath, patch.data)];
    })
  );

  // Save chain metadata
  if (steps.length > 0) {
    const firstStep = steps.at(0);
    const lastStep = steps.at(-1);
    if (firstStep && lastStep) {
      const meta: ChainMeta = {
        fromVersion: firstStep.fromVersion,
        toVersion: lastStep.toVersion,
        expectedSha256: chain.expectedSha256,
        cachedAt: Date.now(),
        patches: steps.map((s, i) => ({
          fromVersion: s.fromVersion,
          toVersion: s.toVersion,
          size: chain.patches[i]?.size ?? 0,
        })),
      };
      const metaPath = join(
        cacheDir,
        chainFileName(firstStep.fromVersion, lastStep.toVersion)
      );
      await Bun.write(metaPath, JSON.stringify(meta));
    }
  }
}

/**
 * Load all chain metadata files from the cache directory.
 *
 * @returns Array of parsed chain metadata
 */
async function loadAllChainMetas(cacheDir: string): Promise<ChainMeta[]> {
  let files: string[];
  try {
    files = await readdir(cacheDir);
  } catch (err) {
    if (isNotFound(err)) {
      return [];
    }
    throw err;
  }

  const metaFiles = files.filter(
    (f) => f.startsWith("chain-") && f.endsWith(".json")
  );

  const results = await Promise.all(
    metaFiles.map(async (file) => {
      try {
        return (await Bun.file(join(cacheDir, file)).json()) as ChainMeta;
      } catch {
        // Corrupt metadata file — skip
        return null;
      }
    })
  );

  return results.filter((m): m is ChainMeta => m !== null);
}

/**
 * Build a step map from chain metadata: fromVersion → { toVersion, size }.
 * Allows stitching chains from different version check runs.
 */
function buildStepMap(
  chainMetas: ChainMeta[]
): Map<string, { toVersion: string; size: number }> {
  const stepMap = new Map<string, { toVersion: string; size: number }>();
  for (const meta of chainMetas) {
    for (const step of meta.patches) {
      stepMap.set(step.fromVersion, {
        toVersion: step.toVersion,
        size: step.size,
      });
    }
  }
  return stepMap;
}

/**
 * Walk from currentVersion toward targetVersion using the step map.
 *
 * @returns Ordered list of version steps, or null if chain is incomplete
 */
function walkChainSteps(
  stepMap: Map<string, { toVersion: string; size: number }>,
  currentVersion: string,
  targetVersion: string
): { fromVersion: string; toVersion: string }[] | null {
  const steps: { fromVersion: string; toVersion: string }[] = [];
  let version = currentVersion;
  while (version !== targetVersion) {
    const next = stepMap.get(version);
    if (!next) {
      return null;
    }
    steps.push({ fromVersion: version, toVersion: next.toVersion });
    version = next.toVersion;

    // Safety: prevent infinite loops from corrupt metadata
    if (steps.length > MAX_CHAIN_WALK_DEPTH) {
      return null;
    }
  }
  return steps.length > 0 ? steps : null;
}

/**
 * Try to load a complete patch chain from the cache.
 *
 * Walks from currentVersion toward targetVersion, loading individual
 * patch files. Each patch is keyed by `fromVersion-toVersion`, so patches
 * from different version check runs can be stitched together.
 *
 * Requires chain metadata files to know the expected SHA-256 and
 * the intermediate version steps.
 *
 * @returns Cached chain data if all patches are available, null otherwise
 */
export async function loadCachedChain(
  currentVersion: string,
  targetVersion: string
): Promise<{
  patches: { data: Uint8Array; size: number }[];
  totalSize: number;
  expectedSha256: string;
} | null> {
  const cacheDir = getCacheDir();

  const chainMetas = await loadAllChainMetas(cacheDir);
  if (chainMetas.length === 0) {
    return null;
  }

  const stepMap = buildStepMap(chainMetas);
  const steps = walkChainSteps(stepMap, currentVersion, targetVersion);
  if (!steps) {
    return null;
  }

  // Find the expectedSha256 from metadata that covers the target version
  let expectedSha256 = "";
  for (const meta of chainMetas) {
    if (meta.toVersion === targetVersion && meta.expectedSha256) {
      expectedSha256 = meta.expectedSha256;
      break;
    }
  }
  if (!expectedSha256) {
    return null;
  }

  // Load all patch files in parallel, bail on any missing file
  const loadResults = await Promise.all(
    steps.map(async (step) => {
      const filePath = join(
        cacheDir,
        patchFileName(step.fromVersion, step.toVersion)
      );
      try {
        const data = new Uint8Array(await Bun.file(filePath).arrayBuffer());
        return { data, size: data.byteLength };
      } catch (err) {
        if (isNotFound(err)) {
          return null;
        }
        throw err;
      }
    })
  );

  // Any missing patch file means an incomplete chain
  const patches: { data: Uint8Array; size: number }[] = [];
  let totalSize = 0;
  for (const result of loadResults) {
    if (!result) {
      return null;
    }
    patches.push(result);
    totalSize += result.size;
  }

  return { patches, totalSize, expectedSha256 };
}

/**
 * Remove expired chain entries and their exclusive patch files.
 *
 * Preserves patch files still referenced by live (non-expired) chains.
 * Fully async and fire-and-forget — errors on individual file deletions
 * are silently ignored.
 */
async function removeExpiredEntries(
  cacheDir: string,
  files: string[],
  now: number
): Promise<void> {
  const expiredMetas: ChainMeta[] = [];
  const livePatchFiles = new Set<string>();

  // Classify chains into expired vs live
  const metaResults = await Promise.all(
    files
      .filter((f) => f.startsWith("chain-") && f.endsWith(".json"))
      .map(async (file) => {
        try {
          const meta = (await Bun.file(
            join(cacheDir, file)
          ).json()) as ChainMeta;
          return { file, meta };
        } catch {
          // Corrupt metadata — schedule for removal
          await unlink(join(cacheDir, file)).catch(() => {
            /* best-effort */
          });
          return null;
        }
      })
  );

  for (const result of metaResults) {
    if (!result) {
      continue;
    }
    if (now - result.meta.cachedAt > CACHE_MAX_AGE_MS) {
      expiredMetas.push(result.meta);
    } else {
      for (const step of result.meta.patches) {
        livePatchFiles.add(patchFileName(step.fromVersion, step.toVersion));
      }
    }
  }

  // Delete expired entries, preserving patch files used by live chains
  const deletions: Promise<void>[] = [];
  for (const meta of expiredMetas) {
    for (const step of meta.patches) {
      const name = patchFileName(step.fromVersion, step.toVersion);
      if (!livePatchFiles.has(name)) {
        deletions.push(
          unlink(join(cacheDir, name)).catch(() => {
            /* best-effort */
          })
        );
      }
    }
    deletions.push(
      unlink(
        join(cacheDir, chainFileName(meta.fromVersion, meta.toVersion))
      ).catch(() => {
        /* best-effort */
      })
    );
  }

  await Promise.all(deletions);
}

/**
 * Remove stale cache entries older than 7 days.
 * Called opportunistically during version checks.
 *
 * Uses a two-pass approach: first identifies expired vs live chains,
 * then deletes expired entries while preserving patch files that are
 * still referenced by non-expired chains (prevents breaking multi-hop
 * chains that share patch files with expired shorter chains).
 *
 * Cleanup runs as fire-and-forget — the returned promise is not awaited
 * by callers and errors are silently suppressed.
 */
export async function cleanupPatchCache(): Promise<void> {
  const cacheDir = getCacheDir();
  let files: string[];
  try {
    files = await readdir(cacheDir);
  } catch (err) {
    if (isNotFound(err)) {
      return;
    }
    throw err;
  }
  await removeExpiredEntries(cacheDir, files, Date.now());
}

/**
 * Remove all cached patch files and chain metadata.
 *
 * Called after a successful upgrade — cached patches for the old version
 * are no longer useful since the binary has already been updated.
 * Best-effort: errors on individual file deletions are silently ignored.
 */
export async function clearPatchCache(): Promise<void> {
  const cacheDir = getCacheDir();
  let files: string[];
  try {
    files = await readdir(cacheDir);
  } catch (err) {
    if (isNotFound(err)) {
      return;
    }
    throw err;
  }

  await Promise.all(
    files.map((file) =>
      unlink(join(cacheDir, file)).catch(() => {
        /* best-effort */
      })
    )
  );
}
