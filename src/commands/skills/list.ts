/**
 * sentry skills list
 *
 * List available Sentry agent skills from getsentry/skills repository.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { CliError } from "../../lib/errors.js";
import { muted, writeJson } from "../../lib/formatters/index.js";

/** GitHub API URL for listing skill directories */
const SKILLS_API_URL =
  "https://api.github.com/repos/getsentry/skills/contents/plugins/sentry-skills/skills";

/** Base URL for fetching raw SKILL.md content */
const SKILLS_RAW_BASE_URL =
  "https://raw.githubusercontent.com/getsentry/skills/main/plugins/sentry-skills/skills";

/** Timeout for fetch requests in milliseconds */
const FETCH_TIMEOUT_MS = 30_000;

/** Skill metadata parsed from SKILL.md frontmatter */
export type SkillInfo = {
  name: string;
  description: string;
};

/** GitHub Contents API response item */
type GitHubContentItem = {
  name: string;
  type: "file" | "dir" | "symlink";
  path: string;
};

/** Regex to extract YAML frontmatter from SKILL.md */
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/** Regex to extract description from frontmatter */
const DESCRIPTION_REGEX = /description:\s*(.+?)(?:\n[a-z-]+:|$)/s;

/**
 * Parse description from SKILL.md YAML frontmatter.
 *
 * Expected format:
 * ```
 * ---
 * name: skill-name
 * description: What the skill does
 * ---
 * ```
 */
function parseDescriptionFromFrontmatter(markdown: string): string {
  const frontmatterMatch = markdown.match(FRONTMATTER_REGEX);
  const frontmatter = frontmatterMatch?.[1];
  if (!frontmatter) {
    return "No description available";
  }

  // Match description that may span multiple lines (until next field or end)
  const descMatch = frontmatter.match(DESCRIPTION_REGEX);
  const description = descMatch?.[1];
  if (!description) {
    return "No description available";
  }

  // Clean up the description: remove quotes and collapse whitespace
  return description
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch with timeout support.
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns Response object
 * @throws {Error} If request times out
 */
async function fetchWithTimeout(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the list of available skills from GitHub.
 *
 * @returns Array of skill info with name and description
 * @throws {CliError} If network request fails or times out
 */
export async function fetchAvailableSkills(): Promise<SkillInfo[]> {
  // Fetch directory listing
  let response: Response;
  try {
    response = await fetchWithTimeout(SKILLS_API_URL, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "sentry-cli",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CliError("Request timed out fetching skills list");
    }
    throw error;
  }

  if (!response.ok) {
    throw new CliError(
      `Failed to fetch skills list: ${response.status} ${response.statusText}`
    );
  }

  const contents = (await response.json()) as GitHubContentItem[];

  // Filter to directories only (each dir is a skill)
  const skillDirs = contents.filter((item) => item.type === "dir");

  // Fetch SKILL.md for each skill to get description
  const skills = await Promise.all(
    skillDirs.map(async (dir): Promise<SkillInfo> => {
      const skillMdUrl = `${SKILLS_RAW_BASE_URL}/${dir.name}/SKILL.md`;

      try {
        const mdResponse = await fetchWithTimeout(skillMdUrl);
        if (!mdResponse.ok) {
          return { name: dir.name, description: "No description available" };
        }

        const markdown = await mdResponse.text();
        const description = parseDescriptionFromFrontmatter(markdown);
        return { name: dir.name, description };
      } catch {
        return { name: dir.name, description: "No description available" };
      }
    })
  );

  // Sort alphabetically by name
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Format skills as a table for human-readable output.
 */
function formatSkillsTable(skills: SkillInfo[], termWidth: number): string {
  const nameWidth = 24;
  const descWidth = Math.max(40, termWidth - nameWidth - 4);

  const header = `${"NAME".padEnd(nameWidth)}  DESCRIPTION`;
  const divider = "-".repeat(Math.min(termWidth, nameWidth + descWidth + 2));

  const rows = skills.map((skill) => {
    const name = skill.name.padEnd(nameWidth);
    // Truncate description if too long
    let desc = skill.description;
    if (desc.length > descWidth) {
      desc = `${desc.slice(0, descWidth - 3)}...`;
    }
    return `${name}  ${desc}`;
  });

  return [muted(header), divider, ...rows].join("\n");
}

type ListFlags = {
  readonly json: boolean;
};

export const listCommand = buildCommand({
  docs: {
    brief: "List available Sentry agent skills",
    fullDescription:
      "List available skills from the getsentry/skills repository.\n\n" +
      "Skills provide reusable instructions for AI coding assistants.\n" +
      "Use 'sentry skills add <name>' to install a skill.",
  },
  parameters: {
    flags: {
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: SentryContext, flags: ListFlags): Promise<void> {
    const { stdout } = this;

    stdout.write("Fetching available skills...\n\n");

    const skills = await fetchAvailableSkills();

    if (flags.json) {
      writeJson(stdout, skills);
      return;
    }

    const termWidth = process.stdout.columns || 80;
    stdout.write(`${formatSkillsTable(skills, termWidth)}\n`);
    stdout.write(
      `\n${muted(`${skills.length} skills available. Use 'sentry skills add <name>' to install.`)}\n`
    );
  },
});
