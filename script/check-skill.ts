#!/usr/bin/env bun
/**
 * Check Skill Files for Staleness
 *
 * Compares committed skill files against freshly generated content.
 * Checks the index SKILL.md, all reference files, and index.json.
 *
 * Usage:
 *   bun run script/check-skill.ts
 *
 * Exit codes:
 *   0 - All skill files are up to date
 *   1 - One or more skill files are stale
 */

import { readdirSync } from "node:fs";
import { $ } from "bun";

const SKILL_DIR = "plugins/sentry-cli/skills/sentry-cli";
const INDEX_JSON_PATH = "docs/public/.well-known/skills/index.json";

/**
 * Recursively collect all files under a directory, returning paths relative to the base.
 */
function collectFiles(dir: string, base = dir): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, base));
    } else {
      files.push(fullPath.slice(base.length + 1));
    }
  }
  return files.sort();
}

/**
 * Read file content, returning empty string if it doesn't exist.
 */
async function readFileContent(path: string): Promise<string> {
  const file = Bun.file(path);
  return (await file.exists()) ? await file.text() : "";
}

// Snapshot committed state
const committedSkillFiles = collectFiles(SKILL_DIR);
const committedContents = new Map<string, string>();
for (const relPath of committedSkillFiles) {
  committedContents.set(
    relPath,
    await readFileContent(`${SKILL_DIR}/${relPath}`)
  );
}
const committedIndexJson = await readFileContent(INDEX_JSON_PATH);

// Generate fresh content
await $`bun run script/generate-skill.ts`.quiet();

// Snapshot generated state
const generatedSkillFiles = collectFiles(SKILL_DIR);
const generatedContents = new Map<string, string>();
for (const relPath of generatedSkillFiles) {
  generatedContents.set(
    relPath,
    await readFileContent(`${SKILL_DIR}/${relPath}`)
  );
}
const generatedIndexJson = await readFileContent(INDEX_JSON_PATH);

// Compare
const staleFiles: string[] = [];
const missingFiles: string[] = [];
const extraFiles: string[] = [];

// Check for files that should exist but are missing or stale
for (const relPath of generatedSkillFiles) {
  if (!committedContents.has(relPath)) {
    missingFiles.push(relPath);
  } else if (committedContents.get(relPath) !== generatedContents.get(relPath)) {
    staleFiles.push(relPath);
  }
}

// Check for files that exist but shouldn't
for (const relPath of committedSkillFiles) {
  if (!generatedContents.has(relPath)) {
    extraFiles.push(relPath);
  }
}

// Check index.json
if (committedIndexJson !== generatedIndexJson) {
  staleFiles.push("docs/public/.well-known/skills/index.json");
}

const hasIssues =
  staleFiles.length > 0 || missingFiles.length > 0 || extraFiles.length > 0;

if (!hasIssues) {
  console.log("✓ All skill files are up to date");
  process.exit(0);
}

// Report issues
console.error("✗ Skill files are out of date");
console.error("");

if (staleFiles.length > 0) {
  console.error("Stale files:");
  for (const f of staleFiles) {
    console.error(`  - ${f}`);
  }
}

if (missingFiles.length > 0) {
  console.error("Missing files:");
  for (const f of missingFiles) {
    console.error(`  - ${f}`);
  }
}

if (extraFiles.length > 0) {
  console.error("Extra files (should be removed):");
  for (const f of extraFiles) {
    console.error(`  - ${f}`);
  }
}

console.error("");
console.error("Run 'bun run generate:skill' locally and commit the changes.");

process.exit(1);
