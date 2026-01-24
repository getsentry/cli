/**
 * Alias generation utilities
 *
 * Functions for generating short, unique project aliases from project slugs.
 * Used by issue list to create short identifiers like "e" for "spotlight-electron".
 */

/**
 * Find the common word prefix shared by strings that have word boundaries.
 * Word boundaries are hyphens or underscores.
 *
 * For strings like ["spotlight-electron", "spotlight-website", "spotlight"],
 * finds "spotlight-" as the common prefix among strings with boundaries.
 * Strings without that boundary prefix (like "spotlight") will keep their full name.
 *
 * @param strings - Array of strings to find common prefix for
 * @returns Common prefix including the boundary character, or empty string if none
 *
 * @example
 * findCommonWordPrefix(["spotlight-electron", "spotlight-website", "spotlight"]) // "spotlight-"
 * findCommonWordPrefix(["frontend", "functions", "backend"]) // "" (no common word prefix)
 */
export function findCommonWordPrefix(strings: string[]): string {
  if (strings.length < 2) {
    return "";
  }

  // Extract first "word" (up to and including first boundary) from each string
  const getFirstWord = (s: string): string | null => {
    const lower = s.toLowerCase();
    const boundaryIdx = Math.max(lower.indexOf("-"), lower.indexOf("_"));
    if (boundaryIdx > 0) {
      return lower.slice(0, boundaryIdx + 1);
    }
    return null; // No boundary found
  };

  // Get first words from strings that have boundaries
  const firstWords: string[] = [];
  for (const s of strings) {
    const word = getFirstWord(s);
    if (word) {
      firstWords.push(word);
    }
  }

  // Need at least 2 strings with boundaries to find a common prefix
  if (firstWords.length < 2) {
    return "";
  }

  // Check if all strings with boundaries share the same first word
  const candidate = firstWords[0];
  if (!candidate) {
    return "";
  }

  const allMatch = firstWords.every((w) => w === candidate);
  if (!allMatch) {
    return "";
  }

  return candidate;
}

/**
 * Find the shortest unique prefix for each string in the array.
 * Similar to git's abbreviated commit hashes or terminal auto-completion.
 *
 * @param strings - Array of strings to find unique prefixes for
 * @returns Map from original string to its shortest unique prefix (lowercase)
 *
 * @example
 * findShortestUniquePrefixes(["frontend", "functions", "backend"])
 * // Map { "frontend" => "fr", "functions" => "fu", "backend" => "b" }
 */
export function findShortestUniquePrefixes(
  strings: string[]
): Map<string, string> {
  const result = new Map<string, string>();

  for (const str of strings) {
    const lowerStr = str.toLowerCase();
    let prefixLen = 1;

    // Find the shortest prefix that's unique among all strings
    while (prefixLen <= lowerStr.length) {
      const prefix = lowerStr.slice(0, prefixLen);
      const isUnique = strings.every((other) => {
        if (other === str) {
          return true;
        }
        return !other.toLowerCase().startsWith(prefix);
      });

      if (isUnique) {
        result.set(str, prefix);
        break;
      }
      prefixLen += 1;
    }

    // If no unique prefix found (shouldn't happen with different strings),
    // use the full string
    if (!result.has(str)) {
      result.set(str, lowerStr);
    }
  }

  return result;
}

/** Input pair for org-aware alias generation */
export type OrgProjectPair = {
  org: string;
  project: string;
};

/** Result of org-aware alias generation */
export type OrgAwareAliasResult = {
  /** Map from "org:project" key to alias string */
  aliasMap: Map<string, string>;
  /** Common prefix stripped from project slugs (only for non-colliding projects) */
  strippedPrefix: string;
};

/** Internal: Groups pairs by project slug and identifies collisions */
function groupByProjectSlug(pairs: OrgProjectPair[]): {
  projectToOrgs: Map<string, Set<string>>;
  collidingSlugs: Set<string>;
  uniqueSlugs: Set<string>;
} {
  const projectToOrgs = new Map<string, Set<string>>();
  for (const { org, project } of pairs) {
    const orgs = projectToOrgs.get(project) ?? new Set();
    orgs.add(org);
    projectToOrgs.set(project, orgs);
  }

  const collidingSlugs = new Set<string>();
  const uniqueSlugs = new Set<string>();
  for (const [project, orgs] of projectToOrgs) {
    if (orgs.size > 1) {
      collidingSlugs.add(project);
    } else {
      uniqueSlugs.add(project);
    }
  }

  return { projectToOrgs, collidingSlugs, uniqueSlugs };
}

/** Internal: Processes unique (non-colliding) project slugs */
function processUniqueSlugs(
  pairs: OrgProjectPair[],
  uniqueSlugs: Set<string>,
  aliasMap: Map<string, string>
): string {
  const uniqueProjects = pairs.filter((p) => uniqueSlugs.has(p.project));
  const uniqueProjectSlugs = [...new Set(uniqueProjects.map((p) => p.project))];

  if (uniqueProjectSlugs.length === 0) {
    return "";
  }

  const strippedPrefix = findCommonWordPrefix(uniqueProjectSlugs);
  const slugToRemainder = new Map<string, string>();

  for (const slug of uniqueProjectSlugs) {
    const remainder = slug.slice(strippedPrefix.length);
    slugToRemainder.set(slug, remainder || slug);
  }

  const uniqueRemainders = [...slugToRemainder.values()];
  const uniquePrefixes = findShortestUniquePrefixes(uniqueRemainders);

  for (const { org, project } of uniqueProjects) {
    const remainder = slugToRemainder.get(project) ?? project;
    const alias =
      uniquePrefixes.get(remainder) ?? remainder.charAt(0).toLowerCase();
    aliasMap.set(`${org}:${project}`, alias);
  }

  return strippedPrefix;
}

/** Internal: Processes colliding project slugs that need org prefixes */
function processCollidingSlugs(
  projectToOrgs: Map<string, Set<string>>,
  collidingSlugs: Set<string>,
  aliasMap: Map<string, string>
): void {
  // Get all orgs involved in collisions
  const collidingOrgs = new Set<string>();
  for (const slug of collidingSlugs) {
    const orgs = projectToOrgs.get(slug);
    if (orgs) {
      for (const org of orgs) {
        collidingOrgs.add(org);
      }
    }
  }

  const orgPrefixes = findShortestUniquePrefixes([...collidingOrgs]);

  // Compute unique prefixes for colliding project slugs to handle
  // cases like "api" and "app" both colliding across orgs
  const projectPrefixes = findShortestUniquePrefixes([...collidingSlugs]);

  for (const slug of collidingSlugs) {
    const orgs = projectToOrgs.get(slug);
    if (!orgs) {
      continue;
    }

    const projectPrefix =
      projectPrefixes.get(slug) ?? slug.charAt(0).toLowerCase();

    for (const org of orgs) {
      const orgPrefix = orgPrefixes.get(org) ?? org.charAt(0).toLowerCase();
      aliasMap.set(`${org}:${slug}`, `${orgPrefix}-${projectPrefix}`);
    }
  }
}

/**
 * Build aliases for org/project pairs, handling cross-org slug collisions.
 *
 * - Unique project slugs → shortest unique prefix of project slug
 * - Colliding slugs (same project in multiple orgs) → "{orgPrefix}-{projectPrefix}"
 *
 * Common word prefixes (like "spotlight-" in "spotlight-electron") are stripped
 * before computing project prefixes to keep aliases short.
 *
 * @param pairs - Array of org/project pairs to generate aliases for
 * @returns Map from "org:project" key to alias string, plus any stripped prefix
 *
 * @example
 * // No collision - same as existing behavior
 * buildOrgAwareAliases([
 *   { org: "acme", project: "frontend" },
 *   { org: "acme", project: "backend" }
 * ])
 * // { aliasMap: Map { "acme:frontend" => "f", "acme:backend" => "b" }, strippedPrefix: "" }
 *
 * @example
 * // Collision: same project slug in different orgs
 * buildOrgAwareAliases([
 *   { org: "org1", project: "dashboard" },
 *   { org: "org2", project: "dashboard" }
 * ])
 * // { aliasMap: Map { "org1:dashboard" => "o1-d", "org2:dashboard" => "o2-d" }, strippedPrefix: "" }
 */
export function buildOrgAwareAliases(
  pairs: OrgProjectPair[]
): OrgAwareAliasResult {
  const aliasMap = new Map<string, string>();

  if (pairs.length === 0) {
    return { aliasMap, strippedPrefix: "" };
  }

  const { projectToOrgs, collidingSlugs, uniqueSlugs } =
    groupByProjectSlug(pairs);

  const strippedPrefix = processUniqueSlugs(pairs, uniqueSlugs, aliasMap);

  if (collidingSlugs.size > 0) {
    processCollidingSlugs(projectToOrgs, collidingSlugs, aliasMap);
  }

  return { aliasMap, strippedPrefix };
}
