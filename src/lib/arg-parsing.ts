/**
 * Shared Argument Parsing Utilities
 *
 * Common parsing logic for CLI positional arguments that follow the
 * `<org>/<target>` pattern. Used by both listing commands (issue list,
 * project list) and single-item commands (issue view, explain, plan).
 */

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
 */
export type ParsedOrgProject =
  | {
      type: typeof ProjectSpecificationType.Explicit;
      org: string;
      project: string;
    }
  | { type: typeof ProjectSpecificationType.OrgAll; org: string }
  | { type: typeof ProjectSpecificationType.ProjectSearch; projectSlug: string }
  | { type: typeof ProjectSpecificationType.AutoDetect };

/**
 * Parse an org/project positional argument string.
 *
 * Supports the following patterns:
 * - `undefined` or empty → auto-detect from DSN/config
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

  if (trimmed.includes("/")) {
    const slashIndex = trimmed.indexOf("/");
    const org = trimmed.slice(0, slashIndex);
    const project = trimmed.slice(slashIndex + 1);

    if (!org) {
      // "/cli" → search for project across all orgs
      return { type: "project-search", projectSlug: project };
    }

    if (!project) {
      // "sentry/" → list all projects in org
      return { type: "org-all", org };
    }

    // "sentry/cli" → explicit org and project
    return { type: "explicit", org, project };
  }

  // No slash → search for project across all orgs
  return { type: "project-search", projectSlug: trimmed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue Argument Parsing
// ─────────────────────────────────────────────────────────────────────────────

/** Pattern to detect numeric IDs (pure digits) */
const NUMERIC_ID_PATTERN = /^\d+$/;

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
export type ParsedIssueArg =
  | { type: "numeric"; id: string }
  | { type: "explicit"; org: string; project: string; suffix: string }
  | { type: "explicit-org-suffix"; org: string; suffix: string }
  | { type: "explicit-org-numeric"; org: string; numericId: string }
  | { type: "project-search"; projectSlug: string; suffix: string }
  | { type: "suffix-only"; suffix: string };

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
export function parseIssueArg(arg: string): ParsedIssueArg {
  // 1. Pure numeric → direct fetch by ID
  if (NUMERIC_ID_PATTERN.test(arg)) {
    return { type: "numeric", id: arg };
  }

  // 2. Has dash → split on last "-", parse left with org/project logic
  if (arg.includes("-")) {
    const lastDash = arg.lastIndexOf("-");
    const leftPart = arg.slice(0, lastDash);
    const suffix = arg.slice(lastDash + 1).toUpperCase();

    const target = parseOrgProjectArg(leftPart);

    switch (target.type) {
      case "explicit":
        // "sentry/cli-G" → org + project + suffix
        return {
          type: "explicit",
          org: target.org,
          project: target.project,
          suffix,
        };

      case "project-search":
        // "cli-G" → search for project, then use suffix
        return {
          type: "project-search",
          projectSlug: target.projectSlug,
          suffix,
        };

      case "org-all":
        // "sentry/-G" is invalid - can't have org-all with issue suffix
        throw new Error(
          `Invalid issue format: "${arg}". Cannot use trailing slash before suffix.`
        );

      case "auto-detect":
        // "-G" is invalid - empty left part
        throw new Error(
          `Invalid issue format: "${arg}". Missing project before suffix.`
        );

      default: {
        // Exhaustive check
        const _exhaustive: never = target;
        throw new Error(
          `Unexpected target type: ${JSON.stringify(_exhaustive)}`
        );
      }
    }
  }

  // 3. Has slash but no dash (e.g., "sentry/G" or "sentry/123456789")
  if (arg.includes("/")) {
    const slashIdx = arg.indexOf("/");
    const org = arg.slice(0, slashIdx);
    const rest = arg.slice(slashIdx + 1);

    if (!org) {
      // "/G" → treat as suffix-only (unusual but valid)
      return { type: "suffix-only", suffix: rest.toUpperCase() };
    }

    if (NUMERIC_ID_PATTERN.test(rest)) {
      // "sentry/123456789" → explicit org + numeric ID
      return { type: "explicit-org-numeric", org, numericId: rest };
    }

    // "sentry/G" → explicit org + suffix only
    return { type: "explicit-org-suffix", org, suffix: rest.toUpperCase() };
  }

  // 4. No dash, no slash → suffix only (needs DSN context)
  return { type: "suffix-only", suffix: arg.toUpperCase() };
}
