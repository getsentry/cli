/**
 * Shared utilities for issue commands
 *
 * Common functionality used by explain, fix, and other issue commands.
 */

import {
  getAutofixState,
  getIssueByShortId,
  isShortId,
} from "../../lib/api-client.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatProgressLine,
  getProgressMessage,
} from "../../lib/formatters/autofix.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { type AutofixState, isTerminalStatus } from "../../types/autofix.js";
import type { Writer } from "../../types/index.js";

/** Default polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL_MS = 3000;

/** Default timeout in milliseconds (10 minutes) */
const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Resolve the numeric issue ID from either a numeric ID or short ID.
 * Short IDs (e.g., MYPROJECT-ABC) require organization context.
 *
 * @param issueId - User-provided issue ID (numeric or short)
 * @param org - Optional org slug for short ID resolution
 * @param cwd - Current working directory for org resolution
 * @param commandHint - Command example for error messages (e.g., "sentry issue explain ISSUE-123 --org <org>")
 * @returns Numeric issue ID
 * @throws {ContextError} When short ID provided without resolvable organization
 */
export async function resolveIssueId(
  issueId: string,
  org: string | undefined,
  cwd: string,
  commandHint: string
): Promise<string> {
  if (!isShortId(issueId)) {
    return issueId;
  }

  // Short ID requires organization context
  const resolved = await resolveOrg({ org, cwd });
  if (!resolved) {
    throw new ContextError("Organization", commandHint);
  }

  const issue = await getIssueByShortId(resolved.org, issueId);
  return issue.id;
}

type PollOptions = {
  /** Polling interval in milliseconds (default: 3000) */
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
 * Update progress display with spinner animation.
 */
function updateProgressDisplay(
  stderr: Writer,
  state: AutofixState,
  tick: number
): void {
  const message = getProgressMessage(state);
  stderr.write(`\r\x1b[K${formatProgressLine(message, tick)}`);
}

/**
 * Poll autofix state until completion or timeout.
 * Displays progress spinner and messages to stderr when not in JSON mode.
 *
 * @param issueId - Numeric issue ID
 * @param stderr - Writer for progress output
 * @param json - Whether to suppress progress output (JSON mode)
 * @param options - Polling configuration
 * @returns Final autofix state
 * @throws {Error} On timeout
 */
export async function pollAutofixState(
  issueId: string,
  stderr: Writer,
  json: boolean,
  options: PollOptions = {}
): Promise<AutofixState> {
  const {
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    timeoutMessage = "Operation timed out after 10 minutes. Check the issue in Sentry web UI.",
    stopOnWaitingForUser = false,
  } = options;

  const startTime = Date.now();
  let tick = 0;

  while (Date.now() - startTime < timeoutMs) {
    const state = await getAutofixState(issueId);

    if (!state) {
      await Bun.sleep(pollIntervalMs);
      continue;
    }

    if (!json) {
      updateProgressDisplay(stderr, state, tick);
      tick += 1;
    }

    if (shouldStopPolling(state, stopOnWaitingForUser)) {
      if (!json) {
        stderr.write("\n");
      }
      return state;
    }

    await Bun.sleep(pollIntervalMs);
  }

  throw new Error(timeoutMessage);
}
