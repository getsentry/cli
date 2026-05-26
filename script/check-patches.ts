#!/usr/bin/env tsx
/**
 * Check Patched Dependency Versions
 *
 * Verifies that pnpm patchedDependencies target versions match installed versions.
 * Name-only keys in patchedDependencies (pnpm 10+ catalog style) apply patches
 * to whatever version resolves. If the installed version doesn't match the
 * patch file's target version, the patch may silently fail to apply.
 *
 * Mismatches are surfaced as warnings (not hard failures) because pnpm 10
 * name-only keys intentionally support version-agnostic patching — patches
 * often apply cleanly across minor/patch bumps. The warning ensures engineers
 * notice and can regenerate the patch if needed.
 *
 * Usage:
 *   tsx script/check-patches.ts
 *
 * Exit codes:
 *   0 - All patch versions match, or mismatches are non-critical (warnings)
 *   1 - A patched package is missing entirely
 */

import { readFile } from "node:fs/promises";

const pkg: {
  pnpm?: { patchedDependencies?: Record<string, string> };
} = JSON.parse(await readFile("package.json", "utf-8"));

const patches = pkg.pnpm?.patchedDependencies ?? {};
const warnings: string[] = [];
const errors: string[] = [];

for (const [name, patchPath] of Object.entries(patches)) {
  // Extract version from patch path: "patches/@stricli%2Fcore@1.2.5.patch" → "1.2.5"
  // Handles pre-release versions like "1.2.3-beta.1" by matching everything after @M.N.P until .patch
  const versionMatch = patchPath.match(/@(\d+\.\d+\.\d+[^@]*)\.patch$/);
  if (!versionMatch) {
    warnings.push(
      `  ? ${name}: could not extract version from patch path "${patchPath}"`
    );
    continue;
  }
  const patchVersion = versionMatch[1];

  // Resolve installed version
  const pkgJsonPath = `node_modules/${name}/package.json`;
  try {
    const installed: { version: string } = JSON.parse(
      await readFile(pkgJsonPath, "utf-8")
    );
    if (installed.version !== patchVersion) {
      warnings.push(
        `  ${name}: patch targets ${patchVersion}, installed ${installed.version} — regenerate with: pnpm patch ${name}`
      );
    }
  } catch {
    errors.push(`  ${name}: not installed (expected ${patchVersion})`);
  }
}

// Emit GitHub Actions annotations for CI visibility
const isCI = !!process.env.CI;
for (const w of warnings) {
  if (isCI) {
    console.log(`::warning::Patch version mismatch:${w.trim()}`);
  } else {
    console.warn(`⚠ ${w}`);
  }
}

if (errors.length > 0) {
  console.error("✗ Missing patched dependencies:");
  console.error("");
  for (const e of errors) {
    console.error(e);
  }
  console.error("");
  console.error("Run pnpm install to install missing dependencies.");
  process.exit(1);
}

if (warnings.length === 0) {
  console.log("✓ All patched dependency versions match installed versions");
} else {
  console.log(
    `✓ Patches applied (${warnings.length} version mismatch warning(s) — consider regenerating)`
  );
}
