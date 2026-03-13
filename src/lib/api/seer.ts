/**
 * Seer AI API functions
 *
 * Functions for Seer-powered root cause analysis, autofix state,
 * and solution planning.
 */

import { retrieveSeerIssueFixState, startSeerIssueFix } from "@sentry/api";

import type { AutofixResponse, AutofixState } from "../../types/seer.js";

import { resolveOrgRegion } from "../region.js";

import {
  apiRequestToRegion,
  getOrgSdkConfig,
  unwrapResult,
} from "./infrastructure.js";

/**
 * Trigger root cause analysis for an issue using Seer AI.
 * Uses region-aware routing for multi-region support.
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
  const config = await getOrgSdkConfig(orgSlug);

  const result = await startSeerIssueFix({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      issue_id: Number(issueId),
    },
    body: {
      stopping_point: "root_cause",
    },
  });

  const data = unwrapResult(result, "Failed to trigger root cause analysis");
  return data as unknown as { run_id: number };
}

/**
 * Get the current autofix state for an issue.
 * Uses region-aware routing for multi-region support.
 *
 * @param orgSlug - The organization slug
 * @param issueId - The numeric Sentry issue ID
 * @returns The autofix state, or null if no autofix has been run
 */
export async function getAutofixState(
  orgSlug: string,
  issueId: string
): Promise<AutofixState | null> {
  const config = await getOrgSdkConfig(orgSlug);

  const result = await retrieveSeerIssueFixState({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      issue_id: Number(issueId),
    },
  });

  const data = unwrapResult(result, "Failed to get autofix state");
  const autofixResponse = data as unknown as AutofixResponse;
  return autofixResponse.autofix;
}

/**
 * Trigger solution planning for an existing autofix run.
 * Uses region-aware routing for multi-region support.
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
      body: {
        run_id: runId,
        step: "solution",
      },
    }
  );
  return data;
}
