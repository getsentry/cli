/**
 * Shared Argument Parsing Utilities
 *
 * Common parsing logic for CLI positional arguments that follow the
 * `<org>/<target>` pattern. Used by both listing commands (issue list,
 * project list) and single-item commands (issue view, explain, plan).
 */

import { isNumericId } from "./issue-id.js";

/** Default span depth when no value is provided */
const DEFAULT_SPAN_DEPTH = 3;

/**
 * Parse span depth flag value.
 *
 * Supports:
 * - Numeric values (e.g., "3", "5")
 * - "all" for unlimited depth (returns Infinity)
 * - "0" for unlimited depth (returns Infinity)
 * - Invalid values fall back to default depth (3)
 *
 * @param input - Raw input string from CLI flag
 * @returns Parsed depth as number (Infinity for unlimited)
 *
 * @example
 * parseSpanDepth("3")    // 3
 * parseSpanDepth("all")  // Infinity
 * parseSpanDepth("0")    // Infinity
 * parseSpanDepth("foo")  // 3 (default)
 */
export function parseSpanDepth(input: string): number {
  if (input.toLowerCase() === "all") {
    return Number.POSITIVE_INFINITY;
  }
  const n = Number(input);
  if (Number.isNaN(n)) {
    return DEFAULT_SPAN_DEPTH;
  }
  // 0 means unlimited
  return n === 0 ? Number.POSITIVE_INFINITY : n;
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
    brief: 'Span tree depth limit (number or "all" for unlimited)',
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
      if (!project) {
        throw new Error(
          'Invalid format: "/" requires a project slug (e.g., "/cli")'
        );
      }
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
/**
 * Parse the part after slash in "org/..." format.
 * Returns the appropriate ParsedIssueArg based on the content.
 */
function parseAfterSlash(
  arg: string,
  org: string,
  rest: string
): ParsedIssueArg {
  if (isNumericId(rest)) {
    // "my-org/123456789" → explicit org + numeric ID
    return { type: "explicit-org-numeric", org, numericId: rest };
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

export function parseIssueArg(arg: string): ParsedIssueArg {
  // 1. Pure numeric → direct fetch by ID
  if (isNumericId(arg)) {
    return { type: "numeric", id: arg };
  }

  // 2. Has slash → check slash FIRST (takes precedence over dashes)
  // This ensures "my-org/123" parses as org="my-org", not project="my"
  if (arg.includes("/")) {
    return parseWithSlash(arg);
  }

  // 3. Has dash but no slash → split on last "-" for project-suffix
  if (arg.includes("-")) {
    return parseWithDash(arg);
  }

  // 4. No dash, no slash → suffix only (needs DSN context)
  return { type: "suffix-only", suffix: arg.toUpperCase() };
}
