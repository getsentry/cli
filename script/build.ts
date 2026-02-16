#!/usr/bin/env bun

/**
 * Build script for Sentry CLI
 *
 * Creates standalone executables for multiple platforms using Bun.build().
 * Binaries are uploaded to GitHub Releases.
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
 */

import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { $ } from "bun";
import pkg from "../package.json";
import { processBinary } from "./hole-punch.js";

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

/** Build for a single target */
async function buildTarget(target: BuildTarget): Promise<boolean> {
  const packageName = getPackageName(target);
  const extension = target.os === "win32" ? ".exe" : "";
  const binaryName = `${packageName}${extension}`;
  const outfile = `dist-bin/${binaryName}`;

  console.log(`  Building ${packageName}...`);

  // Create directory structure
  await $`mkdir -p dist-bin`;

  const result = await Bun.build({
    entrypoints: ["./src/bin.ts"],
    compile: {
      target: getBunTarget(target) as
        | "bun-darwin-arm64"
        | "bun-darwin-x64"
        | "bun-linux-x64"
        | "bun-linux-arm64"
        | "bun-windows-x64",
      outfile,
    },
    define: {
      SENTRY_CLI_VERSION: JSON.stringify(VERSION),
      SENTRY_CLIENT_ID_BUILD: JSON.stringify(SENTRY_CLIENT_ID),
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    minify: true, // Shrink bundled JS (-1% binary size, -8% startup, -4% memory)
  });

  if (!result.success) {
    console.error(`  Failed to build ${packageName}:`);
    for (const log of result.logs) {
      console.error(`    ${log}`);
    }
    return false;
  }

  console.log(`    -> ${outfile}`);

  // Hole-punch: zero unused ICU data entries so they compress to nearly nothing.
  // Must run before gzip so the compressed output benefits from zeroed regions.
  const hpStats = processBinary(outfile);
  if (hpStats && hpStats.removedEntries > 0) {
    console.log(
      `    -> hole-punched ${hpStats.removedEntries}/${hpStats.totalEntries} ICU entries`
    );
  }

  // In CI, create gzip-compressed copies for release downloads.
  // With hole-punch, reduces download size by ~70% (99 MB → 28 MB).
  if (process.env.CI) {
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

  // Clean output directory
  await $`rm -rf dist-bin`;

  console.log("");

  // Build all targets
  let successCount = 0;
  let failCount = 0;

  for (const target of targets) {
    const success = await buildTarget(target);
    if (success) {
      successCount += 1;
    } else {
      failCount += 1;
    }
  }

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Build complete: ${successCount} succeeded, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

await build();
