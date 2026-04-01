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
 *     sentry-linux-x64
 *     sentry-windows-x64.exe
 *     bin.js.map          (sourcemap, uploaded to Sentry then deleted)
 */

import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { processBinary } from "binpunch";
import { $ } from "bun";
import { build as esbuild } from "esbuild";
import pkg from "../package.json";
import { uploadSourcemaps } from "../src/lib/api/sourcemaps.js";
import { injectDebugId } from "./debug-id.js";

const gzipAsync = promisify(gzip);

const VERSION = pkg.version;

/** Build-time constants injected into the binary */
const SENTRY_CLIENT_ID = process.env.SENTRY_CLIENT_ID ?? "";

/** Build targets configuration */
type BuildTarget = {
  os: "darwin" | "linux" | "win32";
  arch: "arm64" | "x64";
};

const ALL_TARGETS: BuildTarget[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "win32", arch: "x64" },
];

/** Get package name for a target (uses "windows" instead of "win32") */
function getPackageName(target: BuildTarget): string {
  const platformName = target.os === "win32" ? "windows" : target.os;
  return `sentry-${platformName}-${target.arch}`;
}

/** Get Bun compile target string */
function getBunTarget(target: BuildTarget): string {
  return `bun-${target.os}-${target.arch}`;
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
      sourcemap: "external",
      minify: true,
      metafile: true,
      define: {
        SENTRY_CLI_VERSION: JSON.stringify(VERSION),
        SENTRY_CLIENT_ID_BUILD: JSON.stringify(SENTRY_CLIENT_ID),
        "process.env.NODE_ENV": JSON.stringify("production"),
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
async function injectAndUploadSourcemap(): Promise<void> {
  // Always inject debug IDs (even without auth token) so local builds
  // get debug IDs for development/testing purposes.
  console.log("  Injecting debug IDs...");
  let debugId: string;
  try {
    ({ debugId } = await injectDebugId(BUNDLE_JS, SOURCEMAP_FILE));
    console.log(`    -> Debug ID: ${debugId}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`    Warning: Debug ID injection failed: ${msg}`);
    return;
  }

  if (!process.env.SENTRY_AUTH_TOKEN) {
    console.log("  No SENTRY_AUTH_TOKEN, skipping sourcemap upload");
    return;
  }

  console.log(`  Uploading sourcemap to Sentry (release: ${VERSION})...`);

  try {
    const urlPrefix = "~/$bunfs/root/";
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
 * Uses the JS file produced by {@link bundleJs} — no sourcemap is embedded
 * in the binary (it's uploaded to Sentry separately).
 */
async function compileTarget(target: BuildTarget): Promise<boolean> {
  const packageName = getPackageName(target);
  const extension = target.os === "win32" ? ".exe" : "";
  const binaryName = `${packageName}${extension}`;
  const outfile = `dist-bin/${binaryName}`;

  console.log(`  Step 2: Compiling ${packageName}...`);

  const result = await Bun.build({
    entrypoints: [BUNDLE_JS],
    compile: {
      target: getBunTarget(target) as
        | "bun-darwin-arm64"
        | "bun-darwin-x64"
        | "bun-linux-x64"
        | "bun-linux-arm64"
        | "bun-windows-x64",
      outfile,
    },
    // Already minified in Step 1 — skip re-minification to avoid
    // double-minifying identifiers and producing different output.
    minify: false,
  });

  if (!result.success) {
    console.error(`  Failed to compile ${packageName}:`);
    for (const log of result.logs) {
      console.error(`    ${log}`);
    }
    return false;
  }

  console.log(`    -> ${outfile}`);

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

/** Parse target string (e.g., "darwin-x64" or "linux-arm64") into BuildTarget */
function parseTarget(targetStr: string): BuildTarget | null {
  // Handle "windows" alias for "win32"
  const normalized = targetStr.replace("windows-", "win32-");
  const [os, arch] = normalized.split("-") as [
    BuildTarget["os"],
    BuildTarget["arch"],
  ];

  const target = ALL_TARGETS.find((t) => t.os === os && t.arch === arch);
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
        `Valid targets: ${ALL_TARGETS.map((t) => `${t.os === "win32" ? "windows" : t.os}-${t.arch}`).join(", ")}`
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

  // Inject debug IDs and upload sourcemap to Sentry before compiling (non-fatal on failure)
  await injectAndUploadSourcemap();

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
