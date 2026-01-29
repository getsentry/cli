#!/usr/bin/env bun
/**
 * Check SKILL.md for Staleness
 *
 * Compares the committed SKILL.md against freshly generated content.
 * If different, outputs a GitHub PR comment with suggestion blocks.
 *
 * Usage:
 *   bun run script/check-skill.ts
 *
 * Exit codes:
 *   0 - SKILL.md is up to date
 *   1 - SKILL.md is stale (outputs suggestion comment to stdout)
 *
 * Environment variables:
 *   GITHUB_OUTPUT - If set, writes 'stale=true/false' for GitHub Actions
 */

import { $ } from "bun";

const SKILL_PATH = "plugins/sentry-cli/skills/sentry-cli/SKILL.md";

// GitHub suggestion blocks have a soft limit; we split into chunks
const MAX_SUGGESTION_LINES = 100;

type DiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

/**
 * Parse unified diff output into hunks
 */
function parseDiffHunks(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffOutput.split("\n");

  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    // Match hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);

    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: Number.parseInt(hunkMatch[1] ?? "1", 10),
        oldCount: Number.parseInt(hunkMatch[2] ?? "1", 10),
        newStart: Number.parseInt(hunkMatch[3] ?? "1", 10),
        newCount: Number.parseInt(hunkMatch[4] ?? "1", 10),
        lines: [],
      };
      continue;
    }

    // Skip diff header lines
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }

    // Collect hunk content
    if (
      currentHunk &&
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
    ) {
      currentHunk.lines.push(line);
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Extract the new content from a diff hunk (lines starting with + or space)
 */
function extractNewContent(hunk: DiffHunk): string[] {
  return hunk.lines
    .filter((line) => line.startsWith("+") || line.startsWith(" "))
    .map((line) => line.slice(1)); // Remove the prefix
}

/**
 * Generate a GitHub suggestion block for a hunk
 */
function generateSuggestionBlock(hunk: DiffHunk, filePath: string): string {
  const newContent = extractNewContent(hunk);

  // Calculate the line range in the original file that this hunk replaces
  const startLine = hunk.oldStart;
  const endLine = hunk.oldStart + hunk.oldCount - 1;

  const lines: string[] = [];

  // Add file path and line reference for context
  lines.push(
    `https://github.com/$\{GITHUB_REPOSITORY}/blob/$\{GITHUB_HEAD_REF}/${filePath}#L${startLine}-L${endLine}`
  );
  lines.push("");
  lines.push("```suggestion");
  lines.push(...newContent);
  lines.push("```");

  return lines.join("\n");
}

/**
 * Generate a full-file suggestion when diff is too complex
 */
function generateFullFileSuggestion(
  newContent: string,
  filePath: string,
  oldLineCount: number
): string {
  const lines: string[] = [];

  lines.push(
    "The entire file needs to be replaced. Apply this suggestion or run `bun run generate:skill` locally."
  );
  lines.push("");
  lines.push(
    `https://github.com/$\{GITHUB_REPOSITORY}/blob/$\{GITHUB_HEAD_REF}/${filePath}#L1-L${oldLineCount}`
  );
  lines.push("");
  lines.push("```suggestion");
  lines.push(newContent.trimEnd());
  lines.push("```");

  return lines.join("\n");
}

/**
 * Generate the PR comment body with suggestions
 */
function generatePRComment(
  hunks: DiffHunk[],
  newContent: string,
  oldLineCount: number
): string {
  const lines: string[] = [];

  lines.push("## 🔄 SKILL.md needs regeneration");
  lines.push("");
  lines.push(
    "The CLI commands have changed but `plugins/sentry-cli/skills/sentry-cli/SKILL.md` hasn't been updated."
  );
  lines.push("");
  lines.push(
    "**To fix:** Run `bun run generate:skill` locally and commit the changes, or apply the suggestion(s) below."
  );
  lines.push("");

  // Calculate total changed lines
  const totalNewLines = hunks.reduce(
    (sum, h) => sum + extractNewContent(h).length,
    0
  );

  // If the diff is small enough, show individual hunks
  // Otherwise, show a full-file replacement
  if (hunks.length <= 3 && totalNewLines <= MAX_SUGGESTION_LINES * 2) {
    lines.push("### Changes");
    lines.push("");

    for (const hunk of hunks) {
      lines.push(generateSuggestionBlock(hunk, SKILL_PATH));
      lines.push("");
    }
  } else {
    lines.push("### Full file replacement");
    lines.push("");
    lines.push(
      generateFullFileSuggestion(newContent, SKILL_PATH, oldLineCount)
    );
  }

  return lines.join("\n");
}

/**
 * Write to GitHub Actions output file if available
 */
async function setGitHubOutput(key: string, value: string): Promise<void> {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const file = Bun.file(outputFile);
    const existing = (await file.exists()) ? await file.text() : "";
    await Bun.write(outputFile, `${existing}${key}=${value}\n`);
  }
}

/**
 * Write multiline value to GitHub Actions output
 */
async function setGitHubOutputMultiline(
  key: string,
  value: string
): Promise<void> {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const delimiter = `EOF_${Date.now()}`;
    const file = Bun.file(outputFile);
    const existing = (await file.exists()) ? await file.text() : "";
    await Bun.write(
      outputFile,
      `${existing}${key}<<${delimiter}\n${value}\n${delimiter}\n`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

// Read the current committed file
const committedFile = Bun.file(SKILL_PATH);
const committedContent = (await committedFile.exists())
  ? await committedFile.text()
  : "";
const oldLineCount = committedContent.split("\n").length;

// Generate fresh content
await $`bun run script/generate-skill.ts`.quiet();

// Read the newly generated content
const newContent = await Bun.file(SKILL_PATH).text();

// Compare
if (committedContent === newContent) {
  console.log("✓ SKILL.md is up to date");
  await setGitHubOutput("stale", "false");
  process.exit(0);
}

// Files differ - generate diff and suggestion
console.error("✗ SKILL.md is out of date");

// Restore the original file for accurate diff
await Bun.write(SKILL_PATH, committedContent);

// Get the diff
const diffResult = await $`git diff --no-color -- ${SKILL_PATH}`
  .nothrow()
  .quiet();

// Write the new content back (so the workflow can use it)
await Bun.write(SKILL_PATH, newContent);

// Parse diff and generate comment
const hunks = parseDiffHunks(diffResult.stdout.toString());
const comment = generatePRComment(hunks, newContent, oldLineCount);

// Output for GitHub Actions
await setGitHubOutput("stale", "true");
await setGitHubOutputMultiline("comment", comment);

// Also output to stdout for local testing
console.log("\n--- PR Comment ---\n");
console.log(comment);

process.exit(1);
