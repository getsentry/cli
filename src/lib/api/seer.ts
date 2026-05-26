/**
 * Seer AI API functions
 *
 * Functions for Seer-powered root cause analysis, autofix state,
 * and solution planning. Uses the agent-based (explorer) endpoint
 * which returns blocks instead of steps.
 */

import type { AutofixResponse, AutofixState } from "../../types/seer.js";

import { resolveOrgRegion } from "../region.js";

import { apiRequestToRegion } from "./infrastructure.js";

/** Query params to activate the agent-based autofix endpoint */
const EXPLORER_MODE_PARAMS = { mode: "explorer" };

/**
 * Normalize agent status values to the uppercase format used throughout the CLI.
 *
 * The agent endpoint returns lowercase statuses (`processing`, `completed`,
 * `error`, `awaiting_user_input`) while the CLI expects uppercase
 * (`PROCESSING`, `COMPLETED`, `ERROR`, `WAITING_FOR_USER_RESPONSE`).
 */
function normalizeAgentStatus(status: string): string {
  switch (status) {
    case "processing":
      return "PROCESSING";
    case "completed":
      return "COMPLETED";
    case "error":
      return "ERROR";
    case "awaiting_user_input":
      return "WAITING_FOR_USER_RESPONSE";
    default:
      return status.toUpperCase();
  }
}

/**
 * Trigger root cause analysis for an issue using Seer AI.
 * Uses the agent-based endpoint with region-aware routing.
 *
 * @param orgSlug - The organization slug
 * @param issueId - The numeric Sentry issue ID
 * @returns The trigger response with run_id
 * @throws {ApiError} On API errors (402 = no budget, 403 = not enabled)
 */
export async function triggerRootCauseAnalysis(
  orgSlug: string,
  issueId: string
): Promise<{ run_id: number }> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data } = await apiRequestToRegion<{ run_id: number }>(
    regionUrl,
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    {
      method: "POST",
      params: EXPLORER_MODE_PARAMS,
      body: {
        step: "root_cause",
        referrer: "api.cli",
      },
    }
  );
  return data;
}

/**
 * Get the current autofix state for an issue.
 * Uses the agent-based endpoint with region-aware routing.
 *
 * @param orgSlug - The organization slug
 * @param issueId - The numeric Sentry issue ID
 * @returns The autofix state, or null if no autofix has been run
 */
export async function getAutofixState(
  orgSlug: string,
  issueId: string
): Promise<AutofixState | null> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data } = await apiRequestToRegion<AutofixResponse>(
    regionUrl,
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    {
      params: EXPLORER_MODE_PARAMS,
    }
  );

  if (!data.autofix) {
    return null;
  }

  // Normalize agent status to uppercase format used by the CLI
  data.autofix.status = normalizeAgentStatus(data.autofix.status);
  return data.autofix;
}

/**
 * Trigger solution planning for an existing autofix run.
 *
 * Posts to the agent-based autofix endpoint with `step: "solution"` and
 * the existing `run_id`. The agent continues from root cause analysis
 * to generating a solution plan.
 *
 * @param orgSlug - The organization slug
 * @param issueId - The numeric Sentry issue ID
 * @param runId - The autofix run ID
 * @returns The response from the API
 */
export async function triggerSolutionPlanning(
  orgSlug: string,
  issueId: string,
  runId: number
): Promise<unknown> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const { data } = await apiRequestToRegion(
    regionUrl,
    `/organizations/${orgSlug}/issues/${issueId}/autofix/`,
    {
      method: "POST",
      params: EXPLORER_MODE_PARAMS,
      body: {
        step: "solution",
        run_id: runId,
        referrer: "api.cli",
      },
    }
  );
  return data;
}
