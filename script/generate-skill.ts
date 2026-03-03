#!/usr/bin/env bun
/**
 * Generate skill files from Stricli Command Metadata and Docs
 *
 * Introspects the CLI's route tree and merges with documentation
 * to generate structured documentation for AI agents.
 *
 * Produces:
 *   - SKILL.md (index with command table + links)
 *   - references/*.md (per-command-group reference files)
 *   - index.json (file manifest for remote installation)
 *
 * Usage:
 *   bun run script/generate-skill.ts
 *
 * Output:
 *   plugins/sentry-cli/skills/sentry-cli/
 *   docs/public/.well-known/skills/index.json
 */

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { routes } from "../src/app.js";

const OUTPUT_DIR = "plugins/sentry-cli/skills/sentry-cli";
const REFERENCES_DIR = `${OUTPUT_DIR}/references`;
const INDEX_JSON_PATH = "docs/public/.well-known/skills/index.json";
const DOCS_PATH = "docs/src/content/docs";

/** Map shortcut commands to their parent reference file */
const SHORTCUT_TO_PARENT: Record<string, string> = {
  issues: "issue",
  orgs: "org",
  projects: "project",
  repos: "repo",
  teams: "team",
  logs: "log",
  traces: "trace",
  whoami: "auth",
};

/** Regex to match YAML frontmatter at the start of a file */
const FRONTMATTER_REGEX = /^---\n[\s\S]*?\n---\n/;

/** Regex to match code blocks with optional language specifier */
const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;

/** Regex to extract npm command from PackageManagerCode Astro component (handles multi-line) */
const PACKAGE_MANAGER_REGEX = /<PackageManagerCode[\s\S]*?npm="([^"]+)"/;

// ─────────────────────────────────────────────────────────────────────────────
// Types for Stricli Route Introspection
//
// Note: While @stricli/core exports RouteMap and Command types, they require
// complex generic parameters (CommandContext) and don't export internal types
// like RouteMapEntry or FlagParameter. These simplified types are purpose-built
// for introspection and documentation generation.
// ─────────────────────────────────────────────────────────────────────────────

type RouteMapEntry = {
  name: { original: string };
  target: RouteTarget;
  hidden: boolean;
};

type RouteTarget = RouteMap | Command;

type RouteMap = {
  brief: string;
  fullDescription?: string;
  getAllEntries: () => RouteMapEntry[];
};

type Command = {
  brief: string;
  fullDescription?: string;
  parameters: {
    positional?: PositionalParams;
    flags?: Record<string, FlagDef>;
    aliases?: Record<string, string>;
  };
};

type PositionalParams =
  | { kind: "tuple"; parameters: PositionalParam[] }
  | { kind: "array"; parameter: PositionalParam };

type PositionalParam = {
  brief?: string;
  placeholder?: string;
};

type FlagDef = {
  kind: "boolean" | "parsed";
  brief?: string;
  default?: unknown;
  optional?: boolean;
  variadic?: boolean;
  placeholder?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Markdown Parsing Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip YAML frontmatter from markdown content
 */
function stripFrontmatter(markdown: string): string {
  const match = markdown.match(FRONTMATTER_REGEX);
  return match ? markdown.slice(match[0].length) : markdown;
}

/**
 * Strip MDX/Astro import statements and JSX components
 */
function stripMdxComponents(markdown: string): string {
  // Remove import statements
  let result = markdown.replace(/^import\s+.*?;\s*$/gm, "");

  // Remove export statements
  result = result.replace(/^export\s+.*?;\s*$/gm, "");

  // Remove JSX-style components (both self-closing and with children)
  // This handles <Component ... /> and <Component>...</Component>
  result = result.replace(/<[A-Z][a-zA-Z]*[^>]*\/>/g, "");
  result = result.replace(
    /<[A-Z][a-zA-Z]*[^>]*>[\s\S]*?<\/[A-Z][a-zA-Z]*>/g,
    ""
  );

  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Extract a specific section from markdown by heading.
 * Correctly skips headings inside fenced code blocks.
 */
function extractSection(markdown: string, heading: string): string | null {
  // Match heading at any level (##, ###, etc.)
  const headingPattern = new RegExp(
    `^(#{1,6})\\s+${escapeRegex(heading)}\\s*$`,
    "m"
  );
  const match = markdown.match(headingPattern);

  if (!match || match.index === undefined) {
    return null;
  }

  const headingLevel = match[1].length;
  const startIndex = match.index + match[0].length;

  // Find the next heading of same or higher level, skipping code blocks
  const remainingContent = markdown.slice(startIndex);
  const nextHeadingIndex = findNextHeadingOutsideCode(
    remainingContent,
    headingLevel
  );

  const endIndex =
    nextHeadingIndex !== -1
      ? startIndex + nextHeadingIndex
      : markdown.length;

  return markdown.slice(startIndex, endIndex).trim();
}

/**
 * Find the index of the next markdown heading at or above a given level,
 * skipping over fenced code blocks.
 * Returns -1 if no such heading is found.
 */
function findNextHeadingOutsideCode(
  content: string,
  maxLevel: number
): number {
  const lines = content.split("\n");
  let inCodeBlock = false;
  let offset = 0;

  for (const line of lines) {
    // Toggle code fence state
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    } else if (!inCodeBlock) {
      // Check if this line is a heading at or above the target level
      const headingMatch = line.match(/^(#{1,6})\s+/);
      if (headingMatch && headingMatch[1].length <= maxLevel) {
        return offset;
      }
    }
    offset += line.length + 1; // +1 for newline
  }

  return -1;
}

/**
 * Extract all code blocks from markdown
 */
function extractCodeBlocks(
  markdown: string,
  language?: string
): { code: string; lang: string }[] {
  const blocks: { code: string; lang: string }[] = [];
  // Create a new regex instance for each call to reset lastIndex
  const pattern = new RegExp(CODE_BLOCK_REGEX.source, CODE_BLOCK_REGEX.flags);

  let match = pattern.exec(markdown);
  while (match !== null) {
    const lang = match[1] || "";
    const code = match[2].trim();
    if (!language || lang === language) {
      blocks.push({ code, lang });
    }
    match = pattern.exec(markdown);
  }

  return blocks;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────────────────────
// Documentation Loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and parse a documentation file
 */
async function loadDoc(relativePath: string): Promise<string | null> {
  const fullPath = `${DOCS_PATH}/${relativePath}`;
  const file = Bun.file(fullPath);

  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  return stripMdxComponents(stripFrontmatter(content));
}

/**
 * Extract npm command from PackageManagerCode Astro component
 */
function extractPackageManagerCommand(rawContent: string): string | null {
  const match = rawContent.match(PACKAGE_MANAGER_REGEX);
  return match ? match[1] : null;
}

/**
 * Generate installation section from docs content
 */
function generateInstallSection(
  installSection: string,
  rawContent: string
): string[] {
  const lines: string[] = [];
  lines.push("### Installation");
  lines.push("");

  // Get bash code blocks (install script)
  const codeBlocks = extractCodeBlocks(installSection, "bash");

  // Also extract npm command from PackageManagerCode component in raw content
  const npmCommand = extractPackageManagerCommand(rawContent);

  if (codeBlocks.length > 0 || npmCommand) {
    lines.push("```bash");

    // Add install script from code blocks
    for (const block of codeBlocks) {
      lines.push(block.code);
    }

    // Add package manager command if found
    if (npmCommand) {
      if (codeBlocks.length > 0) {
        lines.push("");
        lines.push("# Or install via npm/pnpm/bun");
      }
      lines.push(npmCommand);
    }

    lines.push("```");
  }

  return lines;
}

/**
 * Generate authentication section from docs content
 */
function generateAuthSection(authSection: string): string[] {
  const lines: string[] = [];
  lines.push("### Authentication");
  lines.push("");

  const codeBlocks = extractCodeBlocks(authSection, "bash");
  if (codeBlocks.length > 0) {
    lines.push("```bash");
    for (const block of codeBlocks) {
      lines.push(block.code);
    }
    lines.push("```");
  }

  return lines;
}

/**
 * Load prerequisites (installation + authentication) from getting-started.mdx
 */
async function loadPrerequisites(): Promise<string> {
  const fullPath = `${DOCS_PATH}/getting-started.mdx`;
  const file = Bun.file(fullPath);

  if (!(await file.exists())) {
    return getDefaultPrerequisites();
  }

  const rawContent = await file.text();
  const content = stripMdxComponents(stripFrontmatter(rawContent));

  const lines: string[] = [];
  lines.push("## Prerequisites");
  lines.push("");
  lines.push("The CLI must be installed and authenticated before use.");
  lines.push("");

  // Extract and add Installation section
  const installSection = extractSection(content, "Installation");
  if (installSection) {
    lines.push(...generateInstallSection(installSection, rawContent));
  }

  lines.push("");

  // Extract and add Authentication section
  const authSection = extractSection(content, "Authentication");
  if (authSection) {
    lines.push(...generateAuthSection(authSection));
  }

  return lines.join("\n");
}

/**
 * Default prerequisites if docs aren't available
 */
function getDefaultPrerequisites(): string {
  return `## Prerequisites

The CLI must be installed and authenticated before use.

### Installation

\`\`\`bash
# Install script
curl https://cli.sentry.dev/install -fsS | bash

# Or use npm/pnpm/bun
npm install -g sentry
\`\`\`

### Authentication

\`\`\`bash
# OAuth login (recommended)
sentry auth login

# Or use an API token
sentry auth login --token YOUR_SENTRY_API_TOKEN

# Check auth status
sentry auth status
\`\`\``;
}

/** Regex to match command sections in docs (### `sentry ...`) */
const COMMAND_SECTION_REGEX =
  /###\s+`(sentry\s+\S+(?:\s+\S+)?)`\s*\n([\s\S]*?)(?=###\s+`|$)/g;

/**
 * Extract prose description from a command section (text between heading and first code block).
 * Filters out option/argument tables and metadata headers.
 */
function extractCommandProse(sectionContent: string): string | null {
  const firstCodeBlock = sectionContent.indexOf("```");
  if (firstCodeBlock === -1) {
    // No code blocks — the whole section is prose
    const prose = sectionContent.trim();
    return prose || null;
  }

  const prose = sectionContent.slice(0, firstCodeBlock).trim();
  // Filter out lines that are just table headers, argument descriptions, or metadata
  const lines = prose.split("\n");
  const filtered: string[] = [];
  let inTable = false;

  for (const line of lines) {
    if (
      line.startsWith("|") ||
      line.startsWith("**Arguments:**") ||
      line.startsWith("**Options:**") ||
      line.startsWith("**Option")
    ) {
      inTable = true;
      continue;
    }
    if (inTable && (line.startsWith("|") || line.trim() === "")) {
      if (line.trim() === "") inTable = false;
      continue;
    }
    if (inTable) {
      inTable = false;
    }
    if (line.trim()) {
      filtered.push(line);
    }
  }

  const result = filtered.join("\n").trim();
  return result || null;
}

/**
 * Extract trailing prose from a command section (text after the last code block).
 * This captures content like "Requirements:" lists that appear at the end.
 * Filters out duplicate option/argument tables.
 */
function extractTrailingProse(sectionContent: string): string | null {
  // Find the last code block end
  const pattern = new RegExp(CODE_BLOCK_REGEX.source, CODE_BLOCK_REGEX.flags);
  let lastEnd = -1;
  let match = pattern.exec(sectionContent);
  while (match !== null) {
    lastEnd = match.index + match[0].length;
    match = pattern.exec(sectionContent);
  }

  if (lastEnd === -1) return null;

  const trailing = sectionContent.slice(lastEnd).trim();
  if (!trailing || trailing.length <= 20) return null;

  // Filter out option/argument tables and stop at ## headings
  // (supplementary sections are handled separately)
  const lines = trailing.split("\n");
  const filtered: string[] = [];
  let inTable = false;

  for (const line of lines) {
    // Stop at ## headings — these are supplementary sections
    if (/^##\s+/.test(line)) break;

    // Skip table rows and option/argument headers
    if (line.startsWith("|") || line.startsWith("**Arguments:**") || line.startsWith("**Options:**")) {
      inTable = true;
      continue;
    }
    if (inTable && (line.startsWith("|") || line.trim() === "")) {
      if (line.trim() === "") inTable = false;
      continue;
    }
    if (inTable) {
      inTable = false;
    }
    filtered.push(line);
  }

  const result = filtered.join("\n").trim();
  return result && result.length > 20 ? result : null;
}

/**
 * Extract output examples (non-bash code blocks) from a command section.
 * These are code blocks without a language or with empty language that show expected output.
 */
function extractOutputExamples(sectionContent: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(CODE_BLOCK_REGEX.source, CODE_BLOCK_REGEX.flags);

  let match = pattern.exec(sectionContent);
  while (match !== null) {
    const lang = match[1] || "";
    const code = match[2].trim();
    // Capture blocks that have no language specifier (output examples)
    if (lang === "" && code) {
      blocks.push(code);
    }
    match = pattern.exec(sectionContent);
  }

  return blocks;
}

/**
 * Extract supplementary sections from a doc file.
 * These are top-level sections (## heading) that appear after the command sections,
 * like "Finding Event IDs", "Finding Log IDs", "JSON Output", "Release Channels", etc.
 * Correctly skips headings inside fenced code blocks.
 */
function extractSupplementarySections(
  docContent: string
): { heading: string; content: string }[] {
  const sections: { heading: string; content: string }[] = [];

  // Match ## headings that are NOT "Commands", "Usage", "Examples", "Options", "Notes"
  const skipHeadings = new Set([
    "Commands",
    "Usage",
    "Examples",
    "Options",
    "Notes",
    "API Documentation",
    "Configuration",
  ]);

  // Find ## headings outside of code blocks
  const headings: { heading: string; index: number }[] = [];
  const lines = docContent.split("\n");
  let inCodeBlock = false;
  let offset = 0;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    } else if (!inCodeBlock) {
      const headingMatch = line.match(/^##\s+(.+)$/);
      if (headingMatch) {
        headings.push({ heading: headingMatch[1].trim(), index: offset });
      }
    }
    offset += line.length + 1;
  }

  for (let i = 0; i < headings.length; i++) {
    const { heading, index } = headings[i];
    if (skipHeadings.has(heading)) {
      continue;
    }
    // Also skip command-level headings
    if (heading.startsWith("`sentry")) {
      continue;
    }

    const startIndex = index + docContent.slice(index).indexOf("\n") + 1;
    const endIndex =
      i + 1 < headings.length ? headings[i + 1].index : docContent.length;
    const content = docContent.slice(startIndex, endIndex).trim();

    if (content) {
      sections.push({ heading, content });
    }
  }

  return sections;
}

type DocExamples = {
  examples: Map<string, string[]>;
  prose: Map<string, string>;
  outputExamples: Map<string, string[]>;
  supplementary: { heading: string; content: string }[];
};

/**
 * Parse command sections from doc content, extracting examples, prose, and output examples.
 */
function parseDocContent(docContent: string): DocExamples {
  const examples = new Map<string, string[]>();
  const prose = new Map<string, string>();
  const outputExamples = new Map<string, string[]>();

  // Find all command sections (### `sentry ...`)
  const commandPattern = new RegExp(
    COMMAND_SECTION_REGEX.source,
    COMMAND_SECTION_REGEX.flags
  );
  let match = commandPattern.exec(docContent);

  while (match !== null) {
    const commandPath = match[1];
    const sectionContent = match[2];

    // Extract bash code blocks from this section
    const codeBlocks = extractCodeBlocks(sectionContent, "bash");
    if (codeBlocks.length > 0) {
      examples.set(
        commandPath,
        codeBlocks.map((b) => b.code)
      );
    }

    // Extract prose description (before first code block + after last code block)
    const leadingProse = extractCommandProse(sectionContent);
    const trailingProse = extractTrailingProse(sectionContent);
    const combinedProse = [leadingProse, trailingProse]
      .filter(Boolean)
      .join("\n\n");
    if (combinedProse) {
      prose.set(commandPath, combinedProse);
    }

    // Extract output examples
    const outputs = extractOutputExamples(sectionContent);
    if (outputs.length > 0) {
      outputExamples.set(commandPath, outputs);
    }

    match = commandPattern.exec(docContent);
  }

  // Extract supplementary sections
  const supplementary = extractSupplementarySections(docContent);

  return { examples, prose, outputExamples, supplementary };
}

/**
 * Load and parse docs for a specific command group.
 * Handles both single-file (commands/auth.md) and subdirectory (commands/cli/*.md) layouts.
 */
async function loadCommandDocs(commandGroup: string): Promise<DocExamples> {
  const result: DocExamples = {
    examples: new Map(),
    prose: new Map(),
    outputExamples: new Map(),
    supplementary: [],
  };

  // Try loading single doc file (e.g., commands/auth.md)
  const docContent = await loadDoc(`commands/${commandGroup}.md`);

  if (docContent) {
    const parsed = parseDocContent(docContent);
    for (const [k, v] of parsed.examples) result.examples.set(k, v);
    for (const [k, v] of parsed.prose) result.prose.set(k, v);
    for (const [k, v] of parsed.outputExamples)
      result.outputExamples.set(k, v);
    result.supplementary.push(...parsed.supplementary);

    // For docs that use flat ## Usage / ## Examples sections (not ### `sentry ...`)
    // e.g., init.md — extract examples for the top-level command
    const commandPath = `sentry ${commandGroup}`;
    if (!result.examples.has(commandPath)) {
      // Prefer ## Examples over ## Usage for richer content
      for (const sectionName of ["Examples", "Usage"]) {
        const section = extractSection(docContent, sectionName);
        if (section) {
          const codeBlocks = extractCodeBlocks(section, "bash");
          if (codeBlocks.length > 0) {
            result.examples.set(
              commandPath,
              codeBlocks.map((b) => b.code)
            );
            break;
          }
        }
      }
    }
  }

  // Try loading from subdirectory (e.g., commands/cli/feedback.md, commands/cli/upgrade.md)
  const subDirPath = `${DOCS_PATH}/commands/${commandGroup}`;
  try {
    const entries = readdirSync(subDirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".md") ||
        entry.name === "index.md"
      ) {
        continue;
      }

      const subDocContent = await loadDoc(
        `commands/${commandGroup}/${entry.name}`
      );
      if (!subDocContent) continue;

      // For subdirectory docs, command sections use ### `sentry cli upgrade` etc.
      const parsed = parseDocContent(subDocContent);
      for (const [k, v] of parsed.examples) result.examples.set(k, v);
      for (const [k, v] of parsed.prose) result.prose.set(k, v);
      for (const [k, v] of parsed.outputExamples)
        result.outputExamples.set(k, v);
      result.supplementary.push(...parsed.supplementary);

          // Also try to extract examples from ## Usage and ## Examples sections
      // (for docs that don't use ### `sentry ...` headings)
      const subcommandName = entry.name.replace(".md", "");
      const commandPath = `sentry ${commandGroup} ${subcommandName}`;

      if (!result.examples.has(commandPath)) {
        // Prefer ## Examples over ## Usage for richer content
        for (const sectionName of ["Examples", "Usage"]) {
          const section = extractSection(subDocContent, sectionName);
          if (section) {
            const codeBlocks = extractCodeBlocks(section, "bash");
            if (codeBlocks.length > 0) {
              result.examples.set(
                commandPath,
                codeBlocks.map((b) => b.code)
              );
              break;
            }
          }
        }
      }

      // Extract output examples from ## Examples section too
      const examplesSection = extractSection(subDocContent, "Examples");
      if (examplesSection) {
        const outputs = extractOutputExamples(examplesSection);
        if (outputs.length > 0 && !result.outputExamples.has(commandPath)) {
          result.outputExamples.set(commandPath, outputs);
        }
      }

      // Extract supplementary sections from subdocs
      const subSections = extractSupplementarySections(subDocContent);
      result.supplementary.push(...subSections);
    }
  } catch {
    // Subdirectory doesn't exist — that's fine
  }

  return result;
}

/**
 * Load examples for a specific command from docs (backward-compatible wrapper)
 */
async function loadCommandExamples(
  commandGroup: string
): Promise<Map<string, string[]>> {
  const docs = await loadCommandDocs(commandGroup);
  return docs.examples;
}

/**
 * Load supplementary content from commands/index.md
 */
async function loadCommandsOverview(): Promise<{
  jsonOutput: string;
  webFlag: string;
} | null> {
  const content = await loadDoc("commands/index.md");

  if (!content) {
    return null;
  }

  const jsonSection = extractSection(content, "JSON Output");
  const webSection = extractSection(content, "Opening in Browser");

  return {
    jsonOutput: jsonSection || "",
    webFlag: webSection || "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Introspection
// ─────────────────────────────────────────────────────────────────────────────

function isRouteMap(target: RouteTarget): target is RouteMap {
  return "getAllEntries" in target;
}

function isCommand(target: RouteTarget): target is Command {
  return "parameters" in target && !("getAllEntries" in target);
}

type CommandInfo = {
  path: string;
  brief: string;
  fullDescription?: string;
  flags: FlagInfo[];
  positional: string;
  aliases: Record<string, string>;
  examples: string[];
  description?: string;
  outputExamples: string[];
};

type FlagInfo = {
  name: string;
  brief: string;
  kind: "boolean" | "parsed";
  default?: unknown;
  optional: boolean;
  variadic: boolean;
};

type RouteInfo = {
  name: string;
  brief: string;
  commands: CommandInfo[];
  supplementary: { heading: string; content: string }[];
};

/**
 * Extract positional parameter placeholder string
 */
function getPositionalString(params?: PositionalParams): string {
  if (!params) {
    return "";
  }

  if (params.kind === "tuple") {
    return params.parameters
      .map((p, i) => `<${p.placeholder ?? `arg${i}`}>`)
      .join(" ");
  }

  if (params.kind === "array") {
    const placeholder = params.parameter.placeholder ?? "args";
    return `<${placeholder}...>`;
  }

  return "";
}

/**
 * Extract flag information from a command
 */
function extractFlags(flags: Record<string, FlagDef> | undefined): FlagInfo[] {
  if (!flags) {
    return [];
  }

  return Object.entries(flags).map(([name, def]) => ({
    name,
    brief: def.brief ?? "",
    kind: def.kind,
    default: def.default,
    optional: def.optional ?? def.kind === "boolean",
    variadic: def.variadic ?? false,
  }));
}

/**
 * Build a CommandInfo from a Command
 */
function buildCommandInfo(
  cmd: Command,
  path: string,
  extras: {
    examples?: string[];
    description?: string;
    outputExamples?: string[];
  } = {}
): CommandInfo {
  return {
    path,
    brief: cmd.brief,
    fullDescription: cmd.fullDescription,
    flags: extractFlags(cmd.parameters.flags),
    positional: getPositionalString(cmd.parameters.positional),
    aliases: cmd.parameters.aliases ?? {},
    examples: extras.examples ?? [],
    description: extras.description,
    outputExamples: extras.outputExamples ?? [],
  };
}

/**
 * Extract commands from a route group
 */
function extractRouteGroupCommands(
  routeMap: RouteMap,
  routeName: string,
  docs: DocExamples
): CommandInfo[] {
  const commands: CommandInfo[] = [];

  for (const subEntry of routeMap.getAllEntries()) {
    if (subEntry.hidden) {
      continue;
    }

    const subTarget = subEntry.target;
    if (isCommand(subTarget)) {
      const path = `sentry ${routeName} ${subEntry.name.original}`;
      commands.push(
        buildCommandInfo(subTarget, path, {
          examples: docs.examples.get(path) ?? [],
          description: docs.prose.get(path),
          outputExamples: docs.outputExamples.get(path) ?? [],
        })
      );
    }
  }

  return commands;
}

/**
 * Walk the route tree and extract command information
 */
async function extractRoutes(routeMap: RouteMap): Promise<RouteInfo[]> {
  const result: RouteInfo[] = [];

  for (const entry of routeMap.getAllEntries()) {
    if (entry.hidden) {
      continue;
    }

    const routeName = entry.name.original;
    const target = entry.target;

    // Load full docs for this route
    const docs = await loadCommandDocs(routeName);

    if (isRouteMap(target)) {
      result.push({
        name: routeName,
        brief: target.brief,
        commands: extractRouteGroupCommands(target, routeName, docs),
        supplementary: docs.supplementary,
      });
    } else if (isCommand(target)) {
      const path = `sentry ${routeName}`;
      result.push({
        name: routeName,
        brief: target.brief,
        commands: [
          buildCommandInfo(target, path, {
            examples: docs.examples.get(path) ?? [],
            description: docs.prose.get(path),
            outputExamples: docs.outputExamples.get(path) ?? [],
          }),
        ],
        supplementary: docs.supplementary,
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the front matter for the skill file
 */
function generateFrontMatter(): string {
  return `---
name: sentry-cli
description: Guide for using the Sentry CLI to interact with Sentry from the command line. Use when the user asks about viewing issues, events, projects, organizations, making API calls, or authenticating with Sentry via CLI.
---`;
}

/**
 * Format a flag for display in documentation
 */
function formatFlag(flag: FlagInfo, aliases: Record<string, string>): string {
  const parts: string[] = [];

  // Find alias for this flag
  const alias = Object.entries(aliases).find(([, v]) => v === flag.name)?.[0];

  // Build flag syntax
  let syntax = `--${flag.name}`;
  if (alias) {
    syntax = `-${alias}, ${syntax}`;
  }

  if (flag.kind === "parsed" && !flag.variadic) {
    syntax += " <value>";
  } else if (flag.variadic) {
    syntax += " <value>...";
  }

  parts.push(syntax);

  // Add description
  if (flag.brief) {
    parts.push(flag.brief);
  }

  // Add default if present
  if (flag.default !== undefined && flag.kind !== "boolean") {
    parts.push(`(default: ${JSON.stringify(flag.default)})`);
  }

  return parts.join(" - ");
}

/**
 * Generate documentation for a single command.
 *
 * @param cmd - Command metadata
 * @param headingLevel - Heading depth for the command title (default 4 = ####)
 */
function generateCommandDoc(cmd: CommandInfo, headingLevel = 4): string {
  const lines: string[] = [];

  // Command signature
  const signature = cmd.positional ? `${cmd.path} ${cmd.positional}` : cmd.path;
  const hashes = "#".repeat(headingLevel);

  lines.push(`${hashes} \`${signature}\``);
  lines.push("");
  lines.push(cmd.brief);

  // Prose description from docs (if substantially richer than the brief)
  if (cmd.description && cmd.description.length > cmd.brief.length + 20) {
    // Strip the leading brief text if duplicated, keep the rest
    const briefNorm = cmd.brief.replace(/\.$/, "").toLowerCase();
    const descNorm = cmd.description.replace(/\.$/, "").toLowerCase();
    if (briefNorm === descNorm) {
      // Exact match — skip
    } else if (descNorm.startsWith(briefNorm)) {
      // Description starts with brief — strip the duplicated prefix
      const extra = cmd.description.slice(cmd.brief.replace(/\.$/, "").length).trim();
      // Remove leading period/newline if present
      const cleaned = extra.replace(/^[.\s]+/, "").trim();
      if (cleaned.length > 20) {
        lines.push("");
        lines.push(cleaned);
      }
    } else {
      lines.push("");
      lines.push(cmd.description);
    }
  }

  // Flags section
  const visibleFlags = cmd.flags.filter(
    (f) => f.name !== "help" && f.name !== "helpAll"
  );

  if (visibleFlags.length > 0) {
    lines.push("");
    lines.push("**Flags:**");
    for (const flag of visibleFlags) {
      lines.push(`- \`${formatFlag(flag, cmd.aliases)}\``);
    }
  }

  // Examples section (from docs)
  if (cmd.examples.length > 0) {
    lines.push("");
    lines.push("**Examples:**");
    lines.push("");
    lines.push("```bash");
    // Join examples with blank lines between them
    lines.push(cmd.examples.join("\n\n"));
    lines.push("```");
  }

  // Output examples
  if (cmd.outputExamples.length > 0) {
    lines.push("");
    lines.push("**Expected output:**");
    lines.push("");
    lines.push("```");
    lines.push(cmd.outputExamples.join("\n\n"));
    lines.push("```");
  }

  return lines.join("\n");
}

/**
 * Generate documentation for a route group.
 *
 * @param route - Route metadata
 * @param headingLevel - Base heading depth for the group title (default 3 = ###)
 */
function generateRouteDoc(route: RouteInfo, headingLevel = 3): string {
  const lines: string[] = [];

  // Section header
  const titleCase = route.name.charAt(0).toUpperCase() + route.name.slice(1);
  const hashes = "#".repeat(headingLevel);
  lines.push(`${hashes} ${titleCase}`);
  lines.push("");
  lines.push(route.brief);
  lines.push("");

  // Commands in this route
  for (const cmd of route.commands) {
    lines.push(generateCommandDoc(cmd, headingLevel + 1));
    lines.push("");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enrichment content per command group.
 * Contains workflows, query patterns, and integration recipes.
 */
type GroupEnrichment = {
  workflows?: string;
  queries?: string;
  recipes?: string;
};

const ENRICHMENT: Record<string, GroupEnrichment> = {
  auth: {
    workflows: `### First-time setup
1. Install: \`curl https://cli.sentry.dev/install -fsS | bash\`
2. Authenticate: \`sentry auth login\`
3. Verify: \`sentry auth status\`
4. Explore: \`sentry org list\`

### CI/CD authentication
1. Create an API token at https://sentry.io/settings/account/api/auth-tokens/
2. Set token: \`sentry auth login --token $SENTRY_TOKEN\`
3. Verify: \`sentry auth status\``,
  },
  issue: {
    workflows: `### Diagnose a production issue
1. Find the issue: \`sentry issue list <org>/<project> --query "is:unresolved" --sort freq\`
2. View details: \`sentry issue view <issue-id>\`
3. Get AI root cause: \`sentry issue explain <issue-id>\`
4. Get fix plan: \`sentry issue plan <issue-id>\`
5. Open in browser for full context: \`sentry issue view <issue-id> -w\`

### Triage recent regressions
1. List new issues: \`sentry issue list <org>/<project> --sort new --period 24h\`
2. Check frequency: \`sentry issue list <org>/<project> --sort freq --limit 5\`
3. Investigate top issue: \`sentry issue view <issue-id>\`
4. Explain root cause: \`sentry issue explain <issue-id>\``,
    queries: `- Unresolved errors: \`--query "is:unresolved"\`
- Specific error type: \`--query "TypeError"\`
- By environment: \`--query "environment:production"\`
- Assigned to me: \`--query "assigned:me"\`
- Recent issues: \`--period 24h\`
- Most frequent: \`--sort freq --limit 10\`
- Combined: \`--query "is:unresolved environment:production" --sort freq\``,
    recipes: `- Extract issue titles: \`sentry issue list <org>/<project> --json | jq '.[].title'\`
- Get issue counts: \`sentry issue list <org>/<project> --json | jq '.[].count'\`
- List unresolved as CSV: \`sentry issue list <org>/<project> --json --query "is:unresolved" | jq -r '.[] | [.shortId, .title, .count] | @csv'\``,
  },
  event: {
    workflows: `### Investigate an error event
1. Find the event ID from \`sentry issue view <issue-id>\` output
2. View event details: \`sentry event view <event-id>\`
3. Open in browser for full stack trace: \`sentry event view <event-id> -w\``,
  },
  log: {
    workflows: `### Monitor production logs
1. Stream all logs: \`sentry log list -f\`
2. Filter to errors only: \`sentry log list -f -q 'level:error'\`
3. Investigate a specific log: \`sentry log view <log-id>\`

### Debug a specific issue
1. Filter by message content: \`sentry log list -q 'database timeout'\`
2. View error details: \`sentry log view <log-id>\`
3. Check related trace: follow the Trace ID from the log view output`,
    queries: `- Error logs only: \`-q 'level:error'\`
- Warning and above: \`-q 'level:warning'\`
- By message content: \`-q 'database'\`
- Limit results: \`--limit 50\`
- Stream with interval: \`-f 5\` (poll every 5 seconds)`,
    recipes: `- Extract error messages: \`sentry log list --json -q 'level:error' | jq '.[].message'\`
- Filter by level in JSON: \`sentry log list --json | jq '.[] | select(.level == "error")'\``,
  },
  trace: {
    workflows: `### Investigate slow requests
1. List recent traces: \`sentry trace list --sort duration\`
2. View slowest trace: \`sentry trace view <trace-id>\`
3. Open in browser for waterfall view: \`sentry trace view <trace-id> -w\``,
    queries: `- Sort by duration: \`--sort duration\`
- Search traces: \`--query "http.method:GET"\`
- Limit results: \`--limit 50\``,
  },
  api: {
    workflows: `### Bulk update issues
1. Find issues: \`sentry api /projects/<org>/<project>/issues/?query=is:unresolved --paginate\`
2. Update status: \`sentry api /issues/<id>/ --method PUT --field status=resolved\`
3. Assign issue: \`sentry api /issues/<id>/ --method PUT --field assignedTo="user@example.com"\`

### Explore the API
1. List organizations: \`sentry api /organizations/\`
2. List projects: \`sentry api /organizations/<org>/projects/\`
3. Check rate limits: \`sentry api /organizations/ --include\``,
    recipes: `- Get organization slugs: \`sentry api /organizations/ | jq '.[].slug'\`
- List project slugs: \`sentry api /organizations/<org>/projects/ | jq '.[].slug'\`
- Count issues by status: \`sentry api /projects/<org>/<project>/issues/?query=is:unresolved | jq 'length'\``,
  },
  cli: {
    workflows: `### Update the CLI
1. Check for updates: \`sentry cli upgrade --check\`
2. Upgrade: \`sentry cli upgrade\`

### Switch to nightly builds
1. Switch channel: \`sentry cli upgrade nightly\`
2. Subsequent updates track nightly: \`sentry cli upgrade\`
3. Switch back to stable: \`sentry cli upgrade stable\``,
  },
  init: {
    workflows: `### Set up a new project
1. Navigate to project: \`cd my-app\`
2. Authenticate: \`sentry auth login\`
3. Preview changes: \`sentry init --dry-run\`
4. Run the wizard: \`sentry init\`

### Non-interactive CI setup
1. \`sentry auth login --token $SENTRY_TOKEN\`
2. \`sentry init --yes --features errors,tracing\``,
  },
  org: {
    recipes: `- Get org slugs: \`sentry org list --json | jq '.[].slug'\``,
  },
  project: {
    recipes: `- List project slugs: \`sentry project list --json | jq '.[].slug'\`
- Filter by platform: \`sentry project list --platform python --json | jq '.[].name'\``,
  },
  repo: {
    workflows: `### Check linked repositories
1. List repos: \`sentry repo list\`
2. Get details as JSON: \`sentry repo list --json\`
3. Use the API for more details: \`sentry api /organizations/<org>/repos/\``,
    recipes: `- Get repo names: \`sentry repo list --json | jq '.[].name'\`
- Get repo providers: \`sentry repo list --json | jq '.[] | {name, provider}'\``,
  },
  team: {
    workflows: `### Find teams and their projects
1. List teams: \`sentry team list\`
2. Get team details via API: \`sentry api /teams/<org>/<team>/\`
3. List team projects: \`sentry api /teams/<org>/<team>/projects/\``,
    recipes: `- Get team slugs: \`sentry team list --json | jq '.[].slug'\`
- Count teams: \`sentry team list --json | jq 'length'\``,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Multi-File Generation
// ─────────────────────────────────────────────────────────────────────────────

/** Preferred order for routes in the index table */
const ROUTE_ORDER = [
  "auth",
  "org",
  "project",
  "issue",
  "event",
  "api",
  "cli",
  "repo",
  "team",
  "log",
  "trace",
  "init",
];

/**
 * Sort routes by preferred display order
 */
function sortRoutes(routeInfos: RouteInfo[]): RouteInfo[] {
  return [...routeInfos].sort((a, b) => {
    const aIndex = ROUTE_ORDER.indexOf(a.name);
    const bIndex = ROUTE_ORDER.indexOf(b.name);
    const aOrder = aIndex === -1 ? 999 : aIndex;
    const bOrder = bIndex === -1 ? 999 : bIndex;
    return aOrder - bOrder;
  });
}

/**
 * Determine which reference file a route belongs to.
 * Shortcuts map to their parent; regular routes map to themselves.
 */
function getReferenceGroup(routeName: string): string | null {
  if (routeName === "help") {
    return null; // Skip help command
  }
  return SHORTCUT_TO_PARENT[routeName] ?? routeName;
}

/**
 * Group routes by reference file.
 * Returns a map from reference filename (without .md) to { primary route, shortcut routes }.
 */
function groupRoutesByReference(routeInfos: RouteInfo[]): Map<
  string,
  { primary: RouteInfo; shortcuts: RouteInfo[] }
> {
  const groups = new Map<
    string,
    { primary: RouteInfo; shortcuts: RouteInfo[] }
  >();

  for (const route of routeInfos) {
    const group = getReferenceGroup(route.name);
    if (!group) {
      continue;
    }

    const existing = groups.get(group);
    if (SHORTCUT_TO_PARENT[route.name]) {
      // This is a shortcut
      if (existing) {
        existing.shortcuts.push(route);
      } else {
        groups.set(group, { primary: undefined!, shortcuts: [route] });
      }
    } else {
      // This is the primary route
      if (existing) {
        existing.primary = route;
      } else {
        groups.set(group, { primary: route, shortcuts: [] });
      }
    }
  }

  return groups;
}

/**
 * Generate the SKILL.md index file content.
 */
async function generateIndex(routeInfos: RouteInfo[]): Promise<string> {
  const sorted = sortRoutes(routeInfos);
  const prerequisites = await loadPrerequisites();
  const overview = await loadCommandsOverview();

  const lines: string[] = [];

  // Front matter
  lines.push(generateFrontMatter());
  lines.push("");

  // Title + description
  lines.push("# Sentry CLI Usage Guide");
  lines.push("");
  lines.push(
    "Help users interact with Sentry from the command line using the `sentry` CLI."
  );
  lines.push("");

  // Prerequisites
  lines.push(prerequisites);
  lines.push("");

  // Command table
  lines.push("## Available Commands");
  lines.push("");
  lines.push("| Command | Description | Reference |");
  lines.push("|---------|-------------|-----------|");

  // Track which reference groups we've already listed
  const listedGroups = new Set<string>();

  for (const route of sorted) {
    const group = getReferenceGroup(route.name);
    if (!group || listedGroups.has(group)) {
      continue;
    }
    listedGroups.add(group);

    const titleCase = group.charAt(0).toUpperCase() + group.slice(1);
    lines.push(
      `| \`sentry ${group}\` | ${route.brief} | [${titleCase} commands](references/${group}.md) |`
    );
  }

  lines.push("");

  // Output Formats section
  lines.push("## Output Formats");
  lines.push("");

  if (overview?.jsonOutput) {
    lines.push("### JSON Output");
    lines.push("");
    lines.push(overview.jsonOutput);
    lines.push("");
  } else {
    lines.push(
      "Most commands support `--json` flag for JSON output, making it easy to integrate with other tools."
    );
    lines.push("");
  }

  if (overview?.webFlag) {
    lines.push("### Opening in Browser");
    lines.push("");
    lines.push(overview.webFlag);
  } else {
    lines.push(
      "View commands support `-w` or `--web` flag to open the resource in your browser."
    );
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * Generate a reference file for a command group.
 */
function generateReferenceFile(
  primary: RouteInfo,
  shortcuts: RouteInfo[]
): string {
  const lines: string[] = [];
  const groupName = primary.name;
  const titleCase = groupName.charAt(0).toUpperCase() + groupName.slice(1);

  // Title
  lines.push(`# ${titleCase} Commands`);
  lines.push("");
  lines.push(primary.brief);
  lines.push("");

  // Commands (using # → ## hierarchy for reference files)
  for (const cmd of primary.commands) {
    lines.push(generateCommandDoc(cmd, 2));
    lines.push("");
  }

  // Shortcuts section (with flag note)
  if (shortcuts.length > 0) {
    lines.push("## Shortcuts");
    lines.push("");
    for (const shortcut of shortcuts) {
      const shortcutCmd = shortcut.commands[0];
      if (shortcutCmd) {
        // Find the primary command whose brief matches the shortcut's brief
        const matchingCmd = primary.commands.find(
          (c) => c.brief === shortcutCmd.brief
        );
        const targetPath =
          matchingCmd?.path ?? primary.commands[0]?.path ?? `sentry ${groupName}`;
        lines.push(
          `- \`sentry ${shortcut.name}\` → shortcut for \`${targetPath}\` (accepts the same flags)`
        );
      }
    }
    lines.push("");
  }

  // Supplementary sections from docs (deduplicated by heading)
  if (primary.supplementary.length > 0) {
    const seen = new Set<string>();
    for (const section of primary.supplementary) {
      if (seen.has(section.heading)) continue;
      seen.add(section.heading);
      lines.push(`## ${section.heading}`);
      lines.push("");
      lines.push(section.content);
      lines.push("");
    }
  }

  // Enrichment: workflows, queries, recipes
  const enrichment = ENRICHMENT[groupName];
  if (enrichment) {
    if (enrichment.workflows) {
      lines.push("## Workflows");
      lines.push("");
      lines.push(enrichment.workflows);
      lines.push("");
    }

    if (enrichment.queries) {
      lines.push("## Common Queries");
      lines.push("");
      lines.push(enrichment.queries);
      lines.push("");
    }

    if (enrichment.recipes) {
      lines.push("## JSON Recipes");
      lines.push("");
      lines.push(enrichment.recipes);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Generate the index.json manifest for remote installation.
 */
function generateIndexJson(referenceFiles: string[]): string {
  const files = [
    "SKILL.md",
    ...referenceFiles.map((f) => `references/${f}.md`),
  ];

  const index = {
    skills: [
      {
        name: "sentry-cli",
        description:
          "Guide for using the Sentry CLI to interact with Sentry from the command line. Use when the user asks about viewing issues, events, projects, organizations, making API calls, or authenticating with Sentry via CLI.",
        files,
      },
    ],
  };

  return JSON.stringify(index, null, 2) + "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const routeInfos = await extractRoutes(routes as unknown as RouteMap);
const groups = groupRoutesByReference(routeInfos);

// Clean and recreate references directory
rmSync(REFERENCES_DIR, { recursive: true, force: true });
mkdirSync(REFERENCES_DIR, { recursive: true });

// Write SKILL.md index
const indexContent = await generateIndex(routeInfos);
await Bun.write(`${OUTPUT_DIR}/SKILL.md`, indexContent);

// Write reference files in ROUTE_ORDER
const referenceFiles: string[] = [];
for (const groupName of ROUTE_ORDER) {
  const group = groups.get(groupName);
  if (!group?.primary) {
    continue;
  }
  referenceFiles.push(groupName);
  const content = generateReferenceFile(group.primary, group.shortcuts);
  await Bun.write(`${REFERENCES_DIR}/${groupName}.md`, content);
}

// Also write any groups not in ROUTE_ORDER (future-proofing)
for (const [groupName, group] of groups) {
  if (!ROUTE_ORDER.includes(groupName) && group.primary) {
    referenceFiles.push(groupName);
    const content = generateReferenceFile(group.primary, group.shortcuts);
    await Bun.write(`${REFERENCES_DIR}/${groupName}.md`, content);
  }
}

// Write index.json
await Bun.write(INDEX_JSON_PATH, generateIndexJson(referenceFiles));

console.log(`Generated ${OUTPUT_DIR}/SKILL.md`);
console.log(
  `Generated ${referenceFiles.length} reference files in ${REFERENCES_DIR}/`
);
console.log(`Generated ${INDEX_JSON_PATH}`);
