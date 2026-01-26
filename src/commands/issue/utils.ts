/**
 * Shared utilities for issue commands
 *
 * Common functionality used by explain, plan, view, and other issue commands.
 */

import { getAutofixState, getIssueByShortId } from "../../lib/api-client.js";
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
import type { Writer } from "../../types/index.js";
import { type AutofixState, isTerminalStatus } from "../../types/seer.js";

/** Default timeout in milliseconds (3 minutes) */
const DEFAULT_TIMEOUT_MS = 180_000;

type ResolvedIssue = {
  /** Resolved organization slug */
  org: string;
  /** Numeric issue ID */
  issueId: string;
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
): Promise<ResolvedIssue | null> {
  // Detect DSNs to create fingerprint for validation
  const detection = await detectAllDsns(cwd);
  const fingerprint = createDsnFingerprint(detection.all);
  const projectEntry = await getProjectByAlias(alias, fingerprint);
  if (!projectEntry) {
    return null;
  }

  const resolvedShortId = expandToFullShortId(suffix, projectEntry.projectSlug);
  const issue = await getIssueByShortId(projectEntry.orgSlug, resolvedShortId);
  return { org: projectEntry.orgSlug, issueId: issue.id };
}

type ResolveContext = {
  issueId: string;
  org: string | undefined;
  cwd: string;
  commandHint: string;
};

/**
 * Try to resolve a short suffix format (e.g., "G", "4Y").
 * Requires project context to expand to full short ID.
 */
async function resolveShortSuffixId(
  ctx: ResolveContext
): Promise<ResolvedIssue> {
  const target = await resolveOrgAndProject({ org: ctx.org, cwd: ctx.cwd });
  if (!target) {
    throw new ContextError(
      "Organization and project",
      ctx.commandHint.replace("--org <org>", "--org <org> --project <project>")
    );
  }
  const resolvedShortId = expandToFullShortId(ctx.issueId, target.project);
  const issue = await getIssueByShortId(target.org, resolvedShortId);
  return { org: target.org, issueId: issue.id };
}

/**
 * Try to resolve a full short ID format (e.g., "CRAFT-G").
 * Project is embedded in the ID, only needs org context.
 */
async function resolveFullShortId(ctx: ResolveContext): Promise<ResolvedIssue> {
  const resolved = await resolveOrg({ org: ctx.org, cwd: ctx.cwd });
  if (!resolved) {
    throw new ContextError("Organization", ctx.commandHint);
  }
  const normalizedId = ctx.issueId.toUpperCase();
  const issue = await getIssueByShortId(resolved.org, normalizedId);
  return { org: resolved.org, issueId: issue.id };
}

/**
 * Try to resolve a numeric issue ID.
 * Only needs org for API routing.
 */
async function resolveNumericId(ctx: ResolveContext): Promise<ResolvedIssue> {
  const resolved = await resolveOrg({ org: ctx.org, cwd: ctx.cwd });
  if (!resolved) {
    throw new ContextError("Organization", ctx.commandHint);
  }
  return { org: resolved.org, issueId: ctx.issueId };
}

/**
 * Resolve both organization slug and numeric issue ID.
 * Required for autofix endpoints that need both org and issue ID.
 *
 * Supports all issue ID formats:
 * - Alias-suffix format (e.g., "f-g" where "f" is a cached project alias)
 * - Short suffix format (e.g., "G", "4Y" - requires project context)
 * - Full short ID format (e.g., "CRAFT-G", "PROJECT-ABC")
 * - Numeric ID format (e.g., "123456789")
 *
 * @param issueId - User-provided issue ID in any supported format
 * @param org - Optional org slug from CLI flag
 * @param cwd - Current working directory for context resolution
 * @param commandHint - Command example for error messages
 * @returns Object with org slug and numeric issue ID
 * @throws {ContextError} When organization cannot be resolved
 */
export async function resolveOrgAndIssueId(
  issueId: string,
  org: string | undefined,
  cwd: string,
  commandHint: string
): Promise<ResolvedIssue> {
  const ctx: ResolveContext = { issueId, org, cwd, commandHint };

  // Try alias-suffix format (e.g., "f-g")
  const aliasSuffix = parseAliasSuffix(issueId);
  if (aliasSuffix) {
    const result = await resolveAliasSuffixId(
      aliasSuffix.alias,
      aliasSuffix.suffix,
      cwd
    ).catch(() => null);
    if (result) return result;
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

  // Numeric ID - only need org for API routing
  return resolveNumericId(ctx);
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
