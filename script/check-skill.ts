#!/usr/bin/env bun
/**
 * Check Skill Files for Staleness
 *
 * Compares committed skill files (SKILL.md, references/*.md, index.json)
 * against freshly generated content.
 *
 * Usage:
 *   bun run script/check-skill.ts
 *
 * Exit codes:
 *   0 - All skill files are up to date
 *   1 - One or more skill files are stale
 */

import { $ } from "bun";

const SKILL_DIR = "plugins/sentry-cli/skills/sentry-cli";
const INDEX_JSON_PATH = "docs/public/.well-known/skills/index.json";

/**
 * Read all .md files under the skill directory + the index.json.
 * Returns a map of relative path → content.
 */
async function readAllSkillFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  // Read SKILL.md
  const skillFile = Bun.file(`${SKILL_DIR}/SKILL.md`);
  if (await skillFile.exists()) {
    files.set("SKILL.md", await skillFile.text());
  }

  // Read references/*.md
  const glob = new Bun.Glob("references/*.md");
  for await (const path of glob.scan({ cwd: SKILL_DIR })) {
    const file = Bun.file(`${SKILL_DIR}/${path}`);
    files.set(path, await file.text());
  }

  // Read index.json
  const indexFile = Bun.file(INDEX_JSON_PATH);
  if (await indexFile.exists()) {
    files.set("index.json", await indexFile.text());
  }

  return files;
}

// Snapshot committed files
const committedFiles = await readAllSkillFiles();

// Regenerate
await $`bun run script/generate-skill.ts`.quiet();

// Read freshly generated files
const newFiles = await readAllSkillFiles();

// Compare
const staleFiles: string[] = [];

// Check for changed or new files
for (const [path, newContent] of newFiles) {
  const committedContent = committedFiles.get(path);
  if (committedContent !== newContent) {
    staleFiles.push(path);
  }
}

// Check for files that were removed (exist in committed but not in new)
for (const path of committedFiles.keys()) {
  if (!newFiles.has(path)) {
    staleFiles.push(`${path} (removed)`);
  }
}

// Check that every reference file contains at least one **Examples:** section.
// This catches cases where doc pages are missing bash code blocks that the
// skill generator needs to populate examples for AI agents.
const missingExamples: string[] = [];
for (const [path, content] of newFiles) {
  if (!path.startsWith("references/")) {
    continue;
  }
  if (!content.includes("**Examples:**")) {
    missingExamples.push(path);
  }
}

const issues: string[] = [];

if (staleFiles.length > 0) {
  issues.push("Skill files are out of date:");
  for (const file of staleFiles) {
    issues.push(`  - ${file}`);
  }
  issues.push("");
  issues.push("Run 'bun run generate:skill' locally and commit the changes.");
}

if (missingExamples.length > 0) {
  if (issues.length > 0) {
    issues.push("");
  }
  issues.push("Skill reference files missing examples:");
  for (const file of missingExamples) {
    issues.push(`  - ${file}`);
  }
  issues.push("");
  issues.push(
    "Add bash code blocks to the matching docs/src/content/docs/commands/ pages"
  );
  issues.push("and re-run 'bun run generate:skill' to populate examples.");
}

if (issues.length === 0) {
  console.log("✓ All skill files are up to date");
  process.exit(0);
}

for (const line of issues) {
  console.error(line.startsWith("  ") ? line : `✗ ${line}`);
}

process.exit(1);
