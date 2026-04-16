#!/usr/bin/env bun

/**
 * Build script for Sentry CLI
 *
 * Creates standalone executables for multiple platforms using Bun.build().
 * Binaries are uploaded to GitHub Releases.
 *
 * Uses a two-step build to produce external sourcemaps for Sentry:
 * 1. Bundle TS → single minified JS + external .map (esbuild)
 * 2. Compile JS → native binary per platform (Bun.build with compile)
 * 3. Upload .map to Sentry for server-side stack trace resolution
 *
 * This approach adds ~0.5 MB to the raw binary and ~40 KB to gzipped downloads
 * (vs ~3.8 MB / ~2.3 MB for inline sourcemaps), while giving Sentry full
 * source-mapped stack traces for accurate issue grouping.
 *
 * Usage:
 *   bun run script/build.ts                        # Build for all platforms
 *   bun run script/build.ts --single               # Build for current platform only
 *   bun run script/build.ts --target darwin-x64    # Build for specific target (cross-compile)
 *
 * Output structure:
 *   dist-bin/
 *     sentry-darwin-arm64
 *     sentry-darwin-x64
 *     sentry-linux-arm64
 *     sentry-linux-arm64-musl
 *     sentry-linux-x64
 *     sentry-linux-x64-musl
 *     sentry-windows-x64.exe
 *     bin.js.map          (sourcemap, uploaded to Sentry then deleted)
 */

import { mkdirSync, renameSync } from "node:fs";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { processBinary } from "binpunch";
import { $ } from "bun";
import { build as esbuild } from "esbuild";
import pkg from "../package.json";
import { uploadSourcemaps } from "../src/lib/api/sourcemaps.js";
import { injectDebugId, PLACEHOLDER_DEBUG_ID } from "./debug-id.js";

const gzipAsync = promisify(gzip);

const VERSION = pkg.version;

/** Build-time constants injected into the binary */
const SENTRY_CLIENT_ID = process.env.SENTRY_CLIENT_ID ?? "";

/** Build targets configuration */
type BuildTarget = {
  os: "darwin" | "linux" | "win32";
  arch: "arm64" | "x64";
  /** C library variant. Only relevant for Linux targets (musl for Alpine, etc.) */
  libc?: "musl";
};

const ALL_TARGETS: BuildTarget[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "arm64", libc: "musl" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", libc: "musl" },
  { os: "win32", arch: "x64" },
];

/** Get package name for a target (uses "windows" instead of "win32") */
function getPackageName(target: BuildTarget): string {
  const platformName = target.os === "win32" ? "windows" : target.os;
  const libcSuffix = target.libc ? `-${target.libc}` : "";
  return `sentry-${platformName}-${target.arch}${libcSuffix}`;
}

/** Get Bun compile target string */
function getBunTarget(target: BuildTarget): string {
  const libcSuffix = target.libc ? `-${target.libc}` : "";
  return `bun-${target.os}-${target.arch}${libcSuffix}`;
}

/** Path to the pre-bundled JS used by Step 2 (compile). */
const BUNDLE_JS = "dist-bin/bin.js";

/** Path to the sourcemap produced by Step 1 (bundle). */
const SOURCEMAP_FILE = "dist-bin/bin.js.map";

/**
 * Step 1: Bundle TypeScript sources into a single minified JS file
 * with an external sourcemap using esbuild.
 *
 * Uses esbuild instead of Bun's bundler to avoid Bun's identifier
 * minification bug (oven-sh/bun#14585 — name collisions in minified
 * output). esbuild's minifier is more mature and produces correct
 * identifier mangling plus rich sourcemaps (27k+ names vs Bun's
 * empty names array).
 *
 * This runs once and is shared by all compile targets. The sourcemap
 * is uploaded to Sentry (never shipped to users) for server-side
 * stack trace resolution.
 */
async function bundleJs(): Promise<boolean> {
  console.log("  Step 1: Bundling TypeScript → JS + sourcemap...");

  try {
    const result = await esbuild({
      entryPoints: ["./src/bin.ts"],
      bundle: true,
      outfile: BUNDLE_JS,
      platform: "node",
      target: "esnext",
      format: "esm",
      external: ["bun:*"],
      sourcemap: "linked",
      // Minify syntax and whitespace but NOT identifiers. Bun.build
      minify: true,
      metafile: true,
      define: {
        SENTRY_CLI_VERSION: JSON.stringify(VERSION),
        SENTRY_CLIENT_ID_BUILD: JSON.stringify(SENTRY_CLIENT_ID),
        "process.env.NODE_ENV": JSON.stringify("production"),
        __SENTRY_DEBUG_ID__: JSON.stringify(PLACEHOLDER_DEBUG_ID),
      },
    });

    const output = result.metafile?.outputs[BUNDLE_JS];
    const jsSize = (
      (output?.bytes ?? (await Bun.file(BUNDLE_JS).size)) /
      1024 /
      1024
    ).toFixed(2);
    const mapSize = (
      (await Bun.file(SOURCEMAP_FILE).size) /
      1024 /
      1024
    ).toFixed(2);
    console.log(`    -> ${BUNDLE_JS} (${jsSize} MB)`);
    console.log(`    -> ${SOURCEMAP_FILE} (${mapSize} MB, for Sentry upload)`);
    return true;
  } catch (error) {
    console.error("  Failed to bundle JS:");
    console.error(
      `    ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * Inject debug IDs and upload sourcemap to Sentry.
 *
 * Both injection and upload are done natively — no external binary needed.
 * Uses the chunk-upload + assemble protocol for reliable artifact delivery.
 *
 * Requires SENTRY_AUTH_TOKEN environment variable for upload. Debug ID
 * injection always runs (even without auth token) so local builds get
 * debug IDs for development/testing.
 */
/** Module-level debug ID set by {@link injectDebugIds} for use in {@link uploadSourcemapToSentry}. */
let currentDebugId: string | undefined;

/**
 * Inject debug IDs into the JS and sourcemap. Runs before compilation.
 * The upload happens separately after compilation (see {@link uploadSourcemapToSentry}).
 */
async function injectDebugIds(): Promise<void> {
  // skipSnippet: true — the IIFE snippet breaks ESM (placed before import
  // declarations). The debug ID is instead registered in constants.ts via
  // a build-time __SENTRY_DEBUG_ID__ constant.
  console.log("  Injecting debug IDs...");
  try {
    const { debugId } = await injectDebugId(BUNDLE_JS, SOURCEMAP_FILE, {
      skipSnippet: true,
    });
    currentDebugId = debugId;
    console.log(`    -> Debug ID: ${debugId}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`    Warning: Debug ID injection failed: ${msg}`);
    return;
  }

  // Replace the placeholder UUID with the real debug ID in the JS bundle.
  // Both are 36-char UUIDs so sourcemap character positions stay valid.
  try {
    const jsContent = await Bun.file(BUNDLE_JS).text();
    await Bun.write(
      BUNDLE_JS,
      jsContent.split(PLACEHOLDER_DEBUG_ID).join(currentDebugId)
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `    Warning: Debug ID placeholder replacement failed: ${msg}`
    );
  }
}

/**
 * Upload the (composed) sourcemap to Sentry. Runs after compilation
 * because {@link compileTarget} composes the Bun sourcemap with the
 * esbuild sourcemap first.
 */
async function uploadSourcemapToSentry(): Promise<void> {
  const debugId = currentDebugId;
  if (!debugId) {
    return;
  }

  if (!process.env.SENTRY_AUTH_TOKEN) {
    console.log("  No SENTRY_AUTH_TOKEN, skipping sourcemap upload");
    return;
  }

  console.log(`  Uploading sourcemap to Sentry (release: ${VERSION})...`);

  try {
    // With sourcemap: "linked", Bun's runtime auto-resolves Error.stack
    // paths via the embedded map, producing relative paths like
    // "dist-bin/bin.js". The beforeSend hook normalizes these to absolute
    // ("/dist-bin/bin.js") so the symbolicator's candidate URL generator
    // produces "~/dist-bin/bin.js" — matching our upload URL.
    const dir = BUNDLE_JS.slice(0, BUNDLE_JS.lastIndexOf("/") + 1);
    const urlPrefix = `~/${dir}`;
    const jsBasename = BUNDLE_JS.split("/").pop() ?? "bin.js";
    const mapBasename = SOURCEMAP_FILE.split("/").pop() ?? "bin.js.map";

    await uploadSourcemaps({
      org: "sentry",
      project: "cli",
      release: VERSION,
      files: [
        {
          path: BUNDLE_JS,
          debugId,
          type: "minified_source",
          url: `${urlPrefix}${jsBasename}`,
          sourcemapFilename: mapBasename,
        },
        {
          path: SOURCEMAP_FILE,
          debugId,
          type: "source_map",
          url: `${urlPrefix}${mapBasename}`,
        },
      ],
    });
    console.log("    -> Sourcemap uploaded to Sentry");
  } catch (error) {
    // Non-fatal: don't fail the build if upload fails
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`    Warning: Sourcemap upload failed: ${msg}`);
  }
}

/**
 * Step 2: Compile the pre-bundled JS into a native binary for a target.
 *
 * Uses the JS file produced by {@link bundleJs}. The esbuild sourcemap
 * (JS → original TS) is uploaded to Sentry as-is — no composition needed
 * because `sourcemap: "linked"` causes Bun to embed a sourcemap in the
 * binary that its runtime uses to auto-resolve `Error.stack` positions
 * back to the esbuild output's coordinate space.
 */
async function compileTarget(target: BuildTarget): Promise<boolean> {
  const packageName = getPackageName(target);
  const extension = target.os === "win32" ? ".exe" : "";
  const binaryName = `${packageName}${extension}`;
  const outfile = `dist-bin/${binaryName}`;

  console.log(`  Step 2: Compiling ${packageName}...`);

  // Rename the esbuild map out of the way before Bun.build overwrites it
  // (sourcemap: "linked" writes Bun's own map to bin.js.map).
  // Restored in the finally block so subsequent targets and the upload
  // always find the esbuild map, even if compilation fails.
  const esbuildMapBackup = `${SOURCEMAP_FILE}.esbuild`;
  renameSync(SOURCEMAP_FILE, esbuildMapBackup);

  try {
    const result = await Bun.build({
      entrypoints: [BUNDLE_JS],
      compile: {
        target: getBunTarget(target) as
          | "bun-darwin-arm64"
          | "bun-darwin-x64"
          | "bun-linux-x64"
          | "bun-linux-x64-musl"
          | "bun-linux-arm64"
          | "bun-linux-arm64-musl"
          | "bun-windows-x64",
        outfile,
      },
      // "linked" embeds a sourcemap in the binary. At runtime, Bun's engine
      // auto-resolves Error.stack positions through this embedded map back to
      // the esbuild output positions. The esbuild sourcemap (uploaded to
      // Sentry) then maps those to original TypeScript sources.
      sourcemap: "linked",
      // Minify whitespace and syntax but NOT identifiers to avoid Bun's
      // identifier renaming collision bug (oven-sh/bun#14585).
      minify: { whitespace: true, syntax: true, identifiers: false },
    });

    if (!result.success) {
      console.error(`  Failed to compile ${packageName}:`);
      for (const log of result.logs) {
        console.error(`    ${log}`);
      }
      return false;
    }

    console.log(`    -> ${outfile}`);
  } finally {
    // Restore the esbuild sourcemap (Bun.build wrote its own map).
    renameSync(esbuildMapBackup, SOURCEMAP_FILE);
  }

  // Hole-punch: zero unused ICU data entries so they compress to nearly nothing.
  // Always runs so the smoke test exercises the same binary as the release.
  const hpStats = processBinary(outfile);
  if (hpStats && hpStats.removedEntries > 0) {
    console.log(
      `    -> hole-punched ${hpStats.removedEntries}/${hpStats.totalEntries} ICU entries`
    );
  }

  // On main and release branches (RELEASE_BUILD=1), create gzip-compressed
  // copies for release downloads / GHCR nightly (~70% smaller with hole-punch).
  if (process.env.RELEASE_BUILD) {
    const binary = await Bun.file(outfile).arrayBuffer();
    const compressed = await gzipAsync(Buffer.from(binary), { level: 6 });
    await Bun.write(`${outfile}.gz`, compressed);
    const ratio = (
      (1 - compressed.byteLength / binary.byteLength) *
      100
    ).toFixed(0);
    console.log(`    -> ${outfile}.gz (${ratio}% smaller)`);
  }

  return true;
}

/** Parse target string (e.g., "darwin-x64", "linux-arm64", "linux-x64-musl") into BuildTarget */
function parseTarget(targetStr: string): BuildTarget | null {
  // Handle "windows" alias for "win32"
  const normalized = targetStr.replace("windows-", "win32-");
  const parts = normalized.split("-");
  const os = parts[0] as BuildTarget["os"];
  const arch = parts[1] as BuildTarget["arch"];
  const libc = parts[2] === "musl" ? ("musl" as const) : undefined;

  const target = ALL_TARGETS.find(
    (t) => t.os === os && t.arch === arch && t.libc === libc
  );
  return target ?? null;
}

/** Main build function */
async function build(): Promise<void> {
  const args = process.argv.slice(2);
  const singleBuild = args.includes("--single");
  const targetIndex = args.indexOf("--target");
  const targetArg = targetIndex !== -1 ? args[targetIndex + 1] : null;

  console.log(`\nSentry CLI Build v${VERSION}`);
  console.log("=".repeat(40));

  if (!SENTRY_CLIENT_ID) {
    console.error(
      "\nError: SENTRY_CLIENT_ID environment variable is required."
    );
    console.error("   The CLI requires OAuth to function.");
    console.error("   Set it via: SENTRY_CLIENT_ID=xxx bun run build\n");
    process.exit(1);
  }

  // Determine targets
  let targets: BuildTarget[];

  if (targetArg) {
    // Explicit target specified (for cross-compilation)
    const target = parseTarget(targetArg);
    if (!target) {
      console.error(`Invalid target: ${targetArg}`);
      console.error(
        `Valid targets: ${ALL_TARGETS.map((t) => `${t.os === "win32" ? "windows" : t.os}-${t.arch}${t.libc ? `-${t.libc}` : ""}`).join(", ")}`
      );
      process.exit(1);
    }
    targets = [target];
    console.log(`\nBuilding for target: ${getPackageName(target)}`);
  } else if (singleBuild) {
    const currentTarget = ALL_TARGETS.find(
      (t) => t.os === process.platform && t.arch === process.arch
    );
    if (!currentTarget) {
      console.error(
        `Unsupported platform: ${process.platform}-${process.arch}`
      );
      process.exit(1);
    }
    targets = [currentTarget];
    console.log(
      `\nBuilding for current platform: ${getPackageName(currentTarget)}`
    );
  } else {
    targets = ALL_TARGETS;
    console.log(`\nBuilding for ${targets.length} targets`);
  }

  // Clean and recreate output directory (esbuild requires it to exist)
  await $`rm -rf dist-bin`;
  mkdirSync("dist-bin", { recursive: true });

  console.log("");

  // Step 1: Bundle TS → JS + sourcemap (shared by all targets)
  const bundled = await bundleJs();
  if (!bundled) {
    process.exit(1);
  }

  // Inject debug IDs into the JS and sourcemap (non-fatal on failure).
  // Upload happens AFTER compilation because Bun.build (with sourcemap: "linked")
  // overwrites bin.js.map. We restore it from the saved copy before uploading.
  await injectDebugIds();

  console.log("");

  // Step 2: Compile JS → native binary per target
  let successCount = 0;
  let failCount = 0;

  for (const target of targets) {
    const success = await compileTarget(target);
    if (success) {
      successCount += 1;
    } else {
      failCount += 1;
    }
  }

  // Step 3: Upload the composed sourcemap to Sentry (after compilation)
  await uploadSourcemapToSentry();

  // Clean up intermediate bundle (only the binaries are artifacts)
  await $`rm -f ${BUNDLE_JS} ${SOURCEMAP_FILE}`;

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Build complete: ${successCount} succeeded, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

await build();
