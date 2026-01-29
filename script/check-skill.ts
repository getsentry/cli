#!/usr/bin/env bun
/**
 * Check SKILL.md for Staleness
 *
 * Compares the committed SKILL.md against freshly generated content.
 *
 * Usage:
 *   bun run script/check-skill.ts
 *
 * Exit codes:
 *   0 - SKILL.md is up to date
 *   1 - SKILL.md is stale
 */

import { $ } from "bun";

const SKILL_PATH = "plugins/sentry-cli/skills/sentry-cli/SKILL.md";

// Read the current committed file
const committedFile = Bun.file(SKILL_PATH);
const committedContent = (await committedFile.exists())
  ? await committedFile.text()
  : "";

// Generate fresh content
await $`bun run script/generate-skill.ts`.quiet();

// Read the newly generated content
const newContent = await Bun.file(SKILL_PATH).text();

// Compare
if (committedContent === newContent) {
  console.log("✓ SKILL.md is up to date");
  process.exit(0);
}

// Files differ
console.error("✗ SKILL.md is out of date");
console.error("");
console.error("Run 'bun run generate:skill' locally and commit the changes.");

process.exit(1);
