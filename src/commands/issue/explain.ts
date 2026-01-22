/**
 * sentry issue explain
 *
 * Get root cause analysis for a Sentry issue using Seer AI.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getAutofixState, triggerAutofix } from "../../lib/api-client.js";
import { ApiError } from "../../lib/errors.js";
import {
  formatAutofixError,
  formatRootCauseList,
} from "../../lib/formatters/autofix.js";
import { writeJson } from "../../lib/formatters/index.js";
import { extractRootCauses } from "../../types/autofix.js";
import { pollAutofixState, resolveOrgAndIssueId } from "./utils.js";

type ExplainFlags = {
  readonly org?: string;
  readonly json: boolean;
};

export const explainCommand = buildCommand({
  docs: {
    brief: "Analyze an issue's root cause using Seer AI",
    fullDescription:
      "Get a root cause analysis for a Sentry issue using Seer AI.\n\n" +
      "This command analyzes the issue and provides:\n" +
      "  - Identified root causes\n" +
      "  - Reproduction steps\n" +
      "  - Relevant code locations\n\n" +
      "The analysis may take a few minutes for new issues.\n\n" +
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

      // 1. Check for existing analysis
      let state = await getAutofixState(org, numericId);

      // Handle error status, we are gonna retry the analysis
      if (state?.status === "ERROR") {
        stderr.write("Root cause analysis failed, retrying...\n");
        state = null;
      }

      // 2. Trigger new analysis if none exists
      if (!state) {
        if (!flags.json) {
          stderr.write("Starting root cause analysis...\n");
        }
        await triggerAutofix(org, numericId);
      }

      // 3. Poll until complete (if not already completed)
      if (!state || state.status !== "COMPLETED") {
        state = await pollAutofixState({
          orgSlug: org,
          issueId: numericId,
          stderr,
          json: flags.json,
          stopOnWaitingForUser: true,
        });
      }

      // 4. Extract root causes from steps
      const causes = extractRootCauses(state);
      if (causes.length === 0) {
        throw new Error(
          "Analysis completed but no root causes found. " +
            "The issue may not have enough context for root cause analysis."
        );
      }

      // 5. Output results
      if (flags.json) {
        writeJson(stdout, causes);
        return;
      }

      // Human-readable output
      const lines = formatRootCauseList(causes, issueId);
      stdout.write(`${lines.join("\n")}\n`);
    } catch (error) {
      // Handle API errors with friendly messages
      if (error instanceof ApiError) {
        throw new Error(formatAutofixError(error.status, error.detail));
      }
      throw error;
    }
  },
});
