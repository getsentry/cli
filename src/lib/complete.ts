/**
 * Shell completion engine.
 *
 * Handles the `__complete` fast-path: parses completion context from
 * shell words, queries the SQLite cache, and outputs suggestions.
 *
 * Designed for minimal startup time — no Stricli boot, no telemetry,
 * no auth check, no API calls. Opens the SQLite cache directly for ~1ms
 * reads. All data comes from caches already populated by normal CLI
 * usage (org_regions, project_cache, project_aliases).
 *
 * Protocol:
 *   Input:  `sentry __complete <word1> <word2> ... <partial>`
 *   Output: One completion per line to stdout (`value\tdescription`)
 *   Exit:   0 on success (even if no completions)
 */

import { getProjectAliases } from "./db/project-aliases.js";
import { getCachedProjectsForOrg } from "./db/project-cache.js";
import { getCachedOrganizations } from "./db/regions.js";
import { fuzzyMatch } from "./fuzzy.js";

/**
 * Completion result with optional description for rich shell display.
 * Shells that support descriptions (zsh, fish) use both fields.
 */
type Completion = {
  value: string;
  description?: string;
};

/**
 * Main entry point for `sentry __complete`.
 *
 * Called from the bin.ts fast-path. Parses the shell words to determine
 * what kind of completion is needed, queries the cache, and writes
 * results to stdout.
 *
 * @param args - The words after `__complete` (COMP_WORDS[1:] from the shell)
 */
export async function handleComplete(args: string[]): Promise<void> {
  // The last word is the partial being completed (may be empty)
  const partial = args.at(-1) ?? "";
  // All preceding words form the command path context
  const precedingWords = args.slice(0, -1);

  let completions: Completion[];

  try {
    completions = await getCompletions(precedingWords, partial);
  } catch {
    // Graceful degradation — if DB fails, return no completions
    completions = [];
  }

  // Write completions to stdout, one per line
  const output = completions
    .map((c) => (c.description ? `${c.value}\t${c.description}` : c.value))
    .join("\n");

  if (output) {
    process.stdout.write(`${output}\n`);
  }
}

/** Commands that accept org/project positional args. */
const ORG_PROJECT_COMMANDS = new Set([
  "issue list",
  "issue view",
  "issue explain",
  "issue plan",
  "project list",
  "project view",
  "project delete",
  "project create",
  "trace list",
  "trace view",
  "trace logs",
  "span list",
  "span view",
  "event view",
  "log list",
  "log view",
  "dashboard list",
]);

/** Commands that accept only an org slug (no project). */
const ORG_ONLY_COMMANDS = new Set([
  "org view",
  "team list",
  "repo list",
  "trial list",
  "trial start",
]);

/**
 * Determine what completions to provide based on the command context.
 *
 * Walks the preceding words to identify the command path, then decides
 * whether to complete org slugs, project slugs, or aliases.
 *
 * @param precedingWords - Words before the partial (determines context)
 * @param partial - The current partial word being completed
 */
export async function getCompletions(
  precedingWords: string[],
  partial: string
): Promise<Completion[]> {
  // Build the command path from preceding words (e.g., "issue list")
  const cmdPath =
    precedingWords.length >= 2
      ? `${precedingWords[0]} ${precedingWords[1]}`
      : "";

  if (ORG_PROJECT_COMMANDS.has(cmdPath)) {
    return await completeOrgSlashProject(partial);
  }

  if (ORG_ONLY_COMMANDS.has(cmdPath)) {
    return await completeOrgSlugs(partial);
  }

  // Not a known command path — no dynamic completions
  return [];
}

/**
 * Fuzzy-match cached org slugs and build completions.
 *
 * Shared by both `completeOrgSlugs` (bare slugs) and the slash variant
 * (slugs with trailing `/`). Avoids duplicating the cache query, fuzzy
 * match, and name lookup logic.
 *
 * @param partial - Partial org slug to match
 * @param formatValue - Transform a matched slug into the completion value
 */
async function matchOrgSlugs(
  partial: string,
  formatValue: (slug: string) => string
): Promise<Completion[]> {
  const orgs = await getCachedOrganizations();
  if (orgs.length === 0) {
    return [];
  }

  const slugs = orgs.map((o) => o.slug);
  const matched = fuzzyMatch(partial, slugs);

  const nameMap = new Map(orgs.map((o) => [o.slug, o.name]));

  return matched.map((slug) => ({
    value: formatValue(slug),
    description: nameMap.get(slug),
  }));
}

/**
 * Complete organization slugs with fuzzy matching.
 *
 * Queries the org_regions cache for all known org slugs and matches
 * them against the partial input.
 *
 * @param partial - Partial org slug to match
 * @returns Completions with org names as descriptions
 */
export function completeOrgSlugs(partial: string): Promise<Completion[]> {
  return matchOrgSlugs(partial, (slug) => slug);
}

/**
 * Complete the `org/project` positional pattern with fuzzy matching.
 *
 * Two modes based on whether the partial contains a slash:
 * - No slash: suggest org slugs with a trailing `/` appended
 * - Has slash: split on first `/`, fuzzy-match project slugs for that org
 *
 * Also includes project aliases (e.g., `A`, `B`) as suggestions.
 *
 * @param partial - The partial input (e.g., "", "sen", "sentry/", "sentry/cl")
 * @returns Completions for org or org/project values
 */
export async function completeOrgSlashProject(
  partial: string
): Promise<Completion[]> {
  const slashIdx = partial.indexOf("/");

  if (slashIdx === -1) {
    // No slash — suggest org slugs (with trailing slash) + aliases
    const [orgCompletions, aliasCompletions] = await Promise.all([
      completeOrgSlugsWithSlash(partial),
      completeAliases(partial),
    ]);
    return [...orgCompletions, ...aliasCompletions];
  }

  // Has slash — complete project within the org.
  // Fuzzy-resolve the org slug first so that "senry/" still finds "sentry" projects.
  const orgPart = partial.slice(0, slashIdx);
  const projectPart = partial.slice(slashIdx + 1);

  const resolvedOrg = await fuzzyResolveOrg(orgPart);
  if (!resolvedOrg) {
    return [];
  }

  return completeProjectSlugs(projectPart, resolvedOrg);
}

/**
 * Complete org slugs and append a trailing `/` to each.
 *
 * When the user types `sentry issue list sen<TAB>`, we want to suggest
 * `sentry/` so they can continue typing the project name.
 */
function completeOrgSlugsWithSlash(partial: string): Promise<Completion[]> {
  return matchOrgSlugs(partial, (slug) => `${slug}/`);
}

/**
 * Complete project slugs for a specific org with fuzzy matching.
 *
 * Reads from the project_cache SQLite table, which is populated by
 * DSN resolution and normal CLI command usage (e.g., `project list`,
 * `issue list`). The HTTP response cache handles API-level caching —
 * we don't make API calls during completion.
 *
 * @param projectPartial - Partial project slug to match
 * @param orgSlug - The org to find projects for
 */
export async function completeProjectSlugs(
  projectPartial: string,
  orgSlug: string
): Promise<Completion[]> {
  const projects = await getCachedProjectsForOrg(orgSlug);

  if (projects.length === 0) {
    return [];
  }

  const slugs = projects.map((p) => p.projectSlug);
  const matched = fuzzyMatch(projectPartial, slugs);

  const nameMap = new Map(projects.map((p) => [p.projectSlug, p.projectName]));

  return matched.map((slug) => ({
    value: `${orgSlug}/${slug}`,
    description: nameMap.get(slug),
  }));
}

/**
 * Fuzzy-resolve an org slug to its canonical form.
 *
 * When the user types `senry/`, we need to find the actual cached org
 * slug `sentry` so we can query projects for it. Returns the best
 * fuzzy match, or the original slug if it matches exactly.
 *
 * @param orgPart - The potentially misspelled org slug
 * @returns The resolved org slug, or undefined if no match
 */
async function fuzzyResolveOrg(orgPart: string): Promise<string | undefined> {
  const orgs = await getCachedOrganizations();
  if (orgs.length === 0) {
    return;
  }

  const slugs = orgs.map((o) => o.slug);
  const matched = fuzzyMatch(orgPart, slugs, { maxResults: 1 });
  return matched[0];
}

/**
 * Complete project aliases (e.g., `A`, `B` from monorepo detection).
 *
 * Aliases are short identifiers that resolve to org/project pairs.
 * They are shown alongside org slug completions.
 */
export async function completeAliases(partial: string): Promise<Completion[]> {
  const aliases = await getProjectAliases();
  if (!aliases) {
    return [];
  }

  const keys = Object.keys(aliases);
  const matched = fuzzyMatch(partial, keys);

  return matched.map((alias) => {
    const entry = aliases[alias];
    return {
      value: alias,
      description: entry ? `${entry.orgSlug}/${entry.projectSlug}` : undefined,
    };
  });
}
