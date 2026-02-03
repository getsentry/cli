/**
 * Shared utilities for issue commands
 *
 * Common functionality used by explain, plan, view, and other issue commands.
 */

import {
  findProjectsBySlug,
  getAutofixState,
  getIssue,
  getIssueByShortId,
} from "../../lib/api-client.js";
import { getProjectByAlias } from "../../lib/db/project-aliases.js";
import { createDsnFingerprint, detectAllDsns } from "../../lib/dsn/index.js";
import { CliError, ContextError } from "../../lib/errors.js";
import { getProgressMessage } from "../../lib/formatters/seer.js";
import {
  expandToFullShortId,
  isShortSuffix,
  parseIssueArg,
  splitProjectSuffix,
} from "../../lib/issue-id.js";
import { poll } from "../../lib/polling.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import type { SentryIssue, Writer } from "../../types/index.js";
import { type AutofixState, isTerminalStatus } from "../../types/seer.js";

/** Pattern to detect numeric IDs */
const NUMERIC_PATTERN = /^\d+$/;

/** Shared positional parameter for issue ID */
export const issueIdPositional = {
  kind: "tuple",
  parameters: [
    {
      placeholder: "issue",
      brief:
        "Issue: <org>/ID, <project>-suffix, ID, or suffix (e.g., sentry/CLI-G, cli-G, CLI-G, G)",
      parse: String,
    },
  ],
} as const;

/**
 * Build a command hint string for error messages.
 *
 * Returns context-aware hints based on the issue ID format:
 * - Suffix only (e.g., "G") → suggest `<project>-G`
 * - Has dash (e.g., "cli-G") → suggest `<org>/cli-G`
 *
 * @param command - The issue subcommand (e.g., "view", "explain")
 * @param issueId - The user-provided issue ID
 */
export function buildCommandHint(command: string, issueId: string): string {
  if (isShortSuffix(issueId)) {
    return `sentry issue ${command} <project>-${issueId}`;
  }
  return `sentry issue ${command} <org>/${issueId}`;
}

/** Default timeout in milliseconds (3 minutes) */
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Result of resolving an issue ID - includes full issue object.
 * Used by view command which needs the complete issue data.
 */
export type ResolvedIssueResult = {
  /** Resolved organization slug (may be undefined for numeric IDs without context) */
  org: string | undefined;
  /** Full issue object from API */
  issue: SentryIssue;
};

/** Internal type for strict resolution (org required) */
type StrictResolvedIssue = {
  /** Resolved organization slug */
  org: string;
  /** Full issue object from API */
  issue: SentryIssue;
};

/**
 * Try to resolve via alias cache.
 * Returns null if the alias is not found in cache or fingerprint doesn't match.
 *
 * @param alias - The project alias (lowercase)
 * @param suffix - The issue suffix (uppercase)
 * @param cwd - Current working directory for DSN detection
 */
async function tryResolveFromAlias(
  alias: string,
  suffix: string,
  cwd: string
): Promise<StrictResolvedIssue | null> {
  const detection = await detectAllDsns(cwd);
  const fingerprint = createDsnFingerprint(detection.all);
  const projectEntry = await getProjectByAlias(alias, fingerprint);
  if (!projectEntry) {
    return null;
  }

  const resolvedShortId = expandToFullShortId(suffix, projectEntry.projectSlug);
  const issue = await getIssueByShortId(projectEntry.orgSlug, resolvedShortId);
  return { org: projectEntry.orgSlug, issue };
}

/**
 * Search for a project by slug across all orgs, then fetch the issue.
 *
 * @param projectSlug - Project slug to search for (lowercase)
 * @param suffix - Issue suffix to expand (uppercase)
 * @param commandHint - Hint for error messages
 */
async function resolveByProjectSearch(
  projectSlug: string,
  suffix: string,
  commandHint: string
): Promise<StrictResolvedIssue> {
  const projects = await findProjectsBySlug(projectSlug);

  if (projects.length === 0) {
    throw new ContextError(`Project '${projectSlug}' not found`, commandHint, [
      "No project with this slug found in any accessible organization",
    ]);
  }

  if (projects.length > 1) {
    const orgList = projects.map((p) => p.orgSlug).join(", ");
    throw new ContextError(
      `Project '${projectSlug}' found in multiple organizations`,
      commandHint,
      [
        `Found in: ${orgList}`,
        `Specify the org: sentry issue ... <org>/${projectSlug}-${suffix}`,
      ]
    );
  }

  const project = projects[0];
  if (!project) {
    // This should never happen given the length check above
    throw new ContextError(`Project '${projectSlug}' not found`, commandHint);
  }
  const fullShortId = expandToFullShortId(suffix, project.slug);
  const issue = await getIssueByShortId(project.orgSlug, fullShortId);
  return { org: project.orgSlug, issue };
}

/**
 * Resolve a suffix-only issue ID using DSN detection for project context.
 *
 * @param suffix - The issue suffix (e.g., "G", "4Y")
 * @param cwd - Current working directory for DSN detection
 * @param commandHint - Hint for error messages
 */
async function resolveSuffixWithDsn(
  suffix: string,
  cwd: string,
  commandHint: string
): Promise<StrictResolvedIssue> {
  const target = await resolveOrgAndProject({ cwd });
  if (!target) {
    throw new ContextError(
      `Cannot resolve issue suffix '${suffix}' without project context`,
      commandHint
    );
  }
  const fullShortId = expandToFullShortId(suffix, target.project);
  const issue = await getIssueByShortId(target.org, fullShortId);
  return { org: target.org, issue };
}

/**
 * Resolve a "has-dash" format issue ID.
 *
 * Resolution order:
 * 1. Try alias cache (fast, local)
 * 2. Search for project across orgs
 * 3. Error if project not found
 *
 * @param value - The issue ID with dash (e.g., "cli-G", "EXTENSION-7")
 * @param cwd - Current working directory
 * @param commandHint - Hint for error messages
 */
async function resolveHasDash(
  value: string,
  cwd: string,
  commandHint: string
): Promise<StrictResolvedIssue> {
  const { project, suffix } = splitProjectSuffix(value);

  // 1. Try alias cache first (fast, local lookup)
  const aliasResult = await tryResolveFromAlias(project, suffix, cwd);
  if (aliasResult) {
    return aliasResult;
  }

  // 2. Search for project across all accessible orgs
  return resolveByProjectSearch(project, suffix, commandHint);
}

/**
 * Resolve a suffix-only issue ID.
 *
 * Resolution order:
 * 1. Try alias cache (in case suffix is part of an alias like "f")
 * 2. Use DSN detection for project context
 * 3. Error if no context
 *
 * Note: Single-char suffixes might match aliases from `issue list`.
 *
 * @param suffix - The issue suffix (e.g., "G", "4Y")
 * @param cwd - Current working directory
 * @param commandHint - Hint for error messages
 */
function resolveSuffixOnly(
  suffix: string,
  cwd: string,
  commandHint: string
): Promise<StrictResolvedIssue> {
  // Suffix-only means we need project context from DSN detection
  return resolveSuffixWithDsn(suffix.toUpperCase(), cwd, commandHint);
}

/**
 * Resolve with explicit org prefix.
 *
 * The "rest" after org/ can be:
 * - A project-suffix format: "cli-G" → org + project + suffix
 * - A direct short ID: "EXTENSION-7" → fetch directly from org
 * - A suffix only: "G" → use DSN for project, explicit org
 * - A numeric ID: "123456" → fetch directly
 *
 * @param org - The explicit organization slug
 * @param rest - The remainder after "org/"
 * @param cwd - Current working directory
 * @param commandHint - Hint for error messages
 */
async function resolveWithExplicitOrg(
  org: string,
  rest: string,
  cwd: string,
  commandHint: string
): Promise<StrictResolvedIssue> {
  // Check if rest is numeric
  if (NUMERIC_PATTERN.test(rest)) {
    const issue = await getIssue(rest);
    return { org, issue };
  }

  // Check if rest has a dash (could be project-suffix or short ID)
  if (rest.includes("-")) {
    const { project, suffix } = splitProjectSuffix(rest);

    // Try alias cache first
    const aliasResult = await tryResolveFromAlias(project, suffix, cwd);
    if (aliasResult) {
      // Alias found but user specified org - use their org
      const fullShortId = expandToFullShortId(
        suffix,
        aliasResult.issue.project?.slug ?? project
      );
      const issue = await getIssueByShortId(org, fullShortId);
      return { org, issue };
    }

    // Try as project-suffix within the specified org
    try {
      const fullShortId = expandToFullShortId(suffix, project);
      const issue = await getIssueByShortId(org, fullShortId);
      return { org, issue };
    } catch (error) {
      // If not found as project-suffix, try as literal short ID
      if (error instanceof CliError) {
        try {
          const issue = await getIssueByShortId(org, rest.toUpperCase());
          return { org, issue };
        } catch {
          throw error; // Throw original error
        }
      }
      throw error;
    }
  }

  // Suffix only - expand with DSN-detected project or error
  const target = await resolveOrgAndProject({ cwd });
  if (target) {
    const fullShortId = expandToFullShortId(rest, target.project);
    const issue = await getIssueByShortId(org, fullShortId);
    return { org, issue };
  }

  throw new ContextError(
    `Cannot resolve suffix '${rest}' without project context`,
    commandHint,
    [`Specify the project: sentry issue ... ${org}/<project>-${rest}`]
  );
}

/**
 * Options for resolving an issue ID.
 */
export type ResolveIssueOptions = {
  /** User-provided issue argument (raw CLI input) */
  issueArg: string;
  /** Current working directory for context resolution */
  cwd: string;
  /** Command name for error messages (e.g., "view", "explain") */
  command: string;
};

/**
 * Resolve an issue ID to organization slug and full issue object.
 *
 * Supports all issue ID formats:
 * - Org-prefixed: "sentry/EXTENSION-7", "sentry/cli-G"
 * - Project-suffix: "cli-G", "spotlight-electron-4Y"
 * - Short ID: "CLI-G", "EXTENSION-7" (treated as project-suffix)
 * - Suffix only: "G", "4Y" (requires DSN context)
 * - Numeric: "123456789" (direct fetch)
 *
 * @param options - Resolution options
 * @returns Object with org slug and full issue
 * @throws {ContextError} When required context cannot be resolved
 */
export async function resolveIssue(
  options: ResolveIssueOptions
): Promise<ResolvedIssueResult> {
  const { issueArg, cwd, command } = options;
  const parsed = parseIssueArg(issueArg);
  const commandHint = buildCommandHint(command, issueArg);

  switch (parsed.type) {
    case "explicit-org":
      return resolveWithExplicitOrg(parsed.org, parsed.rest, cwd, commandHint);

    case "has-dash":
      return resolveHasDash(parsed.value, cwd, commandHint);

    case "suffix-only":
      return resolveSuffixOnly(parsed.suffix, cwd, commandHint);

    case "numeric": {
      const issue = await getIssue(parsed.id);
      return { org: undefined, issue };
    }

    default: {
      // Exhaustive check - this should never be reached
      const _exhaustive: never = parsed;
      throw new Error(
        `Unexpected issue arg type: ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

/**
 * Resolve both organization slug and numeric issue ID.
 * Required for autofix endpoints that need both org and issue ID.
 * This is a stricter wrapper around resolveIssue that throws if org is undefined.
 *
 * @param options - Resolution options
 * @returns Object with org slug and numeric issue ID
 * @throws {ContextError} When organization cannot be resolved
 */
export async function resolveOrgAndIssueId(
  options: ResolveIssueOptions
): Promise<{ org: string; issueId: string }> {
  const result = await resolveIssue(options);
  if (!result.org) {
    const commandHint = buildCommandHint(options.command, options.issueArg);
    throw new ContextError("Organization", commandHint);
  }
  return { org: result.org, issueId: result.issue.id };
}

type PollAutofixOptions = {
  /** Organization slug */
  orgSlug: string;
  /** Numeric issue ID */
  issueId: string;
  /** Writer for progress output */
  stderr: Writer;
  /** Whether to suppress progress output (JSON mode) */
  json: boolean;
  /** Polling interval in milliseconds (default: 1000) */
  pollIntervalMs?: number;
  /** Maximum time to wait in milliseconds (default: 180000 = 3 minutes) */
  timeoutMs?: number;
  /** Custom timeout error message */
  timeoutMessage?: string;
  /** Stop polling when status is WAITING_FOR_USER_RESPONSE (default: false) */
  stopOnWaitingForUser?: boolean;
};

/**
 * Check if polling should stop based on current state.
 *
 * @param state - Current autofix state
 * @param stopOnWaitingForUser - Whether to stop on WAITING_FOR_USER_RESPONSE status
 * @returns True if polling should stop
 */
function shouldStopPolling(
  state: AutofixState,
  stopOnWaitingForUser: boolean
): boolean {
  if (isTerminalStatus(state.status)) {
    return true;
  }
  if (stopOnWaitingForUser && state.status === "WAITING_FOR_USER_RESPONSE") {
    return true;
  }
  return false;
}

/**
 * Poll autofix state until completion or timeout.
 * Uses the generic poll utility with autofix-specific configuration.
 *
 * @param options - Polling configuration
 * @returns Final autofix state
 * @throws {Error} On timeout
 */
export async function pollAutofixState(
  options: PollAutofixOptions
): Promise<AutofixState> {
  const {
    orgSlug,
    issueId,
    stderr,
    json,
    pollIntervalMs,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    timeoutMessage = "Operation timed out after 3 minutes. Try again or check the issue in Sentry web UI.",
    stopOnWaitingForUser = false,
  } = options;

  return await poll<AutofixState>({
    fetchState: () => getAutofixState(orgSlug, issueId),
    shouldStop: (state) => shouldStopPolling(state, stopOnWaitingForUser),
    getProgressMessage,
    stderr,
    json,
    pollIntervalMs,
    timeoutMs,
    timeoutMessage,
    initialMessage: "Waiting for analysis to start...",
  });
}
