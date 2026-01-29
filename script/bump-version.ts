#!/usr/bin/env bun
/**
 * Version Bump Script
 *
 * Handles version bumping for releases, keeping package.json and plugin.json in sync.
 * Extracted from .craft.yml inline scripts for maintainability.
 *
 * Usage:
 *   bun run script/bump-version.ts --pre   # Pre-release: set CRAFT_NEW_VERSION
 *   bun run script/bump-version.ts --post  # Post-release: bump to next dev version
 *
 * Pre-release (--pre):
 *   - Sets package.json version to CRAFT_NEW_VERSION
 *   - Updates plugin.json version (strips prerelease suffix)
 *
 * Post-release (--post):
 *   - Bumps package.json to next preminor with -dev prerelease
 *   - Updates plugin.json version
 *   - Commits and pushes if there are changes
 */

import { $ } from "bun";

const PLUGIN_PATH = "plugins/sentry-cli/.claude-plugin/plugin.json";

type PluginJson = {
  version: string;
  [key: string]: unknown;
};

/**
 * Read and parse plugin.json
 */
async function readPluginJson(): Promise<PluginJson> {
  const file = Bun.file(PLUGIN_PATH);
  return (await file.json()) as PluginJson;
}

/**
 * Write plugin.json with consistent formatting
 */
async function writePluginJson(plugin: PluginJson): Promise<void> {
  await Bun.write(PLUGIN_PATH, `${JSON.stringify(plugin, null, 2)}\n`);
}

/**
 * Strip prerelease suffix from version string.
 * "1.0.0-dev.0" → "1.0.0"
 * "1.0.0" → "1.0.0"
 */
function stripPrerelease(version: string): string {
  return version.replace(/-.*$/, "");
}

/**
 * Pre-release: Set version from CRAFT_NEW_VERSION environment variable
 */
async function preRelease(): Promise<void> {
  const version = process.env.CRAFT_NEW_VERSION;
  if (!version) {
    console.error("Error: CRAFT_NEW_VERSION environment variable is required");
    process.exit(1);
  }

  console.log(`Setting version to ${version}`);

  // Update package.json via npm (handles formatting consistently)
  await $`npm --no-git-tag-version version ${version}`;

  // Update plugin.json (strip prerelease suffix for cleaner version)
  const plugin = await readPluginJson();
  plugin.version = stripPrerelease(version);
  await writePluginJson(plugin);

  console.log(`Updated plugin.json to ${plugin.version}`);
}

/**
 * Post-release: Bump to next dev version, commit and push
 */
async function postRelease(): Promise<void> {
  console.log("Bumping to next development version");

  // Bump package.json to next preminor with -dev prerelease
  await $`npm --no-git-tag-version version preminor --preid=dev`;

  // Read the new version from package.json
  const pkg = (await Bun.file("package.json").json()) as { version: string };
  console.log(`package.json bumped to ${pkg.version}`);

  // Update plugin.json
  const plugin = await readPluginJson();
  plugin.version = stripPrerelease(pkg.version);
  await writePluginJson(plugin);
  console.log(`Updated plugin.json to ${plugin.version}`);

  // Commit and push if there are changes
  const diffResult = await $`git diff --quiet`.nothrow();
  if (diffResult.exitCode !== 0) {
    console.log("Committing version bump");
    await $`git commit -anm ${"meta: Bump new development version\n\n#skip-changelog"}`;
    await $`git pull --rebase`;
    await $`git push`;
    console.log("Pushed version bump");
  } else {
    console.log("No changes to commit");
  }
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Usage: bun run script/bump-version.ts <mode>

Modes:
  --pre   Pre-release: set version from CRAFT_NEW_VERSION env var
  --post  Post-release: bump to next dev version, commit and push

Examples:
  CRAFT_NEW_VERSION=1.0.0 bun run script/bump-version.ts --pre
  bun run script/bump-version.ts --post
`);
}

// Main
const args = process.argv.slice(2);
const mode = args.includes("--pre")
  ? "pre"
  : args.includes("--post")
    ? "post"
    : null;

if (!mode) {
  printUsage();
  process.exit(1);
}

if (mode === "pre") {
  await preRelease();
} else {
  await postRelease();
}
