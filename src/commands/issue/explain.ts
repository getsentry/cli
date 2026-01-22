/**
 * sentry issue explain
 *
 * Trigger Seer root cause analysis for a Sentry issue.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { triggerAutofix } from "../../lib/api-client.js";
import { ApiError } from "../../lib/errors.js";
import {
  formatAutofixError,
  formatRootCauseList,
} from "../../lib/formatters/autofix.js";
import { writeJson } from "../../lib/formatters/index.js";
import { extractRootCauses } from "../../types/autofix.js";
import { pollAutofixState, resolveIssueId } from "./utils.js";

type ExplainFlags = {
  readonly org?: string;
  readonly event?: string;
  readonly instruction?: string;
  readonly json: boolean;
};

export const explainCommand = buildCommand({
  docs: {
    brief: "Analyze an issue using Seer AI",
    fullDescription:
      "Trigger Seer's AI-powered root cause analysis for a Sentry issue.\n\n" +
      "This command starts an analysis that identifies the root cause of the issue " +
      "and shows reproduction steps. Once complete, you can use 'sentry issue fix' " +
      "to create a pull request with the fix.\n\n" +
      "Examples:\n" +
      "  sentry issue explain 123456789\n" +
      "  sentry issue explain MYPROJECT-ABC --org my-org\n" +
      "  sentry issue explain 123456789 --instruction 'Focus on the database query'",
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
      event: {
        kind: "parsed",
        parse: String,
        brief:
          "Specific event ID to analyze (uses recommended event if not provided)",
        optional: true,
      },
      instruction: {
        kind: "parsed",
        parse: String,
        brief: "Custom instruction to guide the analysis",
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
      // Resolve the numeric issue ID
      const numericId = await resolveIssueId(
        issueId,
        flags.org,
        cwd,
        `sentry issue explain ${issueId} --org <org-slug>`
      );

      if (!flags.json) {
        stderr.write(`Analyzing issue ${issueId}...\n`);
      }

      // Trigger the autofix with root_cause stopping point
      await triggerAutofix(numericId, {
        stoppingPoint: "root_cause",
        eventId: flags.event,
        instruction: flags.instruction,
      });

      // Poll until complete (stop when root cause is ready)
      const finalState = await pollAutofixState(numericId, stderr, flags.json, {
        stopOnWaitingForUser: true,
        timeoutMessage:
          "Analysis timed out after 10 minutes. Check the issue in Sentry web UI.",
      });

      // Handle errors
      if (finalState.status === "ERROR") {
        throw new Error(
          "Root cause analysis failed. Check the Sentry web UI for details."
        );
      }

      if (finalState.status === "CANCELLED") {
        throw new Error("Root cause analysis was cancelled.");
      }

      // Extract root causes
      const rootCauses = extractRootCauses(finalState);

      // Output results
      if (flags.json) {
        writeJson(stdout, {
          run_id: finalState.run_id,
          status: finalState.status,
          causes: rootCauses,
        });
        return;
      }

      // Human-readable output
      const lines = formatRootCauseList(rootCauses, issueId);
      stdout.write(`${lines.join("\n")}\n`);
    } catch (error) {
      // Handle API errors with friendly messages
      if (error instanceof ApiError) {
        const message = formatAutofixError(error.status, error.detail);
        throw new Error(message);
      }
      throw error;
    }
  },
});
