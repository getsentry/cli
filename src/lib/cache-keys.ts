/**
 * Compute cache-invalidation prefixes for a mutation URL.
 *
 * The HTTP layer calls {@link computeInvalidationPrefixes} after every
 * successful non-GET request and feeds the result into
 * `invalidateCachedResponsesMatching`. Two rules apply:
 *
 * 1. **Hierarchy walk.** Sweep the URL's own path and every ancestor
 *    up to `/api/0/`. A mutation on
 *    `/organizations/{org}/releases/1.0.0/deploys/` sweeps itself,
 *    `.../releases/1.0.0/`, and `.../releases/` — which catches the
 *    detail, deploys-list, and releases-list GET caches in one pass.
 *
 * 2. **Cross-endpoint rules.** A small hardcoded table for mutations
 *    whose effects cross URL trees. For example, creating a project
 *    under a team hits `/organizations/{org}/teams/{team}/projects/`
 *    but invalidates the org project list at
 *    `/organizations/{org}/projects/`. The table is tiny today
 *    (2 rules) and only grows when a new cross-tree relationship
 *    appears in the API surface.
 *
 * Prefixes are identity-scoped at the sweep layer
 * (`invalidateCachedResponsesMatching` checks `entry.identity`), so a
 * slightly broader sweep is safe — it can only touch the current
 * identity's entries. Query strings on the mutation URL are dropped
 * from the prefix (a prefix sweep on the path naturally catches every
 * query-param variant cached under that path).
 */

/** Regex capturing the `/api/0/` boundary. Anchored so it matches only the canonical API prefix. */
const API_V0_SEGMENT = "/api/0/";

/**
 * Cross-endpoint invalidation rules.
 *
 * Each rule is a pattern the mutation URL path must match, plus a
 * function that returns additional prefixes to sweep. Patterns match
 * against the *path*, not the full URL — so the prefix returned is
 * prepended with the request's base later.
 *
 * Keep this table small. The hierarchy walk handles most cases; add a
 * rule here only when the API's cross-tree relationships force it.
 */
type CrossEndpointRule = {
  /** Matches the path relative to `/api/0/` (no leading slash). */
  match: RegExp;
  /** Returns additional path prefixes (relative to `/api/0/`) to sweep. */
  extra: (matchGroups: RegExpMatchArray) => string[];
};

const CROSS_ENDPOINT_RULES: CrossEndpointRule[] = [
  {
    // POST /api/0/teams/{org}/{team}/projects/ (create a project in a team)
    // invalidates the org project list at
    // /api/0/organizations/{org}/projects/ which lives under a
    // different URL tree.
    match: /^teams\/([^/]+)\/[^/]+\/projects\/?$/,
    extra: ([, org]) => [`organizations/${org}/projects/`],
  },
  {
    // DELETE /api/0/projects/{org}/{project}/ (delete a project)
    // invalidates the org project list at
    // /api/0/organizations/{org}/projects/ (different URL tree).
    match: /^projects\/([^/]+)\/[^/]+\/?$/,
    extra: ([, org]) => [`organizations/${org}/projects/`],
  },
];

/**
 * Compute the full set of cache-invalidation prefixes for a mutation
 * URL.
 *
 * @param fullUrl - Fully-qualified URL of the mutation (absolute,
 *   including base). Query string is ignored.
 * @returns Array of full-URL prefixes (including base and
 *   `/api/0/`) ready to pass to
 *   `invalidateCachedResponsesMatching`. Returns `[]` if the URL is
 *   not under `/api/0/` (e.g. sourcemap chunk upload to an arbitrary
 *   endpoint) or can't be parsed.
 */
export function computeInvalidationPrefixes(fullUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(fullUrl);
  } catch {
    return [];
  }

  const apiIdx = parsed.pathname.indexOf(API_V0_SEGMENT);
  if (apiIdx === -1) {
    return [];
  }

  // `base` includes origin + path up through and including `/api/0/`.
  const base = `${parsed.origin}${parsed.pathname.slice(0, apiIdx + API_V0_SEGMENT.length)}`;
  // Path below `/api/0/`, leading slash trimmed, trailing slash kept
  // so it matches against rules that anchor on `/?$`.
  const relPath = parsed.pathname.slice(apiIdx + API_V0_SEGMENT.length);

  // No relative path means the mutation hit `/api/0/` itself; nothing to sweep.
  if (relPath === "") {
    return [];
  }

  const prefixes = new Set<string>();

  // Rule 1: hierarchy walk. Sweep the URL's own path plus every
  // ancestor with at least one segment.
  for (const segments of ancestorSegments(relPath)) {
    prefixes.add(`${base}${segments}`);
  }

  // Rule 2: cross-endpoint table.
  for (const rule of CROSS_ENDPOINT_RULES) {
    const match = relPath.match(rule.match);
    if (match) {
      for (const extra of rule.extra(match)) {
        prefixes.add(`${base}${extra}`);
      }
    }
  }

  return [...prefixes];
}

/**
 * Yield every path-prefix sequence of `relPath` in descending length,
 * always ending with a trailing slash.
 *
 * `"organizations/acme/releases/1.0.0/deploys/"` yields:
 * - `"organizations/acme/releases/1.0.0/deploys/"`
 * - `"organizations/acme/releases/1.0.0/"`
 * - `"organizations/acme/releases/"`
 * - `"organizations/acme/"`
 * - `"organizations/"`
 */
function* ancestorSegments(relPath: string): Generator<string> {
  const trimmed = relPath.endsWith("/") ? relPath.slice(0, -1) : relPath;
  if (trimmed === "") {
    return;
  }
  const parts = trimmed.split("/");
  for (let i = parts.length; i > 0; i--) {
    yield `${parts.slice(0, i).join("/")}/`;
  }
}
