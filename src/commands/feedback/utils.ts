/**
 * Shared resolution utilities for modern User Feedback commands.
 */

import { ApiError, ResolutionError } from "../../lib/errors.js";
import type { SentryFeedback } from "../../types/index.js";
import { buildCommandHint, resolveIssue } from "../issue/utils.js";

/** Positional parameter for a Feedback numeric ID, short ID, or scoped ID. */
export const feedbackIdPositional = {
  kind: "tuple",
  parameters: [
    {
      placeholder: "org/project/feedback-id",
      brief:
        "Feedback ID: numeric ID, short ID, <org>/SHORT-ID, or <org>/<project>/<suffix>",
      parse: String,
    },
  ],
} as const;

/** Result of resolving and category-checking a modern Feedback issue. */
export type ResolvedFeedback = {
  /** Resolved organization slug, when available. */
  org: string | undefined;
  /** Category-constrained Feedback issue. */
  feedback: SentryFeedback;
};

/**
 * Resolve an issue-style identifier and require the result to be User Feedback.
 */
export async function resolveFeedback(
  feedbackArg: string,
  cwd: string
): Promise<ResolvedFeedback> {
  let resolved: Awaited<ReturnType<typeof resolveIssue>>;
  try {
    resolved = await resolveIssue({
      issueArg: feedbackArg,
      cwd,
      command: "view",
      commandBase: "sentry feedback",
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ResolutionError(
        `Feedback '${feedbackArg}'`,
        "not found",
        buildCommandHint("view", feedbackArg, "sentry feedback"),
        ["List available Feedback: sentry feedback list"]
      );
    }
    throw error;
  }
  const { org, issue } = resolved;

  if (issue.issueCategory !== "feedback") {
    throw new ResolutionError(
      `Issue '${issue.shortId}'`,
      "is not User Feedback",
      `sentry issue view ${org ? `${org}/` : ""}${issue.shortId}`,
      ["Use a Feedback ID from: sentry feedback list"]
    );
  }

  return { org, feedback: issue as SentryFeedback };
}
