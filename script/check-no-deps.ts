#!/usr/bin/env bun
/**
 * Check for Runtime Dependencies
 *
 * Ensures package.json has no `dependencies` field. All packages must be
 * listed under `devDependencies` and bundled at build time via esbuild
 * (npm bundle) or Bun.build (standalone binary). This keeps the published
 * package at zero install-time dependencies.
 *
 * Usage:
 *   bun run script/check-no-deps.ts
 *
 * Exit codes:
 *   0 - No runtime dependencies found
 *   1 - Runtime dependencies detected
 */

const pkg: { dependencies?: Record<string, string> } =
  await Bun.file("package.json").json();

const deps = Object.keys(pkg.dependencies ?? {});
export {};

if (deps.length === 0) {
  console.log("✓ No runtime dependencies in package.json");
  process.exit(0);
}

console.error("✗ Found runtime dependencies in package.json:");
console.error("");
for (const dep of deps) {
  console.error(`  - ${dep}: ${pkg.dependencies?.[dep]}`);
}
console.error("");
console.error(
  "All packages must be in devDependencies and bundled at build time."
);
console.error(
  "Move these to devDependencies: bun remove <pkg> && bun add -d <pkg>"
);

process.exit(1);
