#!/usr/bin/env bun
/**
 * Validate doc fragment files.
 *
 * Ensures fragment files stay consistent with the CLI route tree:
 *   1. Every route has a corresponding fragment file (+ index.md)
 *   2. Every fragment file corresponds to an existing route (or is index.md)
 *   3. Fragment files don't accidentally contain frontmatter or the generated marker
 *   4. Top-level fragments (e.g., configuration.md) exist
 *
 * Usage:
 *   bun run script/check-fragments.ts
 */

import { mkdirSync, readdirSync } from "node:fs";
import type { RouteMap } from "../src/lib/introspect.js";

// Ensure skill-content stub exists (see generate-command-docs.ts for rationale)
const SKILL_CONTENT_PATH = "src/generated/skill-content.ts";
if (!(await Bun.file(SKILL_CONTENT_PATH).exists())) {
  mkdirSync("src/generated", { recursive: true });
  await Bun.write(
    SKILL_CONTENT_PATH,
    "export const SKILL_FILES: [string, string][] = [];\n"
  );
}

const { routes } = await import("../src/app.js");
const { extractAllRoutes } = await import("../src/lib/introspect.js");

const FRAGMENTS_DIR = "docs/src/fragments/commands";
const GENERATED_END_MARKER = "<!-- GENERATED:END -->";

/** Routes that don't have doc pages (and therefore no fragments) */
const SKIP_ROUTES = new Set(["help"]);

const MD_EXTENSION_RE = /\.md$/;

const routeMap = routes as unknown as RouteMap;
const routeNames = new Set(
  extractAllRoutes(routeMap)
    .filter((r) => !SKIP_ROUTES.has(r.name))
    .map((r) => r.name)
);

// Expected fragment files: one per route + index
const expectedFragments = new Set([...routeNames, "index"]);

let fragmentFiles: string[];
try {
  fragmentFiles = readdirSync(FRAGMENTS_DIR).filter((f) =>
    MD_EXTENSION_RE.test(f)
  );
} catch {
  console.error(`ERROR: Fragment directory not found: ${FRAGMENTS_DIR}`);
  process.exit(1);
}

const actualFragments = new Set(
  fragmentFiles.map((f) => f.replace(MD_EXTENSION_RE, ""))
);

const errors: string[] = [];

// Check 1: Every route has a fragment
for (const name of expectedFragments) {
  if (!actualFragments.has(name)) {
    errors.push(
      `Missing fragment: ${FRAGMENTS_DIR}/${name}.md (route "${name}" exists but has no fragment file)`
    );
  }
}

// Check 2: Every fragment corresponds to a route
for (const name of actualFragments) {
  if (!expectedFragments.has(name)) {
    errors.push(
      `Stale fragment: ${FRAGMENTS_DIR}/${name}.md (no matching route found — delete it or add the route)`
    );
  }
}

// Check 3: Fragment content validation
for (const file of fragmentFiles) {
  const content = await Bun.file(`${FRAGMENTS_DIR}/${file}`).text();

  if (content.includes("---\ntitle:") || content.startsWith("---\n")) {
    errors.push(
      `Fragment contains frontmatter: ${FRAGMENTS_DIR}/${file} (fragments should only contain custom content, not YAML frontmatter)`
    );
  }

  if (content.includes(GENERATED_END_MARKER)) {
    errors.push(
      `Fragment contains generated marker: ${FRAGMENTS_DIR}/${file} (the "${GENERATED_END_MARKER}" marker should not appear in fragment files)`
    );
  }
}

// ---------------------------------------------------------------------------
// Check 4: Top-level fragments (non-command generated pages)
// ---------------------------------------------------------------------------

const TOP_LEVEL_FRAGMENTS_DIR = "docs/src/fragments";

/** Top-level fragment files that must exist (for generated doc pages) */
const REQUIRED_TOP_LEVEL_FRAGMENTS = ["configuration"];

for (const name of REQUIRED_TOP_LEVEL_FRAGMENTS) {
  const path = `${TOP_LEVEL_FRAGMENTS_DIR}/${name}.md`;
  if (!(await Bun.file(path).exists())) {
    errors.push(
      `Missing top-level fragment: ${path} (required for generated ${name}.md page)`
    );
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`Found ${errors.length} fragment validation error(s):\n`);
  for (const err of errors) {
    console.error(`  ✗ ${err}`);
  }
  process.exit(1);
}

console.log(
  `All ${actualFragments.size} command fragment files valid (${routeNames.size} routes + index)`
);
console.log(
  `All ${REQUIRED_TOP_LEVEL_FRAGMENTS.length} top-level fragment(s) valid`
);
