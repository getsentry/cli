#!/usr/bin/env bun
/**
 * Generate SKILL.md from Stricli Command Metadata
 *
 * Introspects the CLI's route tree and generates structured documentation
 * for AI agents (Claude Code, Cursor, etc.)
 *
 * Usage:
 *   bun run script/generate-skill.ts
 *
 * Output:
 *   plugins/sentry-cli/skills/sentry-cli/SKILL.md
 */

import { routes } from "../src/app.js";

const OUTPUT_PATH = "plugins/sentry-cli/skills/sentry-cli/SKILL.md";

// ─────────────────────────────────────────────────────────────────────────────
// Types for Stricli Route Introspection
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
function buildCommandInfo(cmd: Command, path: string): CommandInfo {
  return {
    path,
    brief: cmd.brief,
    fullDescription: cmd.fullDescription,
    flags: extractFlags(cmd.parameters.flags),
    positional: getPositionalString(cmd.parameters.positional),
    aliases: cmd.parameters.aliases ?? {},
  };
}

/**
 * Extract commands from a route group
 */
function extractRouteGroupCommands(
  routeMap: RouteMap,
  routeName: string
): CommandInfo[] {
  const commands: CommandInfo[] = [];

  for (const subEntry of routeMap.getAllEntries()) {
    if (subEntry.hidden) {
      continue;
    }

    const subTarget = subEntry.target;
    if (isCommand(subTarget)) {
      const path = `sentry ${routeName} ${subEntry.name.original}`;
      commands.push(buildCommandInfo(subTarget, path));
    }
  }

  return commands;
}

/**
 * Walk the route tree and extract command information
 */
function extractRoutes(routeMap: RouteMap): RouteInfo[] {
  const result: RouteInfo[] = [];

  for (const entry of routeMap.getAllEntries()) {
    if (entry.hidden) {
      continue;
    }

    const routeName = entry.name.original;
    const target = entry.target;

    if (isRouteMap(target)) {
      result.push({
        name: routeName,
        brief: target.brief,
        commands: extractRouteGroupCommands(target, routeName),
      });
    } else if (isCommand(target)) {
      result.push({
        name: routeName,
        brief: target.brief,
        commands: [buildCommandInfo(target, `sentry ${routeName}`)],
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
 * Generate the prerequisites section
 */
function generatePrerequisites(): string {
  return `## Prerequisites

The CLI must be installed and authenticated before use.

### Installation

\`\`\`bash
# npm
npm install -g sentry

# pnpm
pnpm add -g sentry

# bun
bun add -g sentry

# Or run without installing
npx sentry --help
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
 * Generate the Context Auto-Detection section
 */
function generateContextSection(): string {
  return `## Context Auto-Detection

The CLI automatically detects organization and project context from:

1. **CLI flags**: \`--org\` and \`--project\`
2. **Environment variables**: \`SENTRY_DSN\`
3. **Source code scanning**: Finds DSNs in your codebase

This means in most projects, you can simply run:

\`\`\`bash
sentry issue list    # Uses auto-detected org/project
sentry project view  # Shows detected project(s)
\`\`\``;
}

/**
 * Generate the Monorepo Support section
 */
function generateMonorepoSection(): string {
  return `## Monorepo Support

The CLI detects multiple Sentry projects in monorepos:

\`\`\`bash
# Lists issues from all detected projects
sentry issue list

# Shows details for all detected projects
sentry project view
\`\`\`

In multi-project mode, issues are displayed with aliases (e.g., \`f-G\`) for disambiguation.
Use these aliases with commands like \`sentry issue view f-G\`.`;
}

/**
 * Generate the Common Workflows section
 */
function generateWorkflowsSection(): string {
  return `## Common Workflows

### Investigate an Issue

\`\`\`bash
# List recent unresolved issues
sentry issue list --query "is:unresolved" --sort date

# View issue details
sentry issue view PROJ-ABC

# Get AI root cause analysis
sentry issue explain PROJ-ABC

# Open in browser for full context
sentry issue view PROJ-ABC -w
\`\`\`

### Check Project Health

\`\`\`bash
# View project configuration
sentry project view my-project --json

# List recent issues sorted by frequency
sentry issue list --sort freq --limit 10
\`\`\`

### Resolve Issues via API

\`\`\`bash
# Resolve a single issue
sentry api issues/123/ -X PUT -F status=resolved

# Ignore an issue
sentry api issues/123/ -X PUT -F status=ignored -F statusDetails[ignoreDuration]=10080
\`\`\`

### Export Data

\`\`\`bash
# Export issues to JSON
sentry issue list --json > issues.json

# Export organization data
sentry org view my-org --json > org.json
\`\`\``;
}

/**
 * Generate the Output Formats section
 */
function generateOutputFormatsSection(): string {
  return `## Output Formats

All commands support multiple output formats:

- **Default**: Human-readable formatted output
- **\`--json\`**: JSON output for scripting/automation
- **\`-w, --web\`**: Open in browser (where supported)`;
}

/**
 * Generate the Error Resolution section
 */
function generateErrorResolutionSection(): string {
  return `## Error Resolution

**"Not authenticated"**: Run \`sentry auth login\`

**"Organization not found"**: Specify with \`--org\` flag or check \`sentry org list\`

**"Project not found"**: Specify with \`--project\` flag or check \`sentry project list\`

**"No project detected"**: The CLI couldn't find a Sentry DSN in your codebase. Use explicit flags: \`--org my-org --project my-project\``;
}

/**
 * Generate the complete SKILL.md content
 */
function generateSkillMarkdown(routeMap: RouteMap): string {
  const routeInfos = extractRoutes(routeMap);

  const sections = [
    generateFrontMatter(),
    "",
    "# Sentry CLI Usage Guide",
    "",
    "Help users interact with Sentry from the command line using the `sentry` CLI.",
    "",
    generatePrerequisites(),
    "",
    generateCommandsSection(routeInfos),
    generateContextSection(),
    "",
    generateMonorepoSection(),
    "",
    generateWorkflowsSection(),
    "",
    generateOutputFormatsSection(),
    "",
    generateErrorResolutionSection(),
    "",
  ];

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const content = generateSkillMarkdown(routes as unknown as RouteMap);
await Bun.write(OUTPUT_PATH, content);

console.log(`Generated ${OUTPUT_PATH}`);
