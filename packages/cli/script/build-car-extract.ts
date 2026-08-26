#!/usr/bin/env tsx

/**
 * Compile the `car-extract` native helper (Swift → macho binary).
 *
 * `car-extract` decodes iOS `Assets.car` renditions to PNGs via the private
 * macOS CoreUI framework — the one part of build-upload that genuinely needs a
 * Mac. It is compiled only for the `darwin-arm64` target and embedded into that
 * SEA binary as an asset (see `build.ts`), and used at runtime by
 * `src/lib/build/asset-catalog-extract.ts`. Every other platform ships without
 * it and falls back to the pure-TS size manifest.
 *
 * Returns the path to the compiled binary, or `null` when compilation isn't
 * possible (not on macOS, or `swiftc` unavailable) — the caller then builds
 * without embedding the helper.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Source and output paths for the helper, relative to package root. */
const SOURCE = "native/car-extract/main.swift";
const OUTPUT = "native/car-extract/car-extract";

/** Whether `swiftc` is on PATH. */
function hasSwiftc(): boolean {
  try {
    execFileSync("swiftc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Compile the helper for macOS arm64. No-op (returns null) off macOS or when
 * `swiftc` is missing.
 */
export function buildCarExtract(): string | null {
  if (process.platform !== "darwin") {
    console.log("  car-extract: skipped (not macOS)");
    return null;
  }
  if (!hasSwiftc()) {
    console.log("  car-extract: skipped (swiftc not found)");
    return null;
  }
  if (!existsSync(SOURCE)) {
    console.log(`  car-extract: skipped (missing ${SOURCE})`);
    return null;
  }

  console.log("  Compiling car-extract (Swift → macho)...");
  execFileSync(
    "swiftc",
    [
      "-O",
      "-target",
      "arm64-apple-macos11",
      "-o",
      OUTPUT,
      SOURCE,
      "-framework",
      "Foundation",
      "-framework",
      "CoreGraphics",
      "-framework",
      "ImageIO",
    ],
    { stdio: "inherit" }
  );
  console.log(`    -> ${OUTPUT}`);
  return OUTPUT;
}

// Allow running standalone (`tsx script/build-car-extract.ts`) for local dev.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = buildCarExtract();
  if (!out) {
    process.exit(0);
  }
}
