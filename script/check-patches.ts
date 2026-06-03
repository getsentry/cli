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
 * Beyond version matching, this script runs CONTENT assertions that verify a
 * patch's *effect* is actually present in the installed package. This guards
 * against a class of silent failure: when a dependency is bumped and the patch
 * fails to apply (line-number/context drift), pnpm only WARNS and installs the
 * unpatched package — re-introducing whatever the patch fixed. A version-only
 * check would still pass in that case, so content assertions are the real
 * safety net.
 *
 * Known-fragile patch — @stricli/core (`-H` alias):
 *   The @stricli/core patch frees the `-H` short alias (Stricli hardcodes it
 *   for `--help-all`) so the `api` command can use `-H` for `--header`,
 *   gh-style. The patch edits exact line-context in BOTH `dist/index.js` (ESM)
 *   and `dist/index.cjs` (CJS). It WILL break on any @stricli/core version bump
 *   that shifts those lines. Upstreaming a config option for this is unlikely
 *   to be accepted, so the patch is a permanent maintenance cost: on every
 *   Stricli bump, expect to regenerate it (`pnpm patch @stricli/core`, reapply
 *   the four edits per file, `pnpm patch-commit`) and rename the patch file to
 *   the new version. This content check fails loudly if the bump silently
 *   dropped the patch.
 *
 * Usage:
 *   tsx script/check-patches.ts
 *
 * Exit codes:
 *   0 - All patch versions match (or only non-critical warnings) and all
 *       content assertions pass
 *   1 - A patched package is missing entirely, OR a content assertion failed
 *       (patch did not apply to the installed package)
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

/**
 * Content assertions: verify a patch's *effect* is present in the installed
 * package, not just that the version matches. Each entry checks that a stale
 * (pre-patch) marker is absent from a given installed file. If the marker is
 * still present, the patch did not apply and we fail hard.
 *
 * @stricli/core: the unpatched source registers `-H` as the reserved alias for
 * `--help-all` via `checkForReservedAliases(aliases, ["h", "H"])`. After our
 * patch that becomes `["h"]`. The presence of `"H"` in that call is a reliable
 * signal that the patch did NOT apply (in either the ESM or CJS bundle).
 */
const CONTENT_ASSERTIONS: ReadonlyArray<{
  /** Installed file to inspect, relative to repo root. */
  file: string;
  /** Stale marker that MUST be absent once the patch is applied. */
  staleMarker: string;
  /** Human-readable explanation shown on failure. */
  description: string;
}> = [
  {
    file: "node_modules/@stricli/core/dist/index.js",
    staleMarker: 'checkForReservedAliases(aliases, ["h", "H"])',
    description:
      "@stricli/core ESM: -H alias not freed (api -H/--header will crash)",
  },
  {
    file: "node_modules/@stricli/core/dist/index.cjs",
    staleMarker: 'checkForReservedAliases(aliases, ["h", "H"])',
    description:
      "@stricli/core CJS: -H alias not freed (api -H/--header will crash)",
  },
];

for (const assertion of CONTENT_ASSERTIONS) {
  try {
    const contents = await readFile(assertion.file, "utf-8");
    if (contents.includes(assertion.staleMarker)) {
      errors.push(
        `  ${assertion.description} — patch not applied to ${assertion.file} (regenerate the patch for the current dependency version)`
      );
    }
  } catch {
    errors.push(
      `  ${assertion.description} — could not read ${assertion.file} (run pnpm install)`
    );
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
  console.error("✗ Patch problems detected:");
  console.error("");
  for (const e of errors) {
    console.error(e);
  }
  console.error("");
  console.error(
    "A missing package is fixed by `pnpm install`. A content-assertion failure"
  );
  console.error(
    "means the patch no longer applies (likely a dependency bump) — regenerate"
  );
  console.error("it with `pnpm patch <name>` and re-commit.");
  process.exit(1);
}

if (warnings.length === 0) {
  console.log("✓ All patched dependency versions match installed versions");
} else {
  console.log(
    `✓ Patches applied (${warnings.length} version mismatch warning(s) — consider regenerating)`
  );
}
