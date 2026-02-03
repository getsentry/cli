/**
 * Issue ID parsing and manipulation utilities
 *
 * Handles parsing of various issue ID formats:
 * - Numeric IDs: "123456"
 * - Full short IDs: "PROJECT-ABC", "SPOTLIGHT-ELECTRON-4Y"
 * - Short suffixes: "ABC", "4Y" (requires project context)
 * - Alias-suffix format: "e-4y", "w-2c" (requires alias cache)
 * - Org-prefixed format: "org/PROJECT-ABC", "org/project-suffix"
 */

/** Pattern to detect short IDs (contain letters, vs numeric IDs which are just digits) */
const SHORT_ID_PATTERN = /[a-zA-Z]/;

/** Pattern for short suffix validation (alphanumeric only, no hyphens) */
const SHORT_SUFFIX_PATTERN = /^[a-zA-Z0-9]+$/;

/** Pattern for alias-suffix format (e.g., "f-g", "fr-a3", "spotlight-e-4y") */
const ALIAS_SUFFIX_PATTERN = /^(.+)-([a-zA-Z0-9]+)$/i;

/** Pattern to detect numeric IDs (pure digits) */
const NUMERIC_ID_PATTERN = /^\d+$/;

/**
 * Check if a string looks like a short ID (e.g., PROJECT-ABC)
 * vs a numeric ID (e.g., 123456).
 *
 * Short IDs contain at least one letter. Numeric IDs are pure digits.
 */
export function isShortId(issueId: string): boolean {
  return SHORT_ID_PATTERN.test(issueId);
}

/**
 * Check if input looks like a short suffix (just the unique part without project prefix).
 * A short suffix has no hyphen and contains only alphanumeric characters.
 *
 * Examples: "G", "A3", "b2", "ABC", "12"
 */
export function isShortSuffix(input: string): boolean {
  return !input.includes("-") && SHORT_SUFFIX_PATTERN.test(input);
}

/**
 * Try to parse input as alias-suffix format (e.g., "f-g", "fr-a3").
 * Returns the parsed alias and suffix, or null if not matching the pattern.
 *
 * Note: This only checks the format, not whether the alias exists.
 * The caller should verify the alias exists in the cache.
 *
 * @param input - The input string to parse
 * @returns Parsed alias (lowercase) and suffix (uppercase), or null
 */
export function parseAliasSuffix(
  input: string
): { alias: string; suffix: string } | null {
  const match = ALIAS_SUFFIX_PATTERN.exec(input);
  if (!(match?.[1] && match[2])) {
    return null;
  }
  // Return lowercase alias (aliases are stored lowercase)
  return { alias: match[1].toLowerCase(), suffix: match[2].toUpperCase() };
}

/**
 * Expand a short suffix to a full short ID using the project slug.
 *
 * @param suffix - The short suffix (e.g., "G", "4Y")
 * @param projectSlug - The project slug (e.g., "craft", "spotlight-electron")
 * @returns Full short ID (e.g., "CRAFT-G", "SPOTLIGHT-ELECTRON-4Y")
 */
export function expandToFullShortId(
  suffix: string,
  projectSlug: string
): string {
  return `${projectSlug.toUpperCase()}-${suffix.toUpperCase()}`;
}

/**
 * Parsed issue argument types for CLI input.
 *
 * Supports:
 * - `org/issue-id`: Explicit org with any issue ID format
 * - `project-suffix`: Project slug + suffix (e.g., "cli-G", "spotlight-electron-4Y")
 * - `suffix`: Short suffix only (e.g., "G", "4Y")
 * - `numeric`: Numeric issue ID (e.g., "123456789")
 */
export type ParsedIssueArg =
  | { type: "explicit-org"; org: string; rest: string }
  | { type: "has-dash"; value: string }
  | { type: "suffix-only"; suffix: string }
  | { type: "numeric"; id: string };

/**
 * Parse a CLI issue argument into its component parts.
 *
 * Determines the format of the issue argument:
 * - `org/...` → explicit org prefix
 * - `123456789` → numeric ID
 * - `CLI-G` or `spotlight-electron-4Y` → has dash (could be short ID or project-suffix)
 * - `G` or `4Y` → suffix only
 *
 * @param arg - Raw CLI argument
 * @returns Parsed issue argument with type discrimination
 *
 * @example
 * parseIssueArg("sentry/EXTENSION-7")  // { type: "explicit-org", org: "sentry", rest: "EXTENSION-7" }
 * parseIssueArg("cli-G")               // { type: "has-dash", value: "cli-G" }
 * parseIssueArg("G")                   // { type: "suffix-only", suffix: "G" }
 * parseIssueArg("123456789")           // { type: "numeric", id: "123456789" }
 */
export function parseIssueArg(arg: string): ParsedIssueArg {
  const slashIndex = arg.indexOf("/");
  if (slashIndex > 0) {
    return {
      type: "explicit-org",
      org: arg.slice(0, slashIndex),
      rest: arg.slice(slashIndex + 1),
    };
  }

  if (NUMERIC_ID_PATTERN.test(arg)) {
    return { type: "numeric", id: arg };
  }

  if (arg.includes("-")) {
    return { type: "has-dash", value: arg };
  }

  return { type: "suffix-only", suffix: arg };
}

/**
 * Split a project-suffix format string into project and suffix parts.
 *
 * The suffix is the part after the last hyphen. The project is everything before.
 * Both parts are normalized: project to lowercase, suffix to uppercase.
 *
 * @param value - String in format "project-suffix" (e.g., "cli-G", "spotlight-electron-4Y")
 * @returns Object with project (lowercase) and suffix (uppercase)
 *
 * @example
 * splitProjectSuffix("cli-G")                 // { project: "cli", suffix: "G" }
 * splitProjectSuffix("spotlight-electron-4Y") // { project: "spotlight-electron", suffix: "4Y" }
 * splitProjectSuffix("CLI-G")                 // { project: "cli", suffix: "G" }
 */
export function splitProjectSuffix(value: string): {
  project: string;
  suffix: string;
} {
  const lastDash = value.lastIndexOf("-");
  return {
    project: value.slice(0, lastDash).toLowerCase(),
    suffix: value.slice(lastDash + 1).toUpperCase(),
  };
}
