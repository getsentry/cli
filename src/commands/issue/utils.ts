/**
 * Shared utilities for issue commands
 *
 * Common functionality used by explain, plan, and other issue commands.
 */

import { getAutofixState, getIssueByShortId } from "../../lib/api-client.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatProgressLine,
  getProgressMessage,
  truncateProgressMessage,
} from "../../lib/formatters/autofix.js";
import { isShortId } from "../../lib/issue-id.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { type AutofixState, isTerminalStatus } from "../../types/autofix.js";
import type { Writer } from "../../types/index.js";

/** Default polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL_MS = 1000;

/** Animation interval for spinner updates (independent of polling) */
const ANIMATION_INTERVAL_MS = 80;

/** Default timeout in milliseconds (10 minutes) */
const DEFAULT_TIMEOUT_MS = 600_000;

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
  /** Maximum time to wait in milliseconds (default: 600000 = 10 minutes) */
  timeoutMs?: number;
  /** Custom timeout error message */
  timeoutMessage?: string;
  /** Stop polling when status is WAITING_FOR_USER_RESPONSE (default: false) */
  stopOnWaitingForUser?: boolean;
};

/**
 * Check if polling should stop based on current state.
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
 * Displays progress spinner and messages to stderr when not in JSON mode.
 * Animation runs at 80ms intervals independently of polling frequency.
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
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    timeoutMessage = "Operation timed out after 10 minutes. Check the issue in Sentry web UI.",
    stopOnWaitingForUser = false,
  } = options;

  const startTime = Date.now();
  let tick = 0;
  let currentMessage = "Waiting for analysis to start...";

  // Animation timer runs independently of polling for smooth spinner
  let animationTimer: Timer | undefined;
  if (!json) {
    animationTimer = setInterval(() => {
      const display = truncateProgressMessage(currentMessage);
      stderr.write(`\r\x1b[K${formatProgressLine(display, tick)}`);
      tick += 1;
    }, ANIMATION_INTERVAL_MS);
  }

  try {
    while (Date.now() - startTime < timeoutMs) {
      const state = await getAutofixState(orgSlug, issueId);

      if (state) {
        // Update message for animation loop to display
        currentMessage = getProgressMessage(state);

        if (shouldStopPolling(state, stopOnWaitingForUser)) {
          return state;
        }
      }

      await Bun.sleep(pollIntervalMs);
    }

    throw new Error(timeoutMessage);
  } finally {
    // Clean up animation timer
    if (animationTimer) {
      clearInterval(animationTimer);
      stderr.write("\n");
    }
  }
}
