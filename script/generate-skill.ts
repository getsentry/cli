#!/usr/bin/env bun
/**
 * Generate SKILL.md from Stricli Command Metadata and Docs
 *
 * Introspects the CLI's route tree and merges with documentation
 * to generate structured documentation for AI agents.
 *
 * Usage:
 *   bun run script/generate-skill.ts
 *
 * Output:
 *   plugins/sentry-cli/skills/sentry-cli/SKILL.md
 */

import { routes } from "../src/app.js";

const OUTPUT_PATH = "plugins/sentry-cli/skills/sentry-cli/SKILL.md";
const DOCS_PATH = "docs/src/content/docs";

/** Regex to match YAML frontmatter at the start of a file */
const FRONTMATTER_REGEX = /^---\n[\s\S]*?\n---\n/;

/** Regex to match code blocks with optional language specifier */
const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;

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
 * Extract a specific section from markdown by heading
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

  // Find the next heading of same or higher level
  const nextHeadingPattern = new RegExp(`^#{1,${headingLevel}}\\s+`, "m");
  const remainingContent = markdown.slice(startIndex);
  const nextMatch = remainingContent.match(nextHeadingPattern);

  const endIndex = nextMatch?.index
    ? startIndex + nextMatch.index
    : markdown.length;

  return markdown.slice(startIndex, endIndex).trim();
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
 * Load prerequisites (installation + authentication) from getting-started.mdx
 */
async function loadPrerequisites(): Promise<string> {
  const content = await loadDoc("getting-started.mdx");

  if (!content) {
    return getDefaultPrerequisites();
  }

  const lines: string[] = [];
  lines.push("## Prerequisites");
  lines.push("");
  lines.push("The CLI must be installed and authenticated before use.");
  lines.push("");

  // Extract Installation section
  const installSection = extractSection(content, "Installation");
  if (installSection) {
    lines.push("### Installation");
    lines.push("");
    // Get the bash code blocks from install section
    const codeBlocks = extractCodeBlocks(installSection, "bash");
    if (codeBlocks.length > 0) {
      lines.push("```bash");
      // Include install script and npm as primary options
      lines.push("# Install script");
      lines.push("curl https://cli.sentry.dev/install -fsS | bash");
      lines.push("");
      lines.push("# Or use npm/pnpm/bun");
      lines.push("npm install -g sentry");
      lines.push("```");
    }
  }

  lines.push("");

  // Extract Authentication section
  const authSection = extractSection(content, "Authentication");
  if (authSection) {
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
 * Load examples for a specific command from docs
 */
async function loadCommandExamples(
  commandGroup: string
): Promise<Map<string, string[]>> {
  const docContent = await loadDoc(`commands/${commandGroup}.md`);
  const examples = new Map<string, string[]>();

  if (!docContent) {
    return examples;
  }

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
    match = commandPattern.exec(docContent);
  }

  return examples;
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
  examples: string[] = []
): CommandInfo {
  return {
    path,
    brief: cmd.brief,
    fullDescription: cmd.fullDescription,
    flags: extractFlags(cmd.parameters.flags),
    positional: getPositionalString(cmd.parameters.positional),
    aliases: cmd.parameters.aliases ?? {},
    examples,
  };
}

/**
 * Extract commands from a route group
 */
function extractRouteGroupCommands(
  routeMap: RouteMap,
  routeName: string,
  docExamples: Map<string, string[]>
): CommandInfo[] {
  const commands: CommandInfo[] = [];

  for (const subEntry of routeMap.getAllEntries()) {
    if (subEntry.hidden) {
      continue;
    }

    const subTarget = subEntry.target;
    if (isCommand(subTarget)) {
      const path = `sentry ${routeName} ${subEntry.name.original}`;
      const examples = docExamples.get(path) ?? [];
      commands.push(buildCommandInfo(subTarget, path, examples));
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

    // Load examples from docs for this route
    const docExamples = await loadCommandExamples(routeName);

    if (isRouteMap(target)) {
      result.push({
        name: routeName,
        brief: target.brief,
        commands: extractRouteGroupCommands(target, routeName, docExamples),
      });
    } else if (isCommand(target)) {
      const path = `sentry ${routeName}`;
      const examples = docExamples.get(path) ?? [];
      result.push({
        name: routeName,
        brief: target.brief,
        commands: [buildCommandInfo(target, path, examples)],
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
 * Generate documentation for a single command
 */
function generateCommandDoc(cmd: CommandInfo): string {
  const lines: string[] = [];

  // Command signature
  const signature = cmd.positional ? `${cmd.path} ${cmd.positional}` : cmd.path;

  lines.push(`#### \`${signature}\``);
  lines.push("");
  lines.push(cmd.brief);

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

  return lines.join("\n");
}

/**
 * Generate documentation for a route group
 */
function generateRouteDoc(route: RouteInfo): string {
  const lines: string[] = [];

  // Section header
  const titleCase = route.name.charAt(0).toUpperCase() + route.name.slice(1);
  lines.push(`### ${titleCase}`);
  lines.push("");
  lines.push(route.brief);
  lines.push("");

  // Commands in this route
  for (const cmd of route.commands) {
    lines.push(generateCommandDoc(cmd));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate the Available Commands section
 */
function generateCommandsSection(routeInfos: RouteInfo[]): string {
  const lines: string[] = [];

  lines.push("## Available Commands");
  lines.push("");

  // Define the order we want routes to appear
  const routeOrder = [
    "help",
    "auth",
    "org",
    "project",
    "issue",
    "event",
    "api",
  ];

  // Sort routes by our preferred order
  const sortedRoutes = [...routeInfos].sort((a, b) => {
    const aIndex = routeOrder.indexOf(a.name);
    const bIndex = routeOrder.indexOf(b.name);
    const aOrder = aIndex === -1 ? 999 : aIndex;
    const bOrder = bIndex === -1 ? 999 : bIndex;
    return aOrder - bOrder;
  });

  for (const route of sortedRoutes) {
    // Skip help command from detailed docs (it's self-explanatory)
    if (route.name === "help") {
      continue;
    }

    lines.push(generateRouteDoc(route));
  }

  return lines.join("\n");
}

/**
 * Generate the Output Formats section from docs
 */
async function generateOutputFormatsSection(): Promise<string> {
  const overview = await loadCommandsOverview();

  const lines: string[] = [];
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

  return lines.join("\n");
}

/**
 * Generate the complete SKILL.md content
 */
async function generateSkillMarkdown(routeMap: RouteMap): Promise<string> {
  const routeInfos = await extractRoutes(routeMap);
  const prerequisites = await loadPrerequisites();
  const outputFormats = await generateOutputFormatsSection();

  const sections = [
    generateFrontMatter(),
    "",
    "# Sentry CLI Usage Guide",
    "",
    "Help users interact with Sentry from the command line using the `sentry` CLI.",
    "",
    prerequisites,
    "",
    generateCommandsSection(routeInfos),
    outputFormats,
    "",
  ];

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const content = await generateSkillMarkdown(routes as unknown as RouteMap);
await Bun.write(OUTPUT_PATH, content);

console.log(`Generated ${OUTPUT_PATH}`);
