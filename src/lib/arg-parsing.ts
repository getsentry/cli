/**
 * Shared Argument Parsing Utilities
 *
 * Common parsing logic for CLI positional arguments that follow the
 * `<org>/<target>` pattern. Used by both listing commands (issue list,
 * project list) and single-item commands (issue view, explain, plan).
 */

import { ContextError, ValidationError } from "./errors.js";
import { validateResourceId } from "./input-validation.js";
import type { ParsedSentryUrl } from "./sentry-url-parser.js";
import { applySentryUrlContext, parseSentryUrl } from "./sentry-url-parser.js";
import { isAllDigits } from "./utils.js";

// ---------------------------------------------------------------------------
// Slug normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a Sentry slug by replacing underscores with dashes.
 *
 * Sentry enforces that organization and project slugs use dashes, never
 * underscores. Users frequently type underscores by mistake (e.g.,
 * `selfbase_admin_backend` instead of `selfbase-admin-backend`).
 *
 * @param slug - Raw slug string from CLI input
 * @returns Normalized slug and whether normalization was applied
 *
 * @example
 * normalizeSlug("selfbase_admin_backend")  // { slug: "selfbase-admin-backend", normalized: true }
 * normalizeSlug("my-project")              // { slug: "my-project", normalized: false }
 */
export function normalizeSlug(slug: string): {
  slug: string;
  normalized: boolean;
} {
  if (slug.includes("_")) {
    return { slug: slug.replace(/_/g, "-"), normalized: true };
  }
  return { slug, normalized: false };
}

// ---------------------------------------------------------------------------
// Issue short ID detection
// ---------------------------------------------------------------------------

/**
 * Pattern for issue short IDs: one or more segments of letters/digits
 * separated by dashes, where the last segment is the alphanumeric suffix.
 *
 * Examples that match: `CAM-82X`, `CLI-G`, `SPOTLIGHT-ELECTRON-4Y`
 * Examples that don't: `my-project` (suffix is all lowercase),
 * `a9b4ad2c` (no dash), `org/project` (has slash)
 *
 * The key distinguishing feature vs. a project slug: the suffix after the
 * last dash contains at least one uppercase letter or digit that looks like
 * a base-36 short ID, and the prefix is all-uppercase.
 */
const ISSUE_SHORT_ID_PATTERN = /^[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[A-Z0-9]+$/;

/**
 * Check if a string looks like a Sentry issue short ID.
 *
 * Used to detect when a user passes an issue short ID where a target
 * (org/project) is expected — e.g., `sentry event view CAM-82X 95fd7f5a`.
 *
 * @param str - String to check
 * @returns true if the string matches the issue short ID pattern
 *
 * @example
 * looksLikeIssueShortId("CAM-82X")              // true
 * looksLikeIssueShortId("CLI-G")                // true
 * looksLikeIssueShortId("SPOTLIGHT-ELECTRON-4Y") // true
 * looksLikeIssueShortId("my-project")            // false (lowercase)
 * looksLikeIssueShortId("a9b4ad2c")             // false (no dash)
 */
export function looksLikeIssueShortId(str: string): boolean {
  return ISSUE_SHORT_ID_PATTERN.test(str);
}

// ---------------------------------------------------------------------------
// Argument swap detection for view commands
// ---------------------------------------------------------------------------

/**
 * Detect when two positional args to a `* view` command appear to be in
 * the wrong order.
 *
 * View commands expect `<target> <id>` where:
 * - `target` is an `org/project` specifier (contains `/`) or a bare project slug
 * - `id` is a hex string (event ID, trace ID, log ID)
 *
 * Returns a warning message if args appear swapped, or `null` if order
 * looks correct.
 *
 * **Heuristic**: If `second` contains `/` but `first` does not, the user
 * likely passed `<id> <target>` instead of `<target> <id>`.
 *
 * @param first - First positional argument
 * @param second - Second positional argument
 * @returns Warning message string if swapped, `null` otherwise
 *
 * @example
 * detectSwappedViewArgs("a9b4ad2c", "mv-software/mvsoftware")
 * // → "Arguments appear reversed. Interpreting as: mv-software/mvsoftware a9b4ad2c"
 *
 * detectSwappedViewArgs("mv-software/mvsoftware", "a9b4ad2c")
 * // → null (correct order)
 */
export function detectSwappedViewArgs(
  first: string,
  second: string
): string | null {
  if (second.includes("/") && !first.includes("/")) {
    return `Arguments appear reversed. Interpreting as: ${second} ${first}`;
  }
  return null;
}

/**
 * Detect when `trial start` args are swapped: `sentry trial start my-org seer`
 * instead of `sentry trial start seer my-org`.
 *
 * Since trial names are a known finite set, we can unambiguously determine
 * which arg is the trial name and which is the org slug by checking against
 * the valid trial names list.
 *
 * @param first - First positional argument
 * @param second - Second positional argument
 * @param isKnownName - Predicate to check if a string is a valid trial name
 * @returns Object with resolved `name` and `org` if swapped, or `null` if order is correct
 *
 * @example
 * detectSwappedTrialArgs("my-org", "seer", isTrialName)
 * // → { name: "seer", org: "my-org", warning: "Arguments appear reversed..." }
 *
 * detectSwappedTrialArgs("seer", "my-org", isTrialName)
 * // → null (correct order)
 */
export function detectSwappedTrialArgs(
  first: string,
  second: string,
  isKnownName: (value: string) => boolean
): { name: string; org: string; warning: string } | null {
  // If first is already a known name, order is correct
  if (isKnownName(first)) {
    return null;
  }

  // If second is a known name but first isn't, they're swapped
  if (isKnownName(second)) {
    return {
      name: second,
      org: first,
      warning: `Arguments appear reversed. Interpreting as: ${second} ${first}`,
    };
  }

  return null;
}

/**
 * Validate that a CLI --limit flag value is within an allowed range.
 *
 * Used by commands that need API-side limiting (trace list, log list) where
 * the value is passed directly to the API as `per_page`.
 *
 * @param value - Raw string input from CLI flag
 * @param min - Minimum allowed value (inclusive)
 * @param max - Maximum allowed value (inclusive)
 * @returns Parsed integer
 * @throws {Error} If value is NaN or outside [min, max]
 *
 * @example
 * validateLimit("50", 1, 1000)  // 50
 * validateLimit("0", 1, 1000)   // throws
 * validateLimit("abc", 1, 1000) // throws
 */
export function validateLimit(value: string, min = 1, max = 1000): number {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num < min || num > max) {
    throw new Error(`--limit must be between ${min} and ${max}`);
  }
  return num;
}

/** Default span depth when no value is provided */
const DEFAULT_SPAN_DEPTH = 3;

/**
 * Parse span depth flag value.
 *
 * Supports:
 * - Numeric values (e.g., "3", "5") - depth limit
 * - "all" for unlimited depth (returns Infinity)
 * - "no" or "0" to disable span tree (returns 0)
 * - Invalid values fall back to default depth (3)
 *
 * @param input - Raw input string from CLI flag
 * @returns Parsed depth as number (0 = disabled, Infinity = unlimited)
 *
 * @example
 * parseSpanDepth("3")    // 3
 * parseSpanDepth("all")  // Infinity
 * parseSpanDepth("no")   // 0
 * parseSpanDepth("0")    // 0
 * parseSpanDepth("foo")  // 3 (default)
 */
export function parseSpanDepth(input: string): number {
  const lower = input.toLowerCase();
  if (lower === "all") {
    return Number.POSITIVE_INFINITY;
  }
  if (lower === "no") {
    return 0;
  }
  const n = Number(input);
  if (Number.isNaN(n)) {
    return DEFAULT_SPAN_DEPTH;
  }
  return n;
}

/**
 * Shared --spans flag definition for Stricli commands.
 * Use this in command parameters to avoid duplication.
 *
 * @example
 * parameters: {
 *   flags: {
 *     ...spansFlag,
 *     // other flags
 *   }
 * }
 */
export const spansFlag = {
  spans: {
    kind: "parsed" as const,
    parse: parseSpanDepth,
    brief:
      'Span tree depth limit (number, "all" for unlimited, "no" to disable)',
    default: String(DEFAULT_SPAN_DEPTH),
  },
};

/**
 * Type constants for project specification patterns.
 * Use these constants instead of string literals for type safety.
 */
export const ProjectSpecificationType = {
  /** Explicit org/project provided (e.g., "sentry/cli") */
  Explicit: "explicit",
  /** Org with trailing slash for all projects (e.g., "sentry/") */
  OrgAll: "org-all",
  /** Project slug only, search across all orgs (e.g., "cli") */
  ProjectSearch: "project-search",
  /** No input, auto-detect from DSN/config */
  AutoDetect: "auto-detect",
} as const;

/**
 * Parsed result from an org/project positional argument.
 * Discriminated union based on the `type` field.
 *
 * When `normalized` is true, the slug contained underscores that were
 * auto-corrected to dashes. Callers should emit a warning via `log.warn()`.
 */
export type ParsedOrgProject =
  | {
      type: typeof ProjectSpecificationType.Explicit;
      org: string;
      project: string;
      /** True if any slug was normalized (underscores → dashes) */
      normalized?: boolean;
    }
  | {
      type: typeof ProjectSpecificationType.OrgAll;
      org: string;
      /** True if org slug was normalized (underscores → dashes) */
      normalized?: boolean;
    }
  | {
      type: typeof ProjectSpecificationType.ProjectSearch;
      projectSlug: string;
      /** True if project slug was normalized (underscores → dashes) */
      normalized?: boolean;
    }
  | { type: typeof ProjectSpecificationType.AutoDetect };

/**
 * Map a parsed Sentry URL to a ParsedOrgProject.
 * If the URL contains a project slug, returns explicit; otherwise org-all.
 */
function orgProjectFromUrl(parsed: ParsedSentryUrl): ParsedOrgProject {
  if (parsed.project) {
    return { type: "explicit", org: parsed.org, project: parsed.project };
  }
  return { type: "org-all", org: parsed.org };
}

/**
 * Map a parsed Sentry URL to a ParsedIssueArg.
 * Handles numeric group IDs and short IDs (e.g., "CLI-G") from the URL path.
 */
function issueArgFromUrl(parsed: ParsedSentryUrl): ParsedIssueArg | null {
  const { issueId } = parsed;
  if (!issueId) {
    return null;
  }

  // Numeric group ID (e.g., /issues/32886/)
  if (isAllDigits(issueId)) {
    return {
      type: "explicit-org-numeric",
      org: parsed.org,
      numericId: issueId,
    };
  }

  // Short ID with dash (e.g., /issues/CLI-G/ or /issues/SPOTLIGHT-ELECTRON-4Y/)
  const dashIdx = issueId.lastIndexOf("-");
  if (dashIdx > 0) {
    const project = issueId.slice(0, dashIdx);
    const suffix = issueId.slice(dashIdx + 1).toUpperCase();
    if (project && suffix) {
      return { type: "explicit", org: parsed.org, project, suffix };
    }
  }

  // No dash — treat as suffix-only with org context
  return {
    type: "explicit-org-suffix",
    org: parsed.org,
    suffix: issueId.toUpperCase(),
  };
}

/**
 * Parse a slash-delimited `org/project` string into a {@link ParsedOrgProject}.
 * Applies {@link normalizeSlug} to both components and validates against
 * URL injection characters.
 */
function parseSlashOrgProject(input: string): ParsedOrgProject {
  const slashIndex = input.indexOf("/");
  const rawOrg = input.slice(0, slashIndex);
  const rawProject = input.slice(slashIndex + 1);

  if (!rawOrg) {
    // "/cli" → search for project across all orgs
    if (!rawProject) {
      throw new Error(
        'Invalid format: "/" requires a project slug (e.g., "/cli")'
      );
    }
    validateResourceId(rawProject, "project slug");
    const np = normalizeSlug(rawProject);
    return {
      type: "project-search",
      projectSlug: np.slug,
      ...(np.normalized && { normalized: true }),
    };
  }

  validateResourceId(rawOrg, "organization slug");
  const no = normalizeSlug(rawOrg);

  if (!rawProject) {
    // "sentry/" → list all projects in org
    return {
      type: "org-all",
      org: no.slug,
      ...(no.normalized && { normalized: true }),
    };
  }

  // "sentry/cli" → explicit org and project
  validateResourceId(rawProject, "project slug");
  const np = normalizeSlug(rawProject);
  const normalized = no.normalized || np.normalized;
  return {
    type: "explicit",
    org: no.slug,
    project: np.slug,
    ...(normalized && { normalized: true }),
  };
}

/**
 * Parse an org/project positional argument string.
 *
 * Supports the following patterns:
 * - `undefined` or empty → auto-detect from DSN/config
 * - `https://sentry.io/organizations/org/...` → extract from Sentry URL
 * - `sentry/cli` → explicit org and project
 * - `sentry/` → org with all projects
 * - `/cli` → search for project across all orgs (leading slash)
 * - `cli` → search for project across all orgs
 *
 * @param arg - Input string from CLI positional argument
 * @returns Parsed result with type discrimination
 *
 * @example
 * parseOrgProjectArg(undefined)     // { type: "auto-detect" }
 * parseOrgProjectArg("sentry/cli")  // { type: "explicit", org: "sentry", project: "cli" }
 * parseOrgProjectArg("sentry/")     // { type: "org-all", org: "sentry" }
 * parseOrgProjectArg("/cli")        // { type: "project-search", projectSlug: "cli" }
 * parseOrgProjectArg("cli")         // { type: "project-search", projectSlug: "cli" }
 */
export function parseOrgProjectArg(arg: string | undefined): ParsedOrgProject {
  if (!arg || arg.trim() === "") {
    return { type: "auto-detect" };
  }

  const trimmed = arg.trim();

  // URL detection — extract org/project from Sentry web URLs
  const urlParsed = parseSentryUrl(trimmed);
  if (urlParsed) {
    applySentryUrlContext(urlParsed.baseUrl);
    return orgProjectFromUrl(urlParsed);
  }

  if (trimmed.includes("/")) {
    return parseSlashOrgProject(trimmed);
  }

  // No slash → search for project across all orgs
  validateResourceId(trimmed, "project slug");
  const np = normalizeSlug(trimmed);
  return {
    type: "project-search",
    projectSlug: np.slug,
    ...(np.normalized && { normalized: true }),
  };
}

/**
 * Parsed issue argument types - flattened for ergonomics.
 *
 * Supports:
 * - `numeric`: Pure numeric ID (e.g., "123456789")
 * - `explicit`: Org + project + suffix (e.g., "sentry/cli-G")
 * - `explicit-org-suffix`: Org + suffix only (e.g., "sentry/G")
 * - `explicit-org-numeric`: Org + numeric ID (e.g., "sentry/123456789")
 * - `project-search`: Project slug + suffix (e.g., "cli-G")
 * - `suffix-only`: Just suffix (e.g., "G")
 */
/**
 * Magic `@` selectors that resolve to issues dynamically.
 *
 * `@latest` resolves to the issue with the most recent event (`lastSeen`).
 * `@most_frequent` resolves to the issue with the highest event frequency.
 *
 * Can be combined with an explicit org: `sentry/@latest`.
 */
export type IssueSelector = "@latest" | "@most_frequent";

/**
 * Set of recognized magic selectors (lowercase for case-insensitive matching).
 * Maps normalized selector names to their canonical form.
 */
const SELECTOR_MAP = new Map<string, IssueSelector>([
  ["@latest", "@latest"],
  ["@most_frequent", "@most_frequent"],
  ["@mostfrequent", "@most_frequent"],
  ["@most-frequent", "@most_frequent"],
]);

/**
 * Check if a string is a recognized magic selector.
 * Case-insensitive and accepts common variations (e.g., `@mostFrequent`).
 *
 * @param value - String to check (without org/ prefix)
 * @returns The canonical selector or undefined if not a selector
 */
export function parseSelector(value: string): IssueSelector | undefined {
  return SELECTOR_MAP.get(value.toLowerCase());
}

export type ParsedIssueArg =
  | { type: "numeric"; id: string }
  | { type: "explicit"; org: string; project: string; suffix: string }
  | { type: "explicit-org-suffix"; org: string; suffix: string }
  | { type: "explicit-org-numeric"; org: string; numericId: string }
  | { type: "project-search"; projectSlug: string; suffix: string }
  | { type: "suffix-only"; suffix: string }
  | { type: "selector"; selector: IssueSelector; org?: string };

/**
 * Parse a CLI issue argument into its component parts.
 *
 * Uses `parseOrgProjectArg` internally for the left part of dash-separated
 * inputs, providing consistent org/project parsing across commands.
 *
 * Flow:
 * 1. Pure numeric → { type: "numeric" }
 * 2. Has dash → split on last "-", parse left with parseOrgProjectArg
 *    - "explicit" → { type: "explicit", org, project, suffix }
 *    - "project-search" → { type: "project-search", projectSlug, suffix }
 *    - "org-all" or "auto-detect" → rejected as invalid
 * 3. Has slash but no dash → explicit org + suffix/numeric
 * 4. Otherwise → suffix-only
 *
 * @param arg - Raw CLI argument
 * @returns Parsed issue argument with type discrimination
 * @throws {Error} If input has invalid format (e.g., "sentry/-G")
 *
 * @example
 * parseIssueArg("123456789")          // { type: "numeric", id: "123456789" }
 * parseIssueArg("sentry/cli-G")       // { type: "explicit", org: "sentry", project: "cli", suffix: "G" }
 * parseIssueArg("cli-G")              // { type: "project-search", projectSlug: "cli", suffix: "G" }
 * parseIssueArg("sentry/G")           // { type: "explicit-org-suffix", org: "sentry", suffix: "G" }
 * parseIssueArg("G")                  // { type: "suffix-only", suffix: "G" }
 */
/**
 * Handle multi-slash issue args like "org/project/suffix" or "org/project/123".
 *
 * Splits `rest` on its first `/` to extract the project slug and a remainder
 * that is treated as the issue reference (suffix, numeric ID, or short ID).
 */
function parseMultiSlashIssueArg(
  arg: string,
  org: string,
  rest: string
): ParsedIssueArg {
  const slashIdx = rest.indexOf("/");
  const project = rest.slice(0, slashIdx);
  const remainder = rest.slice(slashIdx + 1);

  if (!(project && remainder)) {
    throw new Error(
      `Invalid issue format: "${arg}". Missing project or issue ID segment.`
    );
  }

  // Remainder with dash: "org/project/PROJ-G" — split remainder on last dash
  if (remainder.includes("-")) {
    const lastDash = remainder.lastIndexOf("-");
    const subProject = remainder.slice(0, lastDash);
    const suffix = remainder.slice(lastDash + 1).toUpperCase();
    if (subProject && suffix) {
      return {
        type: "explicit",
        org,
        project,
        suffix: `${subProject}-${suffix}`.toUpperCase(),
      };
    }
  }

  // "org/project/101149101" or "org/project/G" — treat remainder as suffix
  return { type: "explicit", org, project, suffix: remainder.toUpperCase() };
}

function parseAfterSlash(
  arg: string,
  org: string,
  rest: string
): ParsedIssueArg {
  if (isAllDigits(rest)) {
    // "my-org/123456789" → explicit org + numeric ID
    return { type: "explicit-org-numeric", org, numericId: rest };
  }

  // Multi-slash: "org/project/suffix" or "org/project/123"
  if (rest.includes("/")) {
    return parseMultiSlashIssueArg(arg, org, rest);
  }

  // Check if rest contains a dash (project-suffix pattern)
  if (rest.includes("-")) {
    const lastDash = rest.lastIndexOf("-");
    const project = rest.slice(0, lastDash);
    const suffix = rest.slice(lastDash + 1).toUpperCase();

    if (!project) {
      throw new Error(
        `Invalid issue format: "${arg}". Cannot use trailing slash before suffix.`
      );
    }

    if (!suffix) {
      throw new Error(
        `Invalid issue format: "${arg}". Missing suffix after dash.`
      );
    }

    // "my-org/cli-G" or "sentry/spotlight-electron-4Y"
    return { type: "explicit", org, project, suffix };
  }

  // "my-org/G" → explicit org + suffix only (no dash in rest)
  return { type: "explicit-org-suffix", org, suffix: rest.toUpperCase() };
}

/**
 * Parse issue arg with slash (org/...).
 */
function parseWithSlash(arg: string): ParsedIssueArg {
  const slashIdx = arg.indexOf("/");
  const org = arg.slice(0, slashIdx);
  const rest = arg.slice(slashIdx + 1);

  if (!rest) {
    throw new Error(
      `Invalid issue format: "${arg}". Missing issue ID after slash.`
    );
  }

  if (!org) {
    // Leading slash with dash → project-search (e.g., "/cli-G")
    if (rest.includes("-")) {
      return parseWithDash(rest);
    }
    // "/G" → treat as suffix-only (unusual but valid)
    return { type: "suffix-only", suffix: rest.toUpperCase() };
  }

  return parseAfterSlash(arg, org, rest);
}

/**
 * Parse issue arg with dash but no slash (project-suffix).
 */
function parseWithDash(arg: string): ParsedIssueArg {
  const lastDash = arg.lastIndexOf("-");
  const projectSlug = arg.slice(0, lastDash);
  const suffix = arg.slice(lastDash + 1).toUpperCase();

  if (!projectSlug) {
    throw new Error(
      `Invalid issue format: "${arg}". Missing project before suffix.`
    );
  }

  if (!suffix) {
    throw new Error(
      `Invalid issue format: "${arg}". Missing suffix after dash.`
    );
  }

  // "cli-G" or "spotlight-electron-4Y"
  return { type: "project-search", projectSlug, suffix };
}

/**
 * Parse a single positional arg that may be a plain hex ID or a slash-separated
 * `org/project/id` pattern.
 *
 * Used by commands whose IDs are hex strings that never contain `/`
 * (event, trace, log), making the pattern unambiguous:
 * - No slashes → plain ID, no target
 * - Exactly one slash → `org/project` without ID → throws {@link ContextError}
 * - Two or more slashes → splits on last `/` → `targetArg` + `id`
 *
 * @param arg - The raw single positional argument
 * @param idLabel - Human-readable ID label for error messages (e.g. `"Event ID"`)
 * @param usageHint - Usage example shown in error messages
 * @returns Parsed `{ id, targetArg }` — `targetArg` is `undefined` for plain IDs
 * @throws {ContextError} When the arg contains exactly one slash (missing ID)
 *   or ends with a trailing slash (empty ID segment)
 */
export function parseSlashSeparatedArg(
  arg: string,
  idLabel: string,
  usageHint: string
): { id: string; targetArg: string | undefined } {
  const slashIdx = arg.indexOf("/");

  if (slashIdx === -1) {
    // No slashes — plain ID. Skip validation here because callers may
    // do further processing (e.g., splitting newline-separated IDs).
    // Downstream validators like validateHexId or validateTraceId provide
    // format-specific validation.
    return { id: arg, targetArg: undefined };
  }

  // IDs are hex and never contain "/" — this must be a structured
  // "org/project/id" or "org/project" (missing ID)
  const lastSlashIdx = arg.lastIndexOf("/");

  if (slashIdx === lastSlashIdx) {
    // Exactly one slash: "org/project" without ID
    throw new ContextError(idLabel, usageHint);
  }

  // Two+ slashes: split on last "/" → target + id
  const targetArg = arg.slice(0, lastSlashIdx);
  const id = arg.slice(lastSlashIdx + 1);

  if (!id) {
    throw new ContextError(idLabel, usageHint);
  }

  // Validate the extracted ID against injection characters.
  // The targetArg flows through parseOrgProjectArg which has its own validation.
  validateResourceId(id, idLabel);

  return { id, targetArg };
}

export function parseIssueArg(arg: string): ParsedIssueArg {
  // 0. URL detection — extract issue ID from Sentry web URLs
  const urlParsed = parseSentryUrl(arg);
  if (urlParsed) {
    applySentryUrlContext(urlParsed.baseUrl);
    const result = issueArgFromUrl(urlParsed);
    if (result) {
      return result;
    }
    // URL recognized but no issue ID (e.g., trace or project settings URL)
    throw new ValidationError(
      "This Sentry URL does not contain an issue ID. Use an issue URL like:\n" +
        "  https://sentry.io/organizations/{org}/issues/{id}/"
    );
  }

  // 1. Magic @ selectors — detect before any other parsing.
  // Supports bare `@latest` and org-prefixed `sentry/@latest`.
  if (arg.includes("@")) {
    const slashIdx = arg.indexOf("/");
    const selectorPart = slashIdx === -1 ? arg : arg.slice(slashIdx + 1);
    const selector = parseSelector(selectorPart);
    if (selector) {
      if (slashIdx !== -1) {
        const org = normalizeSlug(arg.slice(0, slashIdx)).slug;
        validateResourceId(org, "organization slug");
        return { type: "selector", selector, org };
      }
      return { type: "selector", selector };
    }
    // Not a recognized selector — fall through to normal parsing.
    // The @ character will be caught by validateResourceId below.
  }

  // Validate raw input against injection characters before parsing.
  // Slashes are allowed (they're structural separators), but ?, #, %, whitespace,
  // and control characters are never valid in issue identifiers.
  validateResourceId(arg.replace(/\//g, ""), "issue identifier");

  // 2. Pure numeric → direct fetch by ID
  if (isAllDigits(arg)) {
    return { type: "numeric", id: arg };
  }

  // 3. Has slash → check slash FIRST (takes precedence over dashes)
  // This ensures "my-org/123" parses as org="my-org", not project="my"
  if (arg.includes("/")) {
    return parseWithSlash(arg);
  }

  // 4. Has dash but no slash → split on last "-" for project-suffix
  if (arg.includes("-")) {
    return parseWithDash(arg);
  }

  // 5. No dash, no slash → suffix only (needs DSN context)
  return { type: "suffix-only", suffix: arg.toUpperCase() };
}
