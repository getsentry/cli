/**
 * Shared utilities for issue commands
 *
 * Common functionality used by explain, plan, view, and other issue commands.
 */

import type { FlagParametersForType } from "@stricli/core";
import {
  getAutofixState,
  getIssue,
  getIssueByShortId,
} from "../../lib/api-client.js";
import { getProjectByAlias } from "../../lib/config.js";
import { createDsnFingerprint, detectAllDsns } from "../../lib/dsn/index.js";
import { ContextError } from "../../lib/errors.js";
import { getProgressMessage } from "../../lib/formatters/seer.js";
import {
  expandToFullShortId,
  isShortId,
  isShortSuffix,
  parseAliasSuffix,
} from "../../lib/issue-id.js";
import { poll } from "../../lib/polling.js";
import { resolveOrg, resolveOrgAndProject } from "../../lib/resolve-target.js";
import type { SentryIssue, Writer } from "../../types/index.js";
import { type AutofixState, isTerminalStatus } from "../../types/seer.js";

/** Base flags for issue commands that accept an issue ID */
export type IssueIdFlags = {
  readonly org?: string;
  readonly project?: string;
};

/** Shared --org and --project flag definitions for issue ID commands */
export const issueIdFlags: FlagParametersForType<IssueIdFlags> = {
  org: {
    kind: "parsed",
    parse: String,
    brief: "Organization slug (required for short IDs if not auto-detected)",
    optional: true,
  },
  project: {
    kind: "parsed",
    parse: String,
    brief: "Project slug (required for short suffixes if not auto-detected)",
    optional: true,
  },
};

/** Shared positional parameter for issue ID (numeric, short ID, suffix, or alias-suffix) */
export const issueIdPositional = {
  kind: "tuple",
  parameters: [
    {
      brief:
        "Issue ID, short ID, suffix, or alias-suffix (e.g., 123456, CRAFT-G, G, or f-g)",
      parse: String,
    },
  ],
} as const;

/** Build a command hint string for error messages */
export function buildCommandHint(command: string, issueId: string): string {
  return `sentry issue ${command} ${issueId} --org <org-slug> --project <project-slug>`;
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
 * Try to resolve an alias-suffix format issue ID (e.g., "f-g").
 * Returns null if the alias is not found in cache or fingerprint doesn't match.
 *
 * @param alias - The project alias from the alias-suffix format
 * @param suffix - The issue suffix
 * @param cwd - Current working directory for DSN detection
 */
async function resolveAliasSuffixId(
  alias: string,
  suffix: string,
  cwd: string
): Promise<StrictResolvedIssue | null> {
  // Detect DSNs to create fingerprint for validation
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

type ResolveContext = {
  issueId: string;
  org: string | undefined;
  project: string | undefined;
  cwd: string;
  commandHint: string;
};

/**
 * Try to resolve a short suffix format (e.g., "G", "4Y").
 * Requires project context to expand to full short ID.
 */
async function resolveShortSuffixId(
  ctx: ResolveContext
): Promise<StrictResolvedIssue> {
  const target = await resolveOrgAndProject({
    org: ctx.org,
    project: ctx.project,
    cwd: ctx.cwd,
  });
  if (!target) {
    throw new ContextError("Organization and project", ctx.commandHint);
  }
  const resolvedShortId = expandToFullShortId(ctx.issueId, target.project);
  const issue = await getIssueByShortId(target.org, resolvedShortId);
  return { org: target.org, issue };
}

/**
 * Try to resolve a full short ID format (e.g., "CRAFT-G").
 * Project is embedded in the ID, only needs org context.
 */
async function resolveFullShortId(
  ctx: ResolveContext
): Promise<StrictResolvedIssue> {
  const resolved = await resolveOrg({ org: ctx.org, cwd: ctx.cwd });
  if (!resolved) {
    throw new ContextError("Organization", ctx.commandHint);
  }
  const normalizedId = ctx.issueId.toUpperCase();
  const issue = await getIssueByShortId(resolved.org, normalizedId);
  return { org: resolved.org, issue };
}

/**
 * Try to resolve a numeric issue ID.
 * Fetches issue directly by ID (doesn't require org).
 * Org is resolved separately for API routing (optional).
 */
async function resolveNumericId(
  ctx: ResolveContext
): Promise<ResolvedIssueResult> {
  const issue = await getIssue(ctx.issueId);
  const resolved = await resolveOrg({ org: ctx.org, cwd: ctx.cwd });
  return { org: resolved?.org, issue };
}

/**
 * Options for resolving an issue ID.
 */
export type ResolveIssueOptions = {
  /** User-provided issue ID in any supported format */
  issueId: string;
  /** Optional org slug from CLI flag */
  org?: string;
  /** Optional project slug from CLI flag */
  project?: string;
  /** Current working directory for context resolution */
  cwd: string;
  /** Command example for error messages */
  commandHint: string;
};

/**
 * Resolve an issue ID to organization slug and full issue object.
 * Used by view command which needs the complete issue data.
 *
 * Supports all issue ID formats:
 * - Alias-suffix format (e.g., "f-g" where "f" is a cached project alias)
 * - Short suffix format (e.g., "G", "4Y" - requires project context)
 * - Full short ID format (e.g., "CRAFT-G", "PROJECT-ABC")
 * - Numeric ID format (e.g., "123456789")
 *
 * @param options - Resolution options
 * @returns Object with org slug (may be undefined for numeric) and full issue
 * @throws {ContextError} When required context cannot be resolved
 */
export async function resolveIssue(
  options: ResolveIssueOptions
): Promise<ResolvedIssueResult> {
  const { issueId, org, project, cwd, commandHint } = options;
  const ctx: ResolveContext = { issueId, org, project, cwd, commandHint };

  // Try alias-suffix format (e.g., "f-g")
  const aliasSuffix = parseAliasSuffix(issueId);
  if (aliasSuffix) {
    const result = await resolveAliasSuffixId(
      aliasSuffix.alias,
      aliasSuffix.suffix,
      cwd
    );
    // Only fall through if alias not found (null). Let real errors propagate.
    if (result) {
      return result;
    }
    // Fall through to treat as full short ID
  }

  // Short suffix format (e.g., "G", "4Y") - requires project context.
  // isShortSuffix matches numeric IDs too, so also check isShortId (has letters).
  const looksLikeShortSuffix = isShortSuffix(issueId) && isShortId(issueId);
  if (looksLikeShortSuffix) {
    return resolveShortSuffixId(ctx);
  }

  // Full short ID format (e.g., "CRAFT-G") - requires org context
  if (isShortId(issueId)) {
    return resolveFullShortId(ctx);
  }

  // Numeric ID - fetch issue directly, org is optional
  return resolveNumericId(ctx);
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
    throw new ContextError("Organization", options.commandHint);
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
