#!/usr/bin/env bun
/**
 * Validate command doc fragment files.
 *
 * Ensures fragment files in docs/src/fragments/commands/ stay consistent
 * with the CLI route tree:
 *   1. Every route has a corresponding fragment file (+ index.md)
 *   2. Every fragment file corresponds to an existing route (or is index.md)
 *   3. Fragment files don't accidentally contain frontmatter or the generated marker
 *
 * Usage:
 *   bun run script/check-fragments.ts
 */

import { readdirSync } from "node:fs";
import { routes } from "../src/app.js";
import type { RouteMap } from "../src/lib/introspect.js";
import { extractAllRoutes } from "../src/lib/introspect.js";

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

if (errors.length > 0) {
  console.error(`Found ${errors.length} fragment validation error(s):\n`);
  for (const err of errors) {
    console.error(`  ✗ ${err}`);
  }
  process.exit(1);
}

console.log(
  `All ${actualFragments.size} fragment files valid (${routeNames.size} routes + index)`
);
