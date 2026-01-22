/**
 * sentry issue explain
 *
 * Get an AI-generated summary and analysis of a Sentry issue.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getIssueSummary } from "../../lib/api-client.js";
import { ApiError } from "../../lib/errors.js";
import { writeJson } from "../../lib/formatters/index.js";
import { formatIssueSummary } from "../../lib/formatters/summary.js";
import { resolveOrgAndIssueId } from "./utils.js";

type ExplainFlags = {
  readonly org?: string;
  readonly json: boolean;
};

export const explainCommand = buildCommand({
  docs: {
    brief: "Analyze an issue using Seer AI",
    fullDescription:
      "Get an AI-generated summary and root cause analysis for a Sentry issue.\n\n" +
      "This command uses Seer AI to analyze the issue and provide:\n" +
      "  - A headline summary of what's happening\n" +
      "  - What's wrong with the code\n" +
      "  - Stack trace analysis\n" +
      "  - Possible root cause\n\n" +
      "Examples:\n" +
      "  sentry issue explain 123456789\n" +
      "  sentry issue explain MYPROJECT-ABC --org my-org\n" +
      "  sentry issue explain 123456789 --json",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Issue ID or short ID (e.g., MYPROJECT-ABC or 123456789)",
          parse: String,
        },
      ],
    },
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief:
          "Organization slug (required for short IDs if not auto-detected)",
        optional: true,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(
    this: SentryContext,
    flags: ExplainFlags,
    issueId: string
  ): Promise<void> {
    const { stdout, stderr, cwd } = this;

    try {
      // Resolve org and issue ID
      const { org, issueId: numericId } = await resolveOrgAndIssueId(
        issueId,
        flags.org,
        cwd,
        `sentry issue explain ${issueId} --org <org-slug>`
      );

      if (!flags.json) {
        stderr.write(`Analyzing issue ${issueId}...\n`);
      }

      // Get the AI-generated summary
      const summary = await getIssueSummary(org, numericId);

      // Output results
      if (flags.json) {
        writeJson(stdout, summary);
        return;
      }

      // Human-readable output
      const lines = formatIssueSummary(summary);
      stdout.write(`${lines.join("\n")}\n`);
    } catch (error) {
      // Handle API errors with friendly messages
      if (error instanceof ApiError) {
        if (error.status === 404) {
          throw new Error(
            "Issue not found, or AI summaries are not available for this issue."
          );
        }
        if (error.status === 403) {
          throw new Error("AI features are not enabled for this organization.");
        }
        throw new Error(error.detail ?? "Failed to analyze issue.");
      }
      throw error;
    }
  },
});
