/**
 * Agent skill installation for AI coding assistants.
 *
 * Detects supported AI coding agents (currently Claude Code) and installs
 * the Sentry CLI skill files so the agent can use CLI commands effectively.
 *
 * Skill file contents are embedded at build time (via a generated module
 * produced by script/generate-skill.ts), so no network fetch is needed.
 */

import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { captureException } from "@sentry/node-core/light";
import { SKILL_FILES } from "../generated/skill-content.js";

/** Where skills are installed */
export type AgentSkillLocation = {
  /** Path where the main skill file was installed */
  path: string;
  /** Whether the file was created or already existed */
  created: boolean;
  /** Number of reference files installed */
  referenceCount: number;
};

/**
 * Check if Claude Code is installed by looking for the ~/.claude directory.
 *
 * Claude Code creates this directory on first use for settings, skills,
 * and other configuration. Its presence is a reliable indicator.
 */
export function detectClaudeCode(homeDir: string): boolean {
  return existsSync(join(homeDir, ".claude"));
}

/**
 * Get the installation path for the Sentry CLI skill in Claude Code.
 *
 * Skills are stored under ~/.claude/skills/<skill-name>/SKILL.md,
 * matching the convention used by the `npx skills` tool.
 */
export function getSkillInstallPath(homeDir: string): string {
  return join(homeDir, ".claude", "skills", "sentry-cli", "SKILL.md");
}

/**
 * Install the Sentry CLI agent skill for Claude Code.
 *
 * Checks if Claude Code is installed and writes the embedded skill files
 * to the Claude Code skills directory. Skill content is bundled into the
 * binary at build time, so no network access is required.
 *
 * Returns null (without throwing) if Claude Code isn't detected
 * or any other error occurs.
 *
 * @param homeDir - User's home directory
 * @returns Location info if installed, null otherwise
 */
export async function installAgentSkills(
  homeDir: string
): Promise<AgentSkillLocation | null> {
  if (!detectClaudeCode(homeDir)) {
    return null;
  }

  // Verify .claude is writable before attempting file creation.
  // In sandboxed environments (e.g., Claude Code sandbox), .claude may exist
  // but be read-only. Some sandboxes terminate the process on write attempts,
  // bypassing JavaScript error handling — so we must check before writing.
  try {
    accessSync(join(homeDir, ".claude"), constants.W_OK);
  } catch {
    return null;
  }

  try {
    const skillPath = getSkillInstallPath(homeDir);
    const skillDir = dirname(skillPath);

    const alreadyExists = existsSync(skillPath);
    let referenceCount = 0;

    for (const [relativePath, content] of SKILL_FILES) {
      const fullPath = join(skillDir, relativePath);
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o755 });
      }
      await Bun.write(fullPath, content);
      if (relativePath.startsWith("references/")) {
        referenceCount += 1;
      }
    }

    return {
      path: skillPath,
      created: !alreadyExists,
      referenceCount,
    };
  } catch (error) {
    captureException(error, {
      level: "warning",
      tags: { "setup.step": "agent-skills" },
    });
    return null;
  }
}
