/**
 * sentry skills add
 *
 * Add a Sentry agent skill from getsentry/skills repository.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { CliError, ValidationError } from "../../lib/errors.js";
import { muted, success } from "../../lib/formatters/colors.js";
import { fetchAvailableSkills } from "./list.js";

/** Timeout for fetch requests in milliseconds */
const FETCH_TIMEOUT_MS = 30_000;

/** Base URL for fetching raw SKILL.md content */
const SKILLS_RAW_BASE_URL =
  "https://raw.githubusercontent.com/getsentry/skills/main/plugins/sentry-skills/skills";

/** Marketplace repository for Claude Code plugin */
const MARKETPLACE_REPO = "getsentry/skills";

/** Plugin name for Claude Code */
const PLUGIN_NAME = "sentry-skills@sentry-skills";

type AddFlags = {
  readonly target: "claude" | "local";
};

/**
 * Validate that a skill exists in the repository.
 *
 * @param skillName - Name of the skill to validate
 * @throws {ValidationError} If skill doesn't exist
 */
async function validateSkillExists(skillName: string): Promise<void> {
  const skills = await fetchAvailableSkills();
  const exists = skills.some((s) => s.name === skillName);

  if (!exists) {
    const available = skills.map((s) => s.name).join(", ");
    throw new ValidationError(
      `Unknown skill: '${skillName}'\n\nAvailable skills: ${available}`,
      "skillName"
    );
  }
}

/**
 * Fetch SKILL.md content from GitHub.
 *
 * @param skillName - Name of the skill
 * @returns Raw SKILL.md content
 * @throws {CliError} If fetch fails or times out
 */
async function fetchSkillContent(skillName: string): Promise<string> {
  const url = `${SKILLS_RAW_BASE_URL}/${skillName}/SKILL.md`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new CliError(
        `Failed to fetch skill '${skillName}': ${response.status} ${response.statusText}`
      );
    }

    return response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CliError(`Request timed out fetching skill '${skillName}'`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Install skill via Claude Code marketplace.
 *
 * Runs:
 * 1. claude plugin marketplace add getsentry/skills
 * 2. claude plugin install sentry-skills@sentry-skills
 */
async function installViaClaude(ctx: SentryContext): Promise<void> {
  const { stdout } = ctx;

  // Check if claude CLI is available
  const claudeCli = Bun.which("claude");
  if (!claudeCli) {
    throw new CliError(
      "Claude Code CLI not found.\n\n" +
        "Install Claude Code first: https://claude.ai/download\n" +
        "Or use --target local to install skills locally."
    );
  }

  // Step 1: Add marketplace
  stdout.write(`${muted("→")} Adding marketplace: ${MARKETPLACE_REPO}...\n`);

  const addMarketplace = Bun.spawn(
    ["claude", "plugin", "marketplace", "add", MARKETPLACE_REPO],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const addExitCode = await addMarketplace.exited;
  if (addExitCode !== 0) {
    const stderr = await Bun.readableStreamToText(addMarketplace.stderr);
    // "already added" is not a fatal error
    if (!stderr.toLowerCase().includes("already")) {
      stdout.write(`  ${muted(`Warning: ${stderr.trim()}`)}\n`);
    }
  }
  stdout.write(`${success("✓")} Marketplace added\n`);

  // Step 2: Install plugin
  stdout.write(`${muted("→")} Installing plugin: ${PLUGIN_NAME}...\n`);

  const installPlugin = Bun.spawn(
    ["claude", "plugin", "install", PLUGIN_NAME],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const installExitCode = await installPlugin.exited;
  if (installExitCode !== 0) {
    const stderr = await Bun.readableStreamToText(installPlugin.stderr);
    // "already installed" is not a fatal error
    if (!stderr.toLowerCase().includes("already")) {
      throw new CliError(`Failed to install plugin: ${stderr.trim()}`);
    }
  }
  stdout.write(`${success("✓")} Plugin installed\n`);
}

/**
 * Install skill locally by creating directory structure.
 *
 * Creates: ./<skill-name>/SKILL.md
 */
async function installLocally(
  ctx: SentryContext,
  skillName: string
): Promise<void> {
  const { stdout, cwd } = ctx;

  // Fetch SKILL.md content
  stdout.write(`${muted("→")} Fetching skill: ${skillName}...\n`);
  const content = await fetchSkillContent(skillName);

  // Create directory structure: ./<skill-name>/SKILL.md
  const skillDir = join(cwd, skillName);
  const skillPath = join(skillDir, "SKILL.md");

  // Check if directory or file already exists
  if (existsSync(skillDir)) {
    throw new CliError(
      `Directory already exists: ${skillDir}\n\n` +
        "Remove it first or choose a different location."
    );
  }

  // Create directory and write file with cleanup on failure
  try {
    mkdirSync(skillDir, { recursive: true });
    await Bun.write(skillPath, content);
  } catch (error) {
    // Clean up partial state on failure
    try {
      rmSync(skillDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }

  stdout.write(`${success("✓")} Created ${skillDir}/SKILL.md\n`);
}

export const addCommand = buildCommand({
  docs: {
    brief: "Add a Sentry agent skill",
    fullDescription:
      "Add a skill from getsentry/skills to Claude Code or locally.\n\n" +
      "Targets:\n" +
      "  claude (default) - Install via Claude Code plugin marketplace\n" +
      "  local - Create skill directory in current working directory\n\n" +
      "Examples:\n" +
      "  sentry skills add find-bugs          # Install to Claude Code\n" +
      "  sentry skills add commit --target local  # Create ./commit/SKILL.md",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Skill name (e.g., find-bugs, commit, code-review)",
          parse: String,
        },
      ],
    },
    flags: {
      target: {
        kind: "enum",
        values: ["claude", "local"] as const,
        brief: "Installation target (claude or local)",
        default: "claude" as const,
      },
    },
  },
  async func(
    this: SentryContext,
    flags: AddFlags,
    skillName: string
  ): Promise<void> {
    const { stdout } = this;

    // Validate skill exists
    stdout.write(`Validating skill '${skillName}'...\n`);
    await validateSkillExists(skillName);

    if (flags.target === "claude") {
      await installViaClaude(this);

      stdout.write(
        `\n${success("✓")} Skill '${skillName}' is now available in Claude Code.\n`
      );
      stdout.write("  Restart Claude Code to activate the skills.\n");
    } else {
      await installLocally(this, skillName);

      stdout.write(`\n${success("✓")} Skill '${skillName}' is ready to use.\n`);
      stdout.write(
        `  ${muted("This skill will be discovered by agents that support the Agent Skills format.")}\n`
      );
    }
  },
});
