/**
 * Agent skill installation for AI coding assistants.
 *
 * Detects supported AI coding agents (currently Claude Code) and installs
 * the Sentry CLI skill files so the agent can use CLI commands effectively.
 *
 * Installs a compact SKILL.md index plus per-command-group reference files.
 * The content is fetched from GitHub, version-pinned to the installed
 * CLI version to avoid documenting commands that don't exist in the binary.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getUserAgent } from "./constants.js";

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
 * Base URL for fetching version-pinned skill files from GitHub.
 * Uses raw.githubusercontent.com which serves file contents directly.
 */
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/getsentry/cli";

/** Base path to skill files within the repository */
const SKILL_REPO_BASE = "plugins/sentry-cli/skills/sentry-cli";

/**
 * Fallback base URL when the versioned files aren't available (e.g., dev builds).
 * Served from the docs site via the well-known skills discovery endpoint.
 */
const FALLBACK_BASE_URL =
  "https://cli.sentry.dev/.well-known/skills/sentry-cli";

/** Timeout for fetching skill content (5 seconds) */
const FETCH_TIMEOUT_MS = 5000;

/**
 * Reference files to install alongside SKILL.md.
 * These provide full flag/example details for each command group.
 * This list must stay in sync with the generator's ROUTE_TO_REFERENCE mapping.
 */
const REFERENCE_FILES = [
  "references/api.md",
  "references/auth.md",
  "references/dashboards.md",
  "references/events.md",
  "references/issues.md",
  "references/logs.md",
  "references/organizations.md",
  "references/projects.md",
  "references/setup.md",
  "references/teams.md",
  "references/traces.md",
  "references/trials.md",
];

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
 * Build the URL to fetch a skill file for a given CLI version.
 *
 * For release versions, points to the exact tagged commit on GitHub
 * to ensure the skill documentation matches the installed commands.
 * For dev/pre-release versions, falls back to the latest from cli.sentry.dev.
 *
 * @param version - The CLI version string (e.g., "0.8.0", "0.9.0-dev.0")
 * @param relativePath - Path relative to skill directory (e.g., "SKILL.md", "references/issues.md")
 */
export function getSkillUrl(
  version: string,
  relativePath = "SKILL.md"
): string {
  if (version.includes("dev") || version === "0.0.0") {
    return `${FALLBACK_BASE_URL}/${relativePath}`;
  }
  return `${GITHUB_RAW_BASE}/${version}/${SKILL_REPO_BASE}/${relativePath}`;
}

/**
 * Fetch a single skill file with fallback.
 *
 * Tries the version-pinned GitHub URL first. If that fails (e.g., the tag
 * doesn't exist yet), falls back to the latest from cli.sentry.dev.
 * Returns null if both attempts fail — network errors are not propagated
 * since skill installation is a best-effort enhancement.
 *
 * @param version - The CLI version string
 * @param relativePath - Path relative to skill directory
 */
async function fetchSingleFile(
  version: string,
  relativePath: string
): Promise<string | null> {
  const primaryUrl = getSkillUrl(version, relativePath);
  const fallbackUrl = `${FALLBACK_BASE_URL}/${relativePath}`;
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
    if (primaryUrl !== fallbackUrl) {
      const fallbackResponse = await fetch(fallbackUrl, {
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
 * Fetch the SKILL.md content for a given CLI version.
 *
 * @param version - The CLI version string
 */
export async function fetchSkillContent(
  version: string
): Promise<string | null> {
  return await fetchSingleFile(version, "SKILL.md");
}

/**
 * Fetch all skill files (SKILL.md + reference files) for a given CLI version.
 *
 * Reference file fetches are best-effort — if any fail, the main SKILL.md
 * is still returned. This ensures graceful degradation.
 *
 * @param version - The CLI version string
 * @returns Map of relative path → content, or null if SKILL.md fetch fails
 */
export async function fetchAllSkillFiles(
  version: string
): Promise<Map<string, string> | null> {
  const skillContent = await fetchSingleFile(version, "SKILL.md");
  if (!skillContent) {
    return null;
  }

  const files = new Map<string, string>();
  files.set("SKILL.md", skillContent);

  // Fetch reference files in parallel (best-effort)
  const results = await Promise.allSettled(
    REFERENCE_FILES.map(async (path) => {
      const content = await fetchSingleFile(version, path);
      return { path, content };
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.content) {
      files.set(result.value.path, result.value.content);
    }
  }

  return files;
}

/**
 * Install the Sentry CLI agent skill for Claude Code.
 *
 * Checks if Claude Code is installed, fetches the version-appropriate
 * skill files, and writes them to the Claude Code skills directory.
 * Installs SKILL.md + reference files for per-group command details.
 *
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

  const files = await fetchAllSkillFiles(version);
  if (!files) {
    return null;
  }

  try {
    const skillPath = getSkillInstallPath(homeDir);
    const skillDir = dirname(skillPath);
    const refsDir = join(skillDir, "references");

    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true, mode: 0o755 });
    }

    if (!existsSync(refsDir)) {
      mkdirSync(refsDir, { recursive: true, mode: 0o755 });
    }

    const alreadyExists = existsSync(skillPath);
    let referenceCount = 0;

    // Write all files
    for (const [relativePath, content] of files) {
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
  } catch {
    return null;
  }
}
