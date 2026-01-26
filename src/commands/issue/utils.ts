/**
 * Shared utilities for issue commands
 *
 * Common functionality used by explain, plan, and other issue commands.
 */

import { getAutofixState, getIssueByShortId } from "../../lib/api-client.js";
import { ContextError } from "../../lib/errors.js";
import { getProgressMessage } from "../../lib/formatters/seer.js";
import { isShortId } from "../../lib/issue-id.js";
import { poll } from "../../lib/polling.js";
import { resolveOrg } from "../../lib/resolve-target.js";
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
 * Resolve both organization slug and numeric issue ID.
 * Required for autofix endpoints that need both org and issue ID.
 *
 * @param issueId - User-provided issue ID (numeric or short)
 * @param org - Optional org slug
 * @param cwd - Current working directory for org resolution
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
  // Always need org for endpoints like /autofix/
  const resolved = await resolveOrg({ org, cwd });
  if (!resolved) {
    throw new ContextError("Organization", commandHint);
  }

  // If it's a short ID, resolve to numeric ID
  if (isShortId(issueId)) {
    const issue = await getIssueByShortId(resolved.org, issueId);
    return { org: resolved.org, issueId: issue.id };
  }

  return { org: resolved.org, issueId };
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
