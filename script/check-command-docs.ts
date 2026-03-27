#!/usr/bin/env bun
/**
 * Check Command Documentation for Staleness
 *
 * Compares the auto-generated reference sections of command doc pages
 * against freshly generated content. Only the portion above the
 * GENERATED:END marker is checked — hand-written custom content below
 * the marker is not compared.
 *
 * Usage:
 *   bun run script/check-command-docs.ts
 *
 * Exit codes:
 *   0 - All command docs are up to date
 *   1 - One or more doc pages have stale reference sections
 */

import { $ } from "bun";

const DOCS_DIR = "docs/src/content/docs/commands";
const MARKER = "<!-- GENERATED:END -->";

/**
 * Extract the auto-generated portion of a file (everything up to and
 * including the GENERATED:END marker). Returns the full content if
 * no marker is found.
 */
function extractGeneratedPortion(content: string): string {
  const markerIndex = content.indexOf(MARKER);
  if (markerIndex === -1) {
    return content;
  }
  return content.slice(0, markerIndex + MARKER.length);
}

/**
 * Read all command doc files and extract their generated portions.
 * Returns a map of filename → generated content.
 */
async function readGeneratedPortions(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const glob = new Bun.Glob("*.md");

  for await (const filename of glob.scan({ cwd: DOCS_DIR })) {
    const file = Bun.file(`${DOCS_DIR}/${filename}`);
    const content = await file.text();
    files.set(filename, extractGeneratedPortion(content));
  }

  return files;
}

// Snapshot committed generated portions
const committedPortions = await readGeneratedPortions();

// Regenerate (preserves custom content below markers)
await $`bun run script/generate-command-docs.ts`.quiet();

// Read freshly generated portions
const newPortions = await readGeneratedPortions();

// Compare
const staleFiles: string[] = [];

for (const [filename, newContent] of newPortions) {
  const committedContent = committedPortions.get(filename);
  if (committedContent !== newContent) {
    staleFiles.push(filename);
  }
}

// Check for files that should exist but don't (committed but not generated)
for (const filename of committedPortions.keys()) {
  if (!newPortions.has(filename)) {
    staleFiles.push(`${filename} (unexpected — not generated)`);
  }
}

if (staleFiles.length === 0) {
  console.log("✓ All command docs are up to date");
  process.exit(0);
}

console.error("✗ Command docs are out of date:");
for (const file of staleFiles) {
  console.error(`  - ${file}`);
}
console.error("");
console.error(
  "Run 'bun run generate:command-docs' locally and commit the changes."
);

process.exit(1);
