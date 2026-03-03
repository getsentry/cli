/**
 * Agent skill installation for AI coding assistants.
 *
 * Detects supported AI coding agents (currently Claude Code) and installs
 * the Sentry CLI skill files so the agent can use CLI commands effectively.
 *
 * The skill content is fetched from GitHub, version-pinned to the installed
 * CLI version to avoid documenting commands that don't exist in the binary.
 *
 * Fetches an index.json manifest first to discover all skill files
 * (SKILL.md + references/*.md), then fetches them in parallel.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getUserAgent } from "./constants.js";

/** Where completions are installed */
export type AgentSkillLocation = {
  /** Path where the skill files were installed */
  path: string;
  /** Whether the directory was created or already existed */
  created: boolean;
};

/**
 * Base URL for fetching version-pinned skill files from GitHub.
 * Uses raw.githubusercontent.com which serves file contents directly.
 */
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/getsentry/cli";

/** Path to the skill directory within the repository */
const SKILL_RELATIVE_DIR = "plugins/sentry-cli/skills/sentry-cli";

/**
 * Fallback base URL when the versioned files aren't available (e.g., dev builds).
 * Served from the docs site via the well-known skills discovery endpoint.
 */
const FALLBACK_BASE_URL =
  "https://cli.sentry.dev/.well-known/skills/sentry-cli";

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
 * Get the installation directory for the Sentry CLI skill in Claude Code.
 *
 * Skills are stored under ~/.claude/skills/<skill-name>/,
 * matching the convention used by the `npx skills` tool.
 */
export function getSkillInstallPath(homeDir: string): string {
  return join(homeDir, ".claude", "skills", "sentry-cli", "SKILL.md");
}

/**
 * Build the base URL for fetching skill files for a given CLI version.
 *
 * For release versions, points to the exact tagged commit on GitHub
 * to ensure the skill documentation matches the installed commands.
 * For dev/pre-release versions, falls back to the latest from cli.sentry.dev.
 *
 * @param version - The CLI version string (e.g., "0.8.0", "0.9.0-dev.0")
 */
export function getSkillBaseUrl(version: string): string {
  if (version.includes("dev") || version === "0.0.0") {
    return FALLBACK_BASE_URL;
  }
  return `${GITHUB_RAW_BASE}/${version}/${SKILL_RELATIVE_DIR}`;
}

// Keep backward-compatible alias
export { getSkillBaseUrl as getSkillUrl };

/**
 * Fetch a single file from a URL, returning its content or null on failure.
 */
async function fetchFile(
  url: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.ok) {
      return await response.text();
    }
    return null;
  } catch {
    return null;
  }
}

/** Expected shape of the index.json manifest */
type SkillIndex = {
  skills: Array<{
    name: string;
    files: string[];
  }>;
};

/**
 * Fetch the list of skill files from the index.json manifest.
 * Returns the file list or a default if the manifest can't be fetched.
 */
async function fetchSkillFileList(
  baseUrl: string,
  headers: Record<string, string>
): Promise<string[]> {
  const indexUrl = `${baseUrl.replace(/\/sentry-cli$/, "")}/index.json`;
  const content = await fetchFile(indexUrl, headers);

  if (content) {
    try {
      const index = JSON.parse(content) as SkillIndex;
      const skill = index.skills?.find((s) => s.name === "sentry-cli");
      if (skill?.files && skill.files.length > 0) {
        return skill.files;
      }
    } catch {
      // Fall through to default
    }
  }

  // Default: just SKILL.md (backward compatible)
  return ["SKILL.md"];
}

/**
 * Fetch all skill files for a given CLI version.
 *
 * Tries the version-pinned GitHub URL first. If index.json or SKILL.md
 * fails from GitHub, falls back to cli.sentry.dev.
 * Returns a map of relative paths to content, or null if the primary
 * SKILL.md can't be fetched from either source.
 *
 * @param version - The CLI version string
 */
export async function fetchSkillContent(
  version: string
): Promise<Map<string, string> | null> {
  const primaryBaseUrl = getSkillBaseUrl(version);
  const headers = { "User-Agent": getUserAgent() };

  // Try to fetch the file list from index.json
  const fileList = await fetchSkillFileList(primaryBaseUrl, headers);

  // Fetch all files in parallel from primary URL
  const results = await Promise.allSettled(
    fileList.map(async (filePath) => {
      const content = await fetchFile(
        `${primaryBaseUrl}/${filePath}`,
        headers
      );
      return { filePath, content };
    })
  );

  const files = new Map<string, string>();
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.content !== null) {
      files.set(result.value.filePath, result.value.content);
    }
  }

  // SKILL.md is required — if it's missing, try fallback
  if (!files.has("SKILL.md")) {
    if (primaryBaseUrl !== FALLBACK_BASE_URL) {
      // Try fallback for all files
      const fallbackFileList = await fetchSkillFileList(
        FALLBACK_BASE_URL,
        headers
      );
      const fallbackResults = await Promise.allSettled(
        fallbackFileList.map(async (filePath) => {
          const content = await fetchFile(
            `${FALLBACK_BASE_URL}/${filePath}`,
            headers
          );
          return { filePath, content };
        })
      );

      files.clear();
      for (const result of fallbackResults) {
        if (result.status === "fulfilled" && result.value.content !== null) {
          files.set(result.value.filePath, result.value.content);
        }
      }
    }

    // Still no SKILL.md → give up
    if (!files.has("SKILL.md")) {
      return null;
    }
  }

  return files;
}

/**
 * Install the Sentry CLI agent skill for Claude Code.
 *
 * Checks if Claude Code is installed, fetches the version-appropriate
 * skill files, and writes them to the Claude Code skills directory.
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

  const files = await fetchSkillContent(version);
  if (!files) {
    return null;
  }

  try {
    const skillDir = join(homeDir, ".claude", "skills", "sentry-cli");

    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true, mode: 0o755 });
    }

    const alreadyExists = existsSync(join(skillDir, "SKILL.md"));

    // Write all fetched files
    for (const [filePath, content] of files) {
      const fullPath = join(skillDir, filePath);
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o755 });
      }
      await Bun.write(fullPath, content);
    }

    return {
      path: join(skillDir, "SKILL.md"),
      created: !alreadyExists,
    };
  } catch {
    return null;
  }
}
