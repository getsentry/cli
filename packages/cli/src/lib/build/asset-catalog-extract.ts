/**
 * Native pixel extraction for iOS `Assets.car` asset catalogs.
 *
 * Decoding renditions to actual images requires Apple's private macOS CoreUI
 * framework, which only exists on macOS and cannot be reimplemented portably.
 * The rest of the build pipeline stays pure-TypeScript and cross-platform (see
 * {@link ./asset-catalog.ts} for the size/geometry manifest that works
 * everywhere); this module is the one macOS-only path.
 *
 * The decoder ships as a small Swift helper (`native/car-extract`) compiled for
 * `darwin-arm64` and embedded into that SEA binary as an asset (see
 * `script/build.ts`). At runtime we:
 *   1. locate the helper (SEA asset → extract to temp; dev → the built binary),
 *   2. write the `.car` bytes to a temp file,
 *   3. run the helper, which renders each rendition to PNG and prints a JSON
 *      manifest of what it wrote,
 *   4. read the PNGs back into memory.
 *
 * On any non-macOS-arm64 platform, or if the helper is missing or fails, this
 * returns `null` and the caller falls back to the size-only manifest. Pixel
 * extraction is therefore strictly additive: it never blocks an upload.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../logger.js";

const log = logger.withTag("build.asset-catalog.extract");
const _require = createRequire(import.meta.url);

/**
 * SEA asset key for the embedded `car-extract` helper. Must match the
 * `--assets` argument passed to fossilize in `script/build.ts`.
 */
const CAR_EXTRACT_ASSET_KEY = "dist-build/car-extract";

/** Path to the helper built into the dev tree by `script/build-car-extract.ts`. */
const CAR_EXTRACT_DEV_PATH = new URL(
  "../../../native/car-extract/car-extract",
  import.meta.url
);

/** Upper bound on the helper's JSON stdout (16 MB of manifest is absurdly large). */
const MANIFEST_MAX_BUFFER = 16 * 1024 * 1024;

/** One image decoded from a rendition by the native helper. */
export type ExtractedImage = {
  /** Rendition name (e.g. `"AppIcon"`). */
  name: string;
  /** Output filename the helper wrote (e.g. `"AppIcon@2x.png"`). */
  file: string;
  /** Decoded pixel width. */
  width: number;
  /** Decoded pixel height. */
  height: number;
  /** Scale factor (1, 2, 3). */
  scale: number;
  /** PNG byte size on disk. */
  bytes: number;
  /** The decoded PNG bytes. */
  content: Uint8Array;
};

/** Shape of the helper's JSON manifest (without the in-memory bytes). */
type HelperManifest = {
  images: Array<Omit<ExtractedImage, "content">>;
};

/** Returns the SEA API when running inside a Node SEA binary, else null. */
function seaApi(): {
  isSea: () => boolean;
  getRawAsset: (key: string) => ArrayBuffer;
} | null {
  try {
    const sea = _require("node:sea") as {
      isSea?: () => boolean;
      getRawAsset?: (key: string) => ArrayBuffer;
    };
    if (sea.isSea?.() && sea.getRawAsset) {
      return { isSea: () => true, getRawAsset: sea.getRawAsset };
    }
  } catch (err) {
    log.debug("node:sea unavailable; treating as non-SEA runtime", err);
  }
  return null;
}

/** Whether the current runtime can host the CoreUI helper (macOS on arm64). */
function platformSupportsExtraction(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

/**
 * Resolve the `car-extract` helper to an executable path, materializing the SEA
 * asset to a temp file when needed. Returns the path plus an optional cleanup
 * directory the caller must remove, or `null` if no helper is available.
 */
function resolveHelper(): { path: string; cleanupDir?: string } | null {
  const sea = seaApi();
  if (sea) {
    let raw: ArrayBuffer;
    try {
      raw = sea.getRawAsset(CAR_EXTRACT_ASSET_KEY);
    } catch (err) {
      log.debug("car-extract helper not embedded in this binary", err);
      return null;
    }
    const dir = mkdtempSync(join(tmpdir(), "sentry-car-extract-"));
    const path = join(dir, "car-extract");
    writeFileSync(path, new Uint8Array(raw), { mode: 0o755 });
    return { path, cleanupDir: dir };
  }

  // Dev / npm: use the helper built next to the source, if present.
  const devPath = CAR_EXTRACT_DEV_PATH.pathname;
  if (existsSync(devPath)) {
    return { path: devPath };
  }
  log.debug("car-extract helper not found for non-SEA runtime");
  return null;
}

/**
 * Decode an `Assets.car` into per-rendition PNG images using the native macOS
 * helper. Returns `null` (never throws) when extraction isn't possible — wrong
 * platform, missing helper, or a helper failure — so callers can fall back to
 * the size-only manifest.
 *
 * @param carRelPath - Archive-relative path of the catalog (for log context).
 * @param content - The raw `.car` bytes.
 */
export function extractAssetCatalogImages(
  carRelPath: string,
  content: Uint8Array
): ExtractedImage[] | null {
  if (!platformSupportsExtraction()) {
    return null;
  }

  const helper = resolveHelper();
  if (!helper) {
    return null;
  }

  const workDir = mkdtempSync(join(tmpdir(), "sentry-car-"));
  const inputPath = join(workDir, "input.car");
  const outputDir = join(workDir, "out");
  try {
    writeFileSync(inputPath, content);
    const stdout = execFileSync(helper.path, [inputPath, outputDir], {
      encoding: "buffer",
      maxBuffer: MANIFEST_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const manifest = JSON.parse(stdout.toString("utf-8")) as HelperManifest;
    return manifest.images.map((img) => ({
      ...img,
      content: readFileSync(join(outputDir, img.file)),
    }));
  } catch (err) {
    log.debug(`Native asset-catalog extraction failed for ${carRelPath}`, err);
    return null;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    if (helper.cleanupDir) {
      rmSync(helper.cleanupDir, { recursive: true, force: true });
    }
  }
}
