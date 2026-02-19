#!/usr/bin/env bun

/**
 * Pack script for Sentry CLI NuGet packages
 *
 * Creates platform-specific NuGet packages with embedded native binaries,
 * as well as the required top-level pointer package and the RID-agnostic package as fallback.
 * The .NET equivalent of build.ts — same target model, same CLI flags, but dependent on its output at "dist-bin/".
 *
 * Usage:
 *   bun run script/pack.ts                        # Pack for current platform + root + any packages
 *   bun run script/pack.ts --agnostic             # Pack only root + any packages (no platform-specific)
 *   bun run script/pack.ts --single               # Pack for current platform only (no root/any)
 *   bun run script/pack.ts --target darwin-x64    # Pack for a specific target only (no root/any)
 *
 * Flags:
 *   --no-clean    Skip cleaning the dist-pkg directory before packing
 *
 * Output:
 *   dist-pkg/
 *     dotnet-sentry.<version>.nupkg              # Root package (pointer, no RID)
 *     dotnet-sentry.any.<version>.nupkg          # Framework-dependent, RID-agnostic package as fallback
 *     dotnet-sentry.osx-arm64.<version>.nupkg    # RID-specific package for macOS ARM64
 *     dotnet-sentry.osx-x64.<version>.nupkg      # RID-specific package for macOS x64
 *     dotnet-sentry.linux-arm64.<version>.nupkg  # RID-specific package for Linux ARM64
 *     dotnet-sentry.linux-x64.<version>.nupkg    # RID-specific package for Linux x64
 *     dotnet-sentry.win-x64.<version>.nupkg      # RID-specific package for Windows x64
 */

import { $ } from "bun";
import pkg from "../package.json";

const PROJECT_DIR = "src/dotnet/Sentry.Cli";
const DIST_BIN_DIR = "dist-bin";
const DIST_PKG_DIR = "dist-pkg";
const PACKAGE_ID = "dotnet-sentry";

/** Compute the expected .nupkg output path for a given RID (omit for root package) */
function getNupkgPath(version: string, rid?: string): string {
  const prefix = rid ? `.${rid}` : "";
  return `${DIST_PKG_DIR}/${PACKAGE_ID}${prefix}.${version}.nupkg`;
}

/** Pack targets configuration */
type PackTarget = {
  os: "darwin" | "linux" | "win32";
  arch: "arm64" | "x64";
};

const ALL_TARGETS: PackTarget[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "win32", arch: "x64" },
];

/** Get package name for a target (uses "windows" instead of "win32") */
function getPackageName(target: PackTarget): string {
  const platformName = target.os === "win32" ? "windows" : target.os;
  return `sentry-${platformName}-${target.arch}`;
}

/** Get binary file name for a target */
function getBinaryName(target: PackTarget): string {
  const extension = target.os === "win32" ? ".exe" : "";
  return `${getPackageName(target)}${extension}`;
}

/** Get .NET Runtime Identifier for a target */
function getDotnetRid(target: PackTarget): string {
  if (target.os === "darwin") {
    return `osx-${target.arch}`;
  }
  if (target.os === "win32") {
    return `win-${target.arch}`;
  }
  return `${target.os}-${target.arch}`;
}

/** Parse target string (e.g., "darwin-x64" or "linux-arm64") into PackTarget */
function parseTarget(targetStr: string): PackTarget | null {
  // Handle "windows" alias for "win32"
  const normalized = targetStr.replace("windows-", "win32-");
  const [os, arch] = normalized.split("-") as [
    PackTarget["os"],
    PackTarget["arch"],
  ];

  const target = ALL_TARGETS.find((t) => t.os === os && t.arch === arch);
  return target ?? null;
}

/** Pack a platform-specific NuGet package with embedded native binary */
async function packTarget(
  target: PackTarget,
  version: string
): Promise<boolean> {
  const rid = getDotnetRid(target);
  const packageName = getPackageName(target);
  const outfile = getNupkgPath(version, rid);
  console.log(`  Packing ${packageName} (${rid})...`);

  try {
    await $`dotnet pack ${PROJECT_DIR} -c Release -r ${rid} -p:PackageVersion=${version} -p:PublishAot=true`.quiet();
    console.log(`    -> ${outfile}`);
    return true;
  } catch (error) {
    console.error(`  Failed to pack ${packageName}:`);
    console.error(error);
    return false;
  }
}

/** Pack the "any" (framework-dependent, CoreCLR) package */
async function packAny(version: string): Promise<boolean> {
  const outfile = getNupkgPath(version, "any");
  console.log("  Packing any (framework-dependent)...");

  try {
    await $`dotnet pack ${PROJECT_DIR} -c Release -r any -p:PackageVersion=${version} -p:PublishAot=false`.quiet();
    console.log(`    -> ${outfile}`);
    return true;
  } catch (error) {
    console.error("  Failed to pack any:");
    console.error(error);
    return false;
  }
}

/** Pack the root package (no RID — pointer/manifest package) */
async function packRoot(version: string): Promise<boolean> {
  const outfile = getNupkgPath(version);
  console.log("  Packing root (no RID)...");

  try {
    await $`dotnet pack ${PROJECT_DIR} -c Release -p:PackageVersion=${version} -p:PublishAot=true`.quiet();
    console.log(`    -> ${outfile}`);
    return true;
  } catch (error) {
    console.error("  Failed to pack root:");
    console.error(error);
    return false;
  }
}

type PackMode = {
  /** Platform-specific targets to pack */
  targets: PackTarget[];
  /** Whether to also pack the root (pointer) and any (agnostic) packages */
  includeAgnostic: boolean;
};

/** Resolve pack mode from CLI args, printing a status line and exiting on error */
function resolveMode(args: string[]): PackMode {
  if (args.includes("--agnostic")) {
    console.log("\nPacking agnostic packages (root + any)");
    return { targets: [], includeAgnostic: true };
  }

  const targetIndex = args.indexOf("--target");
  const targetArg = targetIndex !== -1 ? args[targetIndex + 1] : null;

  if (targetArg) {
    const target = parseTarget(targetArg);
    if (!target) {
      console.error(`Invalid target: ${targetArg}`);
      console.error(
        `Valid targets: ${ALL_TARGETS.map((t) => `${t.os === "win32" ? "windows" : t.os}-${t.arch}`).join(", ")}`
      );
      process.exit(1);
    }
    console.log(`\nPacking for target: ${getPackageName(target)}`);
    return { targets: [target], includeAgnostic: false };
  }

  const currentTarget = ALL_TARGETS.find(
    (t) => t.os === process.platform && t.arch === process.arch
  );
  if (!currentTarget) {
    console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
    process.exit(1);
  }

  if (args.includes("--single")) {
    console.log(
      `\nPacking for current platform: ${getPackageName(currentTarget)}`
    );
    return { targets: [currentTarget], includeAgnostic: false };
  }

  // Default: current platform + agnostic packages
  console.log(
    `\nPacking for current platform + agnostic packages: ${getPackageName(currentTarget)}`
  );
  return { targets: [currentTarget], includeAgnostic: true };
}

/** Verify that native binaries exist for all targets, exiting on missing files */
async function verifyBinaries(targets: PackTarget[]): Promise<void> {
  console.log("\nVerifying native binaries...");
  let binaryMissing = false;
  for (const target of targets) {
    const binaryPath = `${DIST_BIN_DIR}/${getBinaryName(target)}`;
    if (await Bun.file(binaryPath).exists()) {
      console.log(`  ✓ ${binaryPath}`);
    } else {
      console.error(`  ✗ ${binaryPath} not found`);
      binaryMissing = true;
    }
  }
  if (binaryMissing) {
    console.error("\nError: Some native binaries are missing.");
    console.error("Run 'bun run build:all' first to generate all binaries.");
    process.exit(1);
  }
}

/** Main pack function */
async function pack(): Promise<void> {
  const args = process.argv.slice(2);
  const noClean = args.includes("--no-clean");

  console.log(`\nSentry CLI NuGet Pack v${pkg.version}`);
  console.log("=".repeat(40));

  const mode = resolveMode(args);

  if (mode.targets.length > 0) {
    await verifyBinaries(mode.targets);
  }

  // Clean output directory (unless --no-clean is specified)
  if (!noClean) {
    await $`rm -rf ${DIST_PKG_DIR}`.quiet();
  }

  console.log("");

  let successCount = 0;
  let failCount = 0;

  // Root package (no RID) and any package — only when includeAgnostic is set
  if (mode.includeAgnostic) {
    if (await packRoot(pkg.version)) {
      successCount += 1;
    } else {
      failCount += 1;
    }

    if (await packAny(pkg.version)) {
      successCount += 1;
    } else {
      failCount += 1;
    }
  }

  // Platform-specific packages
  for (const target of mode.targets) {
    if (await packTarget(target, pkg.version)) {
      successCount += 1;
    } else {
      failCount += 1;
    }
  }

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Pack complete: ${successCount} succeeded, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

await pack();
