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
  getIssueInOrg,
  triggerRootCauseAnalysis,
} from "../../lib/api-client.js";
import { parseIssueArg } from "../../lib/arg-parsing.js";
import { getProjectByAlias } from "../../lib/db/project-aliases.js";
import { detectAllDsns } from "../../lib/dsn/index.js";
import { ApiError, ContextError, ResolutionError } from "../../lib/errors.js";
import { getProgressMessage } from "../../lib/formatters/seer.js";
import { expandToFullShortId, isShortSuffix } from "../../lib/issue-id.js";
import { poll } from "../../lib/polling.js";
import { resolveOrg, resolveOrgAndProject } from "../../lib/resolve-target.js";
import { parseSentryUrl } from "../../lib/sentry-url-parser.js";
import { isAllDigits } from "../../lib/utils.js";
import type { SentryIssue, Writer } from "../../types/index.js";
import { type AutofixState, isTerminalStatus } from "../../types/seer.js";

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
 * - Numeric ID (e.g., "123456789") → suggest `<org>/123456789`
 * - Suffix only (e.g., "G") → suggest `<project>-G`
 * - Has dash (e.g., "cli-G") → suggest `<org>/cli-G`
 *
 * @param command - The issue subcommand (e.g., "view", "explain")
 * @param issueId - The user-provided issue ID
 */
export function buildCommandHint(command: string, issueId: string): string {
  // Numeric IDs always need org context - can't be combined with project
  if (isAllDigits(issueId)) {
    return `sentry issue ${command} <org>/${issueId}`;
  }
  // Short suffixes can be combined with project prefix
  if (isShortSuffix(issueId)) {
    return `sentry issue ${command} <project>-${issueId}`;
  }
  // Everything else (has dash) needs org prefix
  return `sentry issue ${command} <org>/${issueId}`;
}

/** Default timeout in milliseconds (6 minutes) */
const DEFAULT_TIMEOUT_MS = 360_000;

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
  // Detect DSNs to get fingerprint for validation
  const detection = await detectAllDsns(cwd);
  const fingerprint = detection.fingerprint;
  const projectEntry = await getProjectByAlias(alias, fingerprint);
  if (!projectEntry) {
    return null;
  }

  const resolvedShortId = expandToFullShortId(suffix, projectEntry.projectSlug);
  const issue = await getIssueByShortId(projectEntry.orgSlug, resolvedShortId);
  return { org: projectEntry.orgSlug, issue };
}

/**
 * Resolve project-search type: search for project across orgs, then fetch issue.
 *
 * Resolution order:
 * 1. Try alias cache (fast, local)
 * 2. Search for project across orgs via API
 *
 * @param projectSlug - Project slug to search for
 * @param suffix - Issue suffix (uppercase)
 * @param cwd - Current working directory
 * @param commandHint - Hint for error messages
 */
async function resolveProjectSearch(
  projectSlug: string,
  suffix: string,
  cwd: string,
  commandHint: string
): Promise<StrictResolvedIssue> {
  // 1. Try alias cache first (fast, local lookup)
  const aliasResult = await tryResolveFromAlias(
    projectSlug.toLowerCase(),
    suffix,
    cwd
  );
  if (aliasResult) {
    return aliasResult;
  }

  // 2. Search for project across all accessible orgs
  const projects = await findProjectsBySlug(projectSlug.toLowerCase());

  if (projects.length === 0) {
    throw new ResolutionError(
      `Project '${projectSlug}'`,
      "not found",
      commandHint,
      ["No project with this slug found in any accessible organization"]
    );
  }

  if (projects.length > 1) {
    const orgList = projects.map((p) => p.orgSlug).join(", ");
    throw new ResolutionError(
      `Project '${projectSlug}'`,
      "is ambiguous",
      commandHint,
      [
        `Found in: ${orgList}`,
        `Specify the org: sentry issue ... <org>/${projectSlug}-${suffix}`,
      ]
    );
  }

  const project = projects[0];
  if (!project) {
    throw new ResolutionError(
      `Project '${projectSlug}'`,
      "not found",
      commandHint
    );
  }

  const fullShortId = expandToFullShortId(suffix, project.slug);
  const issue = await getIssueByShortId(project.orgSlug, fullShortId);
  return { org: project.orgSlug, issue };
}

/**
 * Resolve suffix-only type using DSN detection for project context.
 *
 * @param suffix - The issue suffix (uppercase)
 * @param cwd - Current working directory for DSN detection
 * @param commandHint - Hint for error messages
 */
async function resolveSuffixOnly(
  suffix: string,
  cwd: string,
  commandHint: string
): Promise<StrictResolvedIssue> {
  const target = await resolveOrgAndProject({ cwd });
  if (!target) {
    throw new ResolutionError(
      `Issue suffix '${suffix}'`,
      "could not be resolved without project context",
      commandHint
    );
  }
  const fullShortId = expandToFullShortId(suffix, target.project);
  const issue = await getIssueByShortId(target.org, fullShortId);
  return { org: target.org, issue };
}

/**
 * Resolve explicit-org-suffix type: org provided but only suffix given.
 *
 * This format (`org/suffix`) is ambiguous - we have org but no project.
 * We don't use DSN detection here because mixing explicit org with
 * DSN-detected project (which belongs to a potentially different org)
 * would be semantically wrong and confusing.
 *
 * @param org - Explicit organization slug
 * @param suffix - Issue suffix (uppercase)
 * @param commandHint - Hint for error messages
 */
function resolveExplicitOrgSuffix(
  org: string,
  suffix: string,
  commandHint: string
): never {
  throw new ResolutionError(
    `Issue suffix '${suffix}'`,
    "could not be resolved without project context",
    commandHint,
    [
      `The format '${org}/${suffix}' requires a project to build the full issue ID.`,
      `Use: sentry issue ... ${org}/<project>-${suffix}`,
    ]
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
 * Extract the organization slug from a Sentry issue permalink.
 *
 * Handles both path-based (`https://sentry.io/organizations/{org}/issues/...`)
 * and subdomain-style (`https://{org}.sentry.io/issues/...`) SaaS URLs.
 * Returns undefined if the permalink is missing or not a recognized format.
 *
 * @param permalink - Issue permalink URL from the Sentry API response
 */
function extractOrgFromPermalink(
  permalink: string | undefined
): string | undefined {
  if (!permalink) {
    return;
  }
  return parseSentryUrl(permalink)?.org;
}

/**
 * Resolve a bare numeric issue ID.
 *
 * Attempts org-scoped resolution with region routing when org context can be
 * derived from the working directory (DSN / env vars / config defaults).
 * Falls back to the legacy unscoped endpoint otherwise.
 * Extracts the org slug from the response permalink so callers like
 * {@link resolveOrgAndIssueId} can proceed without explicit org context.
 */
async function resolveNumericIssue(
  id: string,
  cwd: string,
  command: string,
  commandHint: string
): Promise<ResolvedIssueResult> {
  const resolvedOrg = await resolveOrg({ cwd });
  try {
    const issue = resolvedOrg
      ? await getIssueInOrg(resolvedOrg.org, id)
      : await getIssue(id);
    // Extract org from the response permalink as a fallback so that callers
    // like resolveOrgAndIssueId (used by explain/plan) get the org slug even
    // when no org context was available before the fetch.
    const org = resolvedOrg?.org ?? extractOrgFromPermalink(issue.permalink);
    return { org, issue };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Improve on the generic "Issue not found" message by including the ID
      // and suggesting the short-ID format, since users often confuse numeric
      // group IDs with short-ID suffixes.
      throw new ResolutionError(`Issue ${id}`, "not found", commandHint, [
        `No issue with numeric ID ${id} found — you may not have access, or it may have been deleted.`,
        `If this is a short ID suffix, try: sentry issue ${command} <project>-${id}`,
      ]);
    }
    throw err;
  }
}

/**
 * Resolve an issue ID to organization slug and full issue object.
 *
 * Supports all issue ID formats (now parsed by parseIssueArg in arg-parsing.ts):
 * - explicit: "sentry/cli-G" → org + project + suffix
 * - explicit-org-suffix: "sentry/G" → org + suffix (needs DSN for project)
 * - explicit-org-numeric: "sentry/123456789" → org + numeric ID
 * - project-search: "cli-G" → search for project across orgs
 * - suffix-only: "G" (requires DSN context)
 * - numeric: "123456789" (direct fetch, no org)
 *
 * @param options - Resolution options
 * @returns Object with org slug and full issue
 * @throws {ContextError} When required context (org) is missing
 * @throws {ResolutionError} When an issue or project could not be found or resolved
 */
export async function resolveIssue(
  options: ResolveIssueOptions
): Promise<ResolvedIssueResult> {
  const { issueArg, cwd, command } = options;
  const parsed = parseIssueArg(issueArg);
  const commandHint = buildCommandHint(command, issueArg);

  switch (parsed.type) {
    case "numeric":
      return resolveNumericIssue(parsed.id, cwd, command, commandHint);

    case "explicit": {
      // Full context: org + project + suffix
      const fullShortId = expandToFullShortId(parsed.suffix, parsed.project);
      const issue = await getIssueByShortId(parsed.org, fullShortId);
      return { org: parsed.org, issue };
    }

    case "explicit-org-numeric": {
      // Org + numeric ID — use org-scoped endpoint for proper region routing.
      try {
        const issue = await getIssueInOrg(parsed.org, parsed.numericId);
        return { org: parsed.org, issue };
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          throw new ResolutionError(
            `Issue ${parsed.numericId}`,
            "not found",
            commandHint,
            [
              `No issue with numeric ID ${parsed.numericId} found in org '${parsed.org}' — you may not have access, or it may have been deleted.`,
              `If this is a short ID suffix, try: sentry issue ${command} <project>-${parsed.numericId}`,
            ]
          );
        }
        throw err;
      }
    }

    case "explicit-org-suffix":
      // Org + suffix only - ambiguous without project, always errors
      return resolveExplicitOrgSuffix(parsed.org, parsed.suffix, commandHint);

    case "project-search":
      // Project slug + suffix - search across orgs
      return resolveProjectSearch(
        parsed.projectSlug,
        parsed.suffix,
        cwd,
        commandHint
      );

    case "suffix-only":
      // Just suffix - need DSN for org and project
      return resolveSuffixOnly(parsed.suffix, cwd, commandHint);

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
  /** Maximum time to wait in milliseconds (default: 360000 = 6 minutes) */
  timeoutMs?: number;
  /** Custom timeout error message */
  timeoutMessage?: string;
  /** Stop polling when status is WAITING_FOR_USER_RESPONSE (default: false) */
  stopOnWaitingForUser?: boolean;
};

type EnsureRootCauseOptions = {
  /** Organization slug */
  org: string;
  /** Numeric issue ID */
  issueId: string;
  /** Writer for progress output */
  stderr: Writer;
  /** Whether to suppress progress output (JSON mode) */
  json: boolean;
  /** Force new analysis even if one exists */
  force?: boolean;
};

/**
 * Ensure root cause analysis exists for an issue.
 *
 * If no analysis exists (or force is true), triggers a new analysis.
 * If analysis is in progress, waits for it to complete.
 * If analysis failed (ERROR status), retries automatically.
 *
 * @param options - Configuration options
 * @returns The completed autofix state with root causes
 */
export async function ensureRootCauseAnalysis(
  options: EnsureRootCauseOptions
): Promise<AutofixState> {
  const { org, issueId, stderr, json, force = false } = options;

  // 1. Check for existing analysis (skip if --force)
  let state = force ? null : await getAutofixState(org, issueId);

  // Handle error status - we will retry the analysis
  if (state?.status === "ERROR") {
    if (!json) {
      stderr.write("Previous analysis failed, retrying...\n");
    }
    state = null;
  }

  // 2. Trigger new analysis if none exists or forced
  if (!state) {
    if (!json) {
      const prefix = force ? "Forcing fresh" : "Starting";
      stderr.write(
        `${prefix} root cause analysis, it can take several minutes...\n`
      );
    }
    await triggerRootCauseAnalysis(org, issueId);
  }

  // 3. Poll until complete (if not already completed)
  if (
    !state ||
    (state.status !== "COMPLETED" &&
      state.status !== "WAITING_FOR_USER_RESPONSE")
  ) {
    state = await pollAutofixState({
      orgSlug: org,
      issueId,
      stderr,
      json,
      stopOnWaitingForUser: true,
    });
  }

  return state;
}

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
    timeoutMessage = "Operation timed out after 6 minutes. Try again or check the issue in Sentry web UI.",
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
