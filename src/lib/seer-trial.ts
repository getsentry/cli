/**
 * Seer Trial Prompt
 *
 * Interactive flow to check for and start a Seer product trial
 * when a Seer command fails due to budget/enablement errors.
 *
 * Called from bin.ts when a SeerError is caught. Checks trial availability
 * via the customer API, prompts the user for confirmation, and starts the
 * trial if accepted. All failures degrade gracefully — the original error
 * is re-thrown by the caller if this function returns false.
 */

import { isatty } from "node:tty";

import { getSeerTrialStatus, startSeerTrial } from "./api-client.js";
import type { SeerError, SeerErrorReason } from "./errors.js";
import { success } from "./formatters/colors.js";
import { logger } from "./logger.js";

/** Seer error reasons eligible for trial prompt */
const TRIAL_ELIGIBLE_REASONS: ReadonlySet<SeerErrorReason> = new Set([
  "no_budget",
  "not_enabled",
]);

/** User-facing context messages shown before the trial prompt */
const REASON_CONTEXT: Record<string, string> = {
  no_budget: "Your organization has run out of Seer quota.",
  not_enabled: "Seer is not enabled for your organization.",
};

/**
 * Check whether a SeerError is eligible for a trial prompt.
 *
 * Only `no_budget` and `not_enabled` are eligible — `ai_disabled` is
 * an explicit admin decision that a trial wouldn't override.
 * Requires orgSlug (needed for API calls) and interactive terminal.
 *
 * @param error - The SeerError to check
 * @returns true if the error is eligible for a trial prompt
 */
export function isTrialEligible(error: SeerError): boolean {
  return (
    TRIAL_ELIGIBLE_REASONS.has(error.reason) &&
    error.orgSlug !== undefined &&
    isatty(0)
  );
}

/**
 * Attempt to offer and start a Seer trial.
 *
 * Flow:
 * 1. Check trial availability via API (graceful failure → return false)
 * 2. Show context message + prompt user for confirmation
 * 3. Start the trial via API
 *
 * @param orgSlug - Organization slug
 * @param reason - The SeerError reason (for context message)
 * @param stderr - Stderr stream for messages
 * @returns true if trial was started successfully, false otherwise
 */
export async function promptAndStartTrial(
  orgSlug: string,
  reason: SeerErrorReason,
  stderr: NodeJS.WriteStream
): Promise<boolean> {
  // 1. Check trial availability (graceful failure → return false)
  let trial: Awaited<ReturnType<typeof getSeerTrialStatus>>;
  try {
    trial = await getSeerTrialStatus(orgSlug);
  } catch {
    // Can't check trial status — degrade gracefully
    return false;
  }

  if (!trial) {
    // No trial available — fall through to normal error
    return false;
  }

  // 2. Show context and prompt
  const context = REASON_CONTEXT[reason] ?? "";
  if (context) {
    stderr.write(`${context}\n`);
  }

  const daysText = trial.lengthDays ? `${trial.lengthDays}-day ` : "";
  const log = logger.withTag("seer");
  const confirmed = await log.prompt(
    `A free ${daysText}Seer trial is available. Start trial?`,
    { type: "confirm", initial: true }
  );

  // Symbol(clack:cancel) is truthy — strict equality check
  if (confirmed !== true) {
    return false;
  }

  // 3. Start trial using the category from the available trial
  try {
    stderr.write("\nStarting Seer trial...\n");
    await startSeerTrial(orgSlug, trial.category);
    stderr.write(`${success("✓")} Seer trial activated!\n`);
    return true;
  } catch {
    stderr.write(
      "Failed to start trial. Please try again or visit your Sentry settings.\n"
    );
    return false;
  }
}
