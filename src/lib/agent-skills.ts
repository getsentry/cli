/**
 * Agent skill installation for AI coding assistants.
 *
 * Detects supported agent roots and installs the embedded Sentry CLI
 * skill files without creating new top-level agent directories.
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
 * Get the root directory for an agent skill installation target.
 */
function getSkillRootPath(
  homeDir: string,
  rootDir: ".agents" | ".claude"
): string {
  return join(homeDir, rootDir);
}

/**
 * Check if Claude Code is installed by looking for the ~/.claude directory.
 *
 * Claude Code creates this directory on first use for settings, skills,
 * and other configuration. Its presence is a reliable indicator.
 */
export function detectClaudeCode(homeDir: string): boolean {
  return existsSync(getSkillRootPath(homeDir, ".claude"));
}

/**
 * Check if a shared Agent Skills root already exists.
 *
 * Compatible agents create `~/.agents` when they adopt the shared skills
 * layout, so its presence is the opt-in signal for installing there.
 */
function detectSharedAgentSkillsRoot(homeDir: string): boolean {
  return existsSync(getSkillRootPath(homeDir, ".agents"));
}

/**
 * Get the installation path for the Sentry CLI skill under a supported
 * agent root.
 *
 * `~/.claude` remains the default to preserve the existing helper behavior,
 * while callers can also pass `".agents"` for the shared Agent Skills path.
 */
export function getSkillInstallPath(
  homeDir: string,
  rootDir: ".agents" | ".claude" = ".claude"
): string {
  return join(
    getSkillRootPath(homeDir, rootDir),
    "skills",
    "sentry-cli",
    "SKILL.md"
  );
}

/**
 * Write embedded skill files beneath an already-detected agent root.
 *
 * Callers must ensure the target root exists and is writable before invoking
 * this helper. Returns null on any filesystem failure.
 */
async function writeSkillFiles(
  skillPath: string
): Promise<AgentSkillLocation | null> {
  try {
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

/**
 * Install the embedded skill files for a detected agent root.
 *
 * This helper verifies the target root remains present and writable before
 * attempting to create the nested `skills/sentry-cli` directory tree.
 */
async function installDetectedAgentSkill(
  homeDir: string,
  rootDir: ".agents" | ".claude"
): Promise<AgentSkillLocation | null> {
  const parentDir = getSkillRootPath(homeDir, rootDir);
  if (!existsSync(parentDir)) {
    return null;
  }

  // In sandboxed environments, the agent root may exist but be read-only.
  // Some sandboxes terminate the process on write attempts, bypassing
  // JavaScript error handling, so we must check before writing.
  try {
    accessSync(parentDir, constants.W_OK);
  } catch {
    return null;
  }

  return await writeSkillFiles(getSkillInstallPath(homeDir, rootDir));
}

/**
 * Install the Sentry CLI agent skill for detected AI coding assistants.
 *
 * Installs under any supported root that already exists:
 *
 * - `~/.agents/skills/sentry-cli/` for compatible agents using the shared
 *   Agent Skills layout
 * - `~/.claude/skills/sentry-cli/` when Claude Code is installed
 *
 * The installer never creates top-level agent roots. Their presence is the
 * detection signal that the user already has a compatible agent installed.
 * Each target is independent, so a failure in one location does not block
 * the others.
 *
 * If any target is freshly created, the returned `path` points to that new
 * installation so setup output matches the file that was actually added.
 *
 * @param homeDir - User's home directory
 * @returns Location info if installed to at least one detected target, null otherwise
 */
export async function installAgentSkills(
  homeDir: string
): Promise<AgentSkillLocation | null> {
  const results: AgentSkillLocation[] = [];

  if (detectSharedAgentSkillsRoot(homeDir)) {
    const location = await installDetectedAgentSkill(homeDir, ".agents");
    if (location) {
      results.push(location);
    }
  }

  if (detectClaudeCode(homeDir)) {
    const location = await installDetectedAgentSkill(homeDir, ".claude");
    if (location) {
      results.push(location);
    }
  }

  if (results.length === 0) {
    return null;
  }

  return results.find((location) => location.created) ?? results[0] ?? null;
}
