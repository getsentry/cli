/**
 * Agent skill installation for AI coding assistants.
 *
 * Detects supported AI coding agents (currently Claude Code) and installs
 * the Sentry CLI skill file so the agent can use CLI commands effectively.
 *
 * The skill content is fetched from GitHub, version-pinned to the installed
 * CLI version to avoid documenting commands that don't exist in the binary.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getUserAgent } from "./constants.js";

/** Where completions are installed */
export type AgentSkillLocation = {
  /** Path where the skill file was installed */
  path: string;
  /** Whether the file was created or already existed */
  created: boolean;
};

/**
 * Base URL for fetching version-pinned skill files from GitHub.
 * Uses raw.githubusercontent.com which serves file contents directly.
 */
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/getsentry/cli";

/** Path to the SKILL.md within the repository */
const SKILL_RELATIVE_PATH = "plugins/sentry-cli/skills/sentry-cli/SKILL.md";

/**
 * Fallback URL when the versioned file isn't available (e.g., dev builds).
 * Served from the docs site via the well-known skills discovery endpoint.
 */
const FALLBACK_SKILL_URL =
  "https://cli.sentry.dev/.well-known/skills/sentry-cli/SKILL.md";

/** Timeout for fetching skill content (5 seconds) */
const FETCH_TIMEOUT_MS = 5000;

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
 * Build the URL to fetch the SKILL.md for a given CLI version.
 *
 * For release versions, points to the exact tagged commit on GitHub
 * to ensure the skill documentation matches the installed commands.
 * For dev/pre-release versions, falls back to the latest from cli.sentry.dev.
 *
 * @param version - The CLI version string (e.g., "0.8.0", "0.9.0-dev.0")
 */
export function getSkillUrl(version: string): string {
  if (version.includes("dev") || version === "0.0.0") {
    return FALLBACK_SKILL_URL;
  }
  return `${GITHUB_RAW_BASE}/${version}/${SKILL_RELATIVE_PATH}`;
}

/**
 * Fetch the SKILL.md content for a given CLI version.
 *
 * Tries the version-pinned GitHub URL first. If that fails (e.g., the tag
 * doesn't exist yet), falls back to the latest from cli.sentry.dev.
 * Returns null if both attempts fail — network errors are not propagated
 * since skill installation is a best-effort enhancement.
 *
 * @param version - The CLI version string
 */
export async function fetchSkillContent(
  version: string
): Promise<string | null> {
  const primaryUrl = getSkillUrl(version);
  const headers = { "User-Agent": getUserAgent() };

  try {
    const response = await fetch(primaryUrl, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.ok) {
      return await response.text();
    }

    // If the versioned URL failed and it's not already the fallback, try fallback
    if (primaryUrl !== FALLBACK_SKILL_URL) {
      const fallbackResponse = await fetch(FALLBACK_SKILL_URL, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (fallbackResponse.ok) {
        return await fallbackResponse.text();
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Install the Sentry CLI agent skill for Claude Code.
 *
 * Checks if Claude Code is installed, fetches the version-appropriate
 * SKILL.md, and writes it to the Claude Code skills directory.
 * Returns null (without throwing) if Claude Code isn't detected,
 * the fetch fails, or any other error occurs.
 *
 * @param homeDir - User's home directory
 * @param version - The CLI version string for version-pinned fetching
 * @returns Location info if installed, null otherwise
 */
export async function installAgentSkills(
  homeDir: string,
  version: string
): Promise<AgentSkillLocation | null> {
  if (!detectClaudeCode(homeDir)) {
    return null;
  }

  const content = await fetchSkillContent(version);
  if (!content) {
    return null;
  }

  try {
    const path = getSkillInstallPath(homeDir);
    const dir = dirname(path);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o755 });
    }

    const alreadyExists = existsSync(path);
    await Bun.write(path, content);

    return {
      path,
      created: !alreadyExists,
    };
  } catch {
    return null;
  }
}
