#!/usr/bin/env bun
/**
 * Generate Command Reference Documentation from Stricli Command Metadata
 *
 * Introspects the CLI's route tree to generate accurate command reference
 * pages for the documentation website. Flags, arguments, and aliases are
 * extracted directly from source code, preventing documentation drift.
 *
 * Each page has two sections separated by a marker comment:
 *   1. Auto-generated reference (above marker) — flags, args, descriptions
 *   2. Hand-written custom content (below marker) — examples, guides, tips
 *
 * Custom content below the marker is preserved across regeneration.
 *
 * Usage:
 *   bun run script/generate-command-docs.ts
 *
 * Output:
 *   docs/src/content/docs/commands/{route}.md (one per visible route)
 *   docs/src/content/docs/commands/index.md   (commands overview table)
 */

import { rmSync } from "node:fs";
import { routes } from "../src/app.js";
import type {
  CommandInfo,
  FlagInfo,
  PositionalInfo,
  RouteInfo,
  RouteMap,
} from "../src/lib/introspect.js";
import { extractAllRoutes } from "../src/lib/introspect.js";

const DOCS_DIR = "docs/src/content/docs/commands";
const INDEX_PATH = `${DOCS_DIR}/index.md`;

/**
 * Marker comment separating auto-generated reference content from
 * hand-written custom content. Everything above this line is regenerated;
 * everything below is preserved.
 */
const GENERATED_END_MARKER = "<!-- GENERATED:END -->";

/**
 * Flag names that are auto-injected by the buildCommand wrapper and
 * documented in the global footer rather than per-command.
 */
const GLOBAL_FLAG_NAMES = new Set([
  "json",
  "fields",
  "help",
  "helpAll",
  "log-level",
]);

/** Routes that don't need their own documentation page */
const SKIP_ROUTES = new Set(["help"]);

// ---------------------------------------------------------------------------
// Markdown Formatting
// ---------------------------------------------------------------------------

/**
 * Get visible, non-global flags for a command.
 * Excludes hidden flags and globally-injected flags (--json, --fields, etc.).
 */
function getVisibleFlags(cmd: CommandInfo): FlagInfo[] {
  return cmd.flags.filter((f) => !(f.hidden || GLOBAL_FLAG_NAMES.has(f.name)));
}

/**
 * Format a flag as a table row: `| -q, --query <query> | Search query ... |`
 *
 * Uses the flag name as the value placeholder for readability
 * (e.g., `--limit <limit>` instead of `--limit <value>`).
 */
function formatFlagRow(
  flag: FlagInfo,
  aliases: Record<string, string>
): string {
  const alias = Object.entries(aliases).find(([, v]) => v === flag.name)?.[0];

  let syntax = `--${flag.name}`;
  if (alias) {
    syntax = `-${alias}, ${syntax}`;
  }
  if ((flag.kind === "parsed" || flag.kind === "enum") && !flag.variadic) {
    syntax += ` <${flag.name}>`;
  } else if (flag.variadic) {
    syntax += ` <${flag.name}>...`;
  }

  let desc = flag.brief;
  // Only append default if the brief doesn't already mention it
  if (
    flag.default !== undefined &&
    flag.kind !== "boolean" &&
    !desc.includes("default:")
  ) {
    desc += ` (default: ${JSON.stringify(flag.default)})`;
  }

  return `| \`${syntax}\` | ${desc} |`;
}

/**
 * Escape angle brackets in text so they render as literal `<` / `>`
 * in HTML output rather than being interpreted as HTML tags.
 */
function escapeAngleBrackets(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format positional arguments as a markdown table */
function formatPositionalsTable(positionals: PositionalInfo[]): string {
  if (positionals.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("**Arguments:**");
  lines.push("");
  lines.push("| Argument | Description |");
  lines.push("|----------|-------------|");
  for (const p of positionals) {
    const placeholder = `\`<${p.placeholder}>\``;
    const suffix = p.optional ? " (optional)" : "";
    lines.push(`| ${placeholder} | ${escapeAngleBrackets(p.brief)}${suffix} |`);
  }
  return lines.join("\n");
}

/** Format flags as a markdown options table */
function formatFlagsTable(
  flags: FlagInfo[],
  aliases: Record<string, string>
): string {
  if (flags.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("**Options:**");
  lines.push("");
  lines.push("| Option | Description |");
  lines.push("|--------|-------------|");
  for (const flag of flags) {
    lines.push(formatFlagRow(flag, aliases));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Page Generation
// ---------------------------------------------------------------------------

/** Generate the auto-generated reference section for a single command */
function generateCommandSection(cmd: CommandInfo): string {
  const lines: string[] = [];

  // Command heading
  const signature = cmd.positional ? `${cmd.path} ${cmd.positional}` : cmd.path;
  lines.push(`### \`${signature}\``);
  lines.push("");
  lines.push(cmd.brief);

  // Arguments table
  if (cmd.positionals.length > 0) {
    lines.push("");
    lines.push(formatPositionalsTable(cmd.positionals));
  }

  // Options table
  const visibleFlags = getVisibleFlags(cmd);
  if (visibleFlags.length > 0) {
    lines.push("");
    lines.push(formatFlagsTable(visibleFlags, cmd.aliases));
  }

  return lines.join("\n");
}

/** Determine if a route is a standalone command (not a group with subcommands) */
function isStandaloneCommand(route: RouteInfo): boolean {
  return (
    route.commands.length === 1 &&
    route.commands[0].path === `sentry ${route.name}`
  );
}

/**
 * Generate the full auto-generated portion of a command doc page.
 *
 * Includes frontmatter, intro, per-command reference sections,
 * and the global flags footer.
 */
function generatePage(route: RouteInfo): string {
  const standalone = isStandaloneCommand(route);
  const description = standalone
    ? `${capitalize(route.name)} command for the Sentry CLI`
    : `${capitalize(route.name)} commands for the Sentry CLI`;

  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`title: ${route.name}`);
  lines.push(`description: ${description}`);
  lines.push("---");
  lines.push("");

  // Intro
  lines.push(route.brief);
  lines.push("");

  // Section heading
  lines.push(standalone ? "## Usage" : "## Commands");
  lines.push("");

  // Per-command sections
  for (const cmd of route.commands) {
    lines.push(generateCommandSection(cmd));
    lines.push("");
  }

  // Global flags footer
  lines.push(
    "All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields."
  );
  lines.push("");

  // End marker
  lines.push(GENERATED_END_MARKER);

  return lines.join("\n");
}

/** Known acronyms that should be fully uppercased in titles */
const ACRONYMS = new Set(["api", "cli"]);

function capitalize(s: string): string {
  if (ACRONYMS.has(s)) {
    return s.toUpperCase();
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Index Table Generation
// ---------------------------------------------------------------------------

/** Route display order for the commands index table */
const INDEX_ORDER = [
  "auth",
  "cli",
  "org",
  "project",
  "team",
  "issue",
  "event",
  "log",
  "trace",
  "span",
  "dashboard",
  "sourcemap",
  "repo",
  "trial",
  "init",
  "schema",
  "api",
];

/** Generate the commands table for index.md */
function generateCommandsTable(allRoutes: RouteInfo[]): string {
  const sorted = [...allRoutes].sort((a, b) => {
    const aIdx = INDEX_ORDER.indexOf(a.name);
    const bIdx = INDEX_ORDER.indexOf(b.name);
    const aOrder = aIdx === -1 ? 999 : aIdx;
    const bOrder = bIdx === -1 ? 999 : bIdx;
    return aOrder - bOrder;
  });

  const lines: string[] = [];
  lines.push("| Command | Description |");
  lines.push("|---------|-------------|");
  for (const route of sorted) {
    lines.push(`| [\`${route.name}\`](./${route.name}/) | ${route.brief} |`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Custom Content Preservation
// ---------------------------------------------------------------------------

/**
 * Read existing custom content from below the GENERATED:END marker.
 * Returns empty string if no marker found or file doesn't exist.
 */
async function readCustomContent(filePath: string): Promise<string> {
  try {
    const content = await Bun.file(filePath).text();
    const markerIndex = content.indexOf(GENERATED_END_MARKER);
    if (markerIndex === -1) {
      return "";
    }
    return content.slice(markerIndex + GENERATED_END_MARKER.length);
  } catch {
    return "";
  }
}

/**
 * Read existing index.md and extract content after the commands table.
 * Preserves Global Options, JSON Output, and Opening in Browser sections.
 */
async function readIndexCustomContent(): Promise<string> {
  try {
    const content = await Bun.file(INDEX_PATH).text();
    const markerIndex = content.indexOf(GENERATED_END_MARKER);
    if (markerIndex === -1) {
      return "";
    }
    return content.slice(markerIndex + GENERATED_END_MARKER.length);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const routeMap = routes as unknown as RouteMap;
const routeInfos = extractAllRoutes(routeMap).filter(
  (r) => !SKIP_ROUTES.has(r.name)
);

const generatedFiles: string[] = [];

// Clean up legacy cli/ subdirectory if it exists (we now use cli.md)
try {
  rmSync(`${DOCS_DIR}/cli`, { recursive: true, force: true });
} catch {
  // Directory may not exist
}

// Generate command doc pages
for (const route of routeInfos) {
  const filePath = `${DOCS_DIR}/${route.name}.md`;
  const pageContent = generatePage(route);
  const customContent = await readCustomContent(filePath);
  const fullContent = customContent
    ? pageContent + customContent
    : `${pageContent}\n`;

  await Bun.write(filePath, fullContent);
  generatedFiles.push(filePath);
}

// Update commands/index.md
const indexCustomContent = await readIndexCustomContent();
const indexLines: string[] = [];
indexLines.push("---");
indexLines.push("title: Commands");
indexLines.push("description: Available commands in the Sentry CLI");
indexLines.push("---");
indexLines.push("");
indexLines.push(
  "The Sentry CLI provides commands for interacting with various Sentry resources."
);
indexLines.push("");
indexLines.push("## Available Commands");
indexLines.push("");
indexLines.push(generateCommandsTable(routeInfos));
indexLines.push("");
indexLines.push(GENERATED_END_MARKER);

const indexContent = indexCustomContent
  ? indexLines.join("\n") + indexCustomContent
  : `${indexLines.join("\n")}\n`;

await Bun.write(INDEX_PATH, indexContent);

console.log(
  `Generated ${generatedFiles.length} command doc pages + ${INDEX_PATH}`
);
