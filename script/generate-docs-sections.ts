#!/usr/bin/env bun
/**
 * Generate Documentation Sections (Marker-Based)
 *
 * Injects auto-generated content into hand-written documentation files
 * between <!-- GENERATED:START name --> and <!-- GENERATED:END name --> markers.
 *
 * Sections:
 *   - contributing.md:  project structure tree (from route tree + filesystem)
 *   - DEVELOPMENT.md:   OAuth scopes bullet list (from oauth.ts)
 *   - self-hosted.md:   OAuth scopes inline list (from oauth.ts)
 *
 * Unlike generate-command-docs.ts (which produces gitignored files from scratch),
 * this script edits committed files in-place between marker pairs.
 *
 * Usage:
 *   bun run script/generate-docs-sections.ts          # Generate (write)
 *   bun run script/generate-docs-sections.ts --check   # Dry-run, exit 1 if stale
 */

import { mkdirSync } from "node:fs";

// Bootstrap: skill-content stub (same pattern as generate-command-docs.ts)
const SKILL_CONTENT_PATH = "src/generated/skill-content.ts";
const SKILL_CONTENT_STUB =
  "export const SKILL_FILES: [string, string][] = [];\n";
if (!(await Bun.file(SKILL_CONTENT_PATH).exists())) {
  mkdirSync("src/generated", { recursive: true });
  await Bun.write(SKILL_CONTENT_PATH, SKILL_CONTENT_STUB);
}

import type { RouteInfo, RouteMap } from "../src/lib/introspect.js";

const { routes } = await import("../src/app.js");
const { extractAllRoutes } = await import("../src/lib/introspect.js");
const { OAUTH_SCOPES } = await import("../src/lib/oauth.js");

const isCheck = process.argv.includes("--check");

// ---------------------------------------------------------------------------
// Marker Replacement
// ---------------------------------------------------------------------------

/**
 * Replace content between named marker pairs in a string.
 *
 * Expects exactly one pair of markers:
 *   <!-- GENERATED:START sectionName -->
 *   ...content to replace...
 *   <!-- GENERATED:END sectionName -->
 *
 * Returns the string with the content between markers replaced by `generated`.
 * Throws if markers are missing or out of order.
 */
function replaceMarkerSection(
  content: string,
  sectionName: string,
  generated: string
): string {
  const startTag = `<!-- GENERATED:START ${sectionName} -->`;
  const endTag = `<!-- GENERATED:END ${sectionName} -->`;

  const startIdx = content.indexOf(startTag);
  const endIdx = content.indexOf(endTag);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Missing markers for section "${sectionName}": ` +
        `start=${startIdx !== -1}, end=${endIdx !== -1}`
    );
  }
  if (startIdx > endIdx) {
    throw new Error(`Markers out of order for section "${sectionName}"`);
  }

  const before = content.slice(0, startIdx + startTag.length);
  const after = content.slice(endIdx);
  return `${before}\n${generated}\n${after}`;
}

// ---------------------------------------------------------------------------
// Section: Project Structure (contributing.md)
// ---------------------------------------------------------------------------

/** Routes that are excluded from documentation pages and the project tree */
const SKIP_ROUTES = new Set(["help"]);

/**
 * Determine if a route is a standalone command (not a group with subcommands).
 * Standalone commands live as .ts files directly in src/commands/,
 * while groups are subdirectories.
 */
function isStandaloneCommand(route: RouteInfo): boolean {
  return (
    route.commands.length === 1 &&
    route.commands[0].path === `sentry ${route.name}`
  );
}

/**
 * Get subcommand names for a route group (e.g., "list, view, create").
 * Extracts the last path segment from each command's path.
 */
function getSubcommandNames(route: RouteInfo): string[] {
  return route.commands.map((cmd) => {
    const parts = cmd.path.split(" ");
    return parts.at(-1) ?? route.name;
  });
}

/**
 * Generate the project structure tree for contributing.md.
 *
 * Combines static entries (bin.ts, app.ts, etc.) with dynamic
 * command directories/files extracted from the route tree.
 */
function generateProjectStructure(allRoutes: RouteInfo[]): string {
  const lines: string[] = [];
  lines.push("```");
  lines.push("cli/");
  lines.push("├── src/");
  lines.push("│   ├── bin.ts          # Entry point");
  lines.push("│   ├── app.ts          # Stricli application setup");
  lines.push("│   ├── context.ts      # Dependency injection context");
  lines.push("│   ├── commands/       # CLI commands");

  // Separate routes into groups (directories) and standalone (files)
  const groups: RouteInfo[] = [];
  const standalones: RouteInfo[] = [];
  for (const route of allRoutes) {
    if (SKIP_ROUTES.has(route.name)) {
      continue;
    }
    if (isStandaloneCommand(route)) {
      standalones.push(route);
    } else {
      groups.push(route);
    }
  }

  // Sort both alphabetically
  groups.sort((a, b) => a.name.localeCompare(b.name));
  standalones.sort((a, b) => a.name.localeCompare(b.name));

  // Render group directories (always use ├── since standalones follow)
  for (const route of groups) {
    const subcmds = getSubcommandNames(route).join(", ");
    lines.push(`│   │   ├── ${`${route.name}/`.padEnd(13)}# ${subcmds}`);
  }

  // Combine standalone commands with help.ts (which is in SKIP_ROUTES
  // for doc generation but still exists in the filesystem).
  // Add help before sorting so it lands in correct alphabetical position.
  const allStandaloneEntries: { name: string; brief: string }[] =
    standalones.map((r) => ({ name: r.name, brief: r.commands[0].brief }));
  allStandaloneEntries.push({ name: "help", brief: "Help command" });
  allStandaloneEntries.sort((a, b) => a.name.localeCompare(b.name));

  // Render standalone command files
  for (let i = 0; i < allStandaloneEntries.length; i += 1) {
    const entry = allStandaloneEntries[i];
    const isLast = i === allStandaloneEntries.length - 1;
    const prefix = isLast ? "└──" : "├──";
    lines.push(
      `│   │   ${prefix} ${`${entry.name}.ts`.padEnd(13)}# ${entry.brief}`
    );
  }

  lines.push("│   ├── lib/            # Shared utilities");
  lines.push("│   └── types/          # TypeScript types and Zod schemas");
  lines.push("├── test/               # Test files (mirrors src/ structure)");
  lines.push("├── script/             # Build and utility scripts");
  lines.push("├── plugins/            # Agent skill files");
  lines.push(
    "└── docs/               # Documentation site (Astro + Starlight)"
  );
  lines.push("```");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Section: OAuth Scopes (DEVELOPMENT.md, self-hosted.md)
// ---------------------------------------------------------------------------

/**
 * Group OAuth scopes by resource prefix (the part before the colon).
 * Returns groups in insertion order.
 */
function groupScopesByResource(
  scopes: readonly string[]
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const scope of scopes) {
    const resource = scope.split(":")[0];
    const existing = groups.get(resource);
    if (existing) {
      existing.push(scope);
    } else {
      groups.set(resource, [scope]);
    }
  }
  return groups;
}

/**
 * Generate scopes as a bullet list for DEVELOPMENT.md.
 * Groups by resource prefix, each group on one line.
 */
function generateScopesBulletList(scopes: readonly string[]): string {
  const grouped = groupScopesByResource(scopes);
  const lines: string[] = [];
  for (const scopeGroup of grouped.values()) {
    const formatted = scopeGroup.map((s) => `\`${s}\``).join(", ");
    lines.push(`  - ${formatted}`);
  }
  return lines.join("\n");
}

/**
 * Generate scopes as an inline comma-separated list for self-hosted.md.
 */
function generateScopesInline(scopes: readonly string[]): string {
  return scopes.map((s) => `\`${s}\``).join(", ");
}

// ---------------------------------------------------------------------------
// Section Definitions
// ---------------------------------------------------------------------------

type SectionDef = {
  filePath: string;
  sectionName: string;
  generate: () => string;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const routeMap = routes as unknown as RouteMap;
const routeInfos = extractAllRoutes(routeMap);

const sections: SectionDef[] = [
  {
    filePath: "docs/src/content/docs/contributing.md",
    sectionName: "project-structure",
    generate: () => generateProjectStructure(routeInfos),
  },
  {
    filePath: "DEVELOPMENT.md",
    sectionName: "oauth-scopes",
    generate: () => generateScopesBulletList(OAUTH_SCOPES),
  },
  {
    filePath: "docs/src/content/docs/self-hosted.md",
    sectionName: "oauth-scopes",
    generate: () => generateScopesInline(OAUTH_SCOPES),
  },
];

let staleCount = 0;

for (const section of sections) {
  const original = await Bun.file(section.filePath).text();
  const generated = section.generate();
  const updated = replaceMarkerSection(
    original,
    section.sectionName,
    generated
  );

  if (updated !== original) {
    if (isCheck) {
      console.error(`STALE: ${section.filePath} [${section.sectionName}]`);
      staleCount += 1;
    } else {
      await Bun.write(section.filePath, updated);
      console.log(`Updated: ${section.filePath} [${section.sectionName}]`);
    }
  } else {
    console.log(`Up to date: ${section.filePath} [${section.sectionName}]`);
  }
}

if (isCheck && staleCount > 0) {
  console.error(
    `\n${staleCount} section(s) are stale. Run: bun run generate:docs`
  );
  process.exit(1);
}

if (!isCheck) {
  console.log("All docs sections generated.");
}
