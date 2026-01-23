/**
 * sentry issue plan
 *
 * Create a pull request with a plan for a Sentry issue using Seer AI.
 * Requires that 'sentry issue explain' has been run first.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import {
  getAutofixState,
  triggerSolutionPlanning,
} from "../../lib/api-client.js";
import { ApiError, ValidationError } from "../../lib/errors.js";
import {
  formatAutofixError,
  formatSolution,
} from "../../lib/formatters/autofix.js";
import { muted } from "../../lib/formatters/colors.js";
import { writeJson } from "../../lib/formatters/index.js";
import {
  type AutofixState,
  extractRootCauses,
  extractSolution,
  type RootCause,
} from "../../types/autofix.js";
import { pollAutofixState, resolveOrgAndIssueId } from "./utils.js";

type PlanFlags = {
  readonly org?: string;
  readonly cause?: number;
  readonly json: boolean;
};

/**
 * Validate that an autofix run exists and has completed root cause analysis.
 *
 * @param state - Current autofix state
 * @param issueId - Issue ID for error messages
 * @returns The validated state and root causes
 */
function validateAutofixState(
  state: AutofixState | null,
  issueId: string
): { state: AutofixState; causes: RootCause[] } {
  if (!state) {
    throw new ValidationError(
      `No root cause analysis found for issue ${issueId}.\n` +
        `Run 'sentry issue explain ${issueId}' first.`
    );
  }

  // Check if the autofix is in a state where we can continue
  const validStatuses = ["COMPLETED", "WAITING_FOR_USER_RESPONSE"];
  if (!validStatuses.includes(state.status)) {
    if (state.status === "PROCESSING") {
      throw new ValidationError(
        "Root cause analysis is still in progress. Please wait for it to complete."
      );
    }
    if (state.status === "ERROR") {
      throw new ValidationError(
        "Root cause analysis failed. Check the Sentry web UI for details."
      );
    }
    throw new ValidationError(
      `Cannot create plan: autofix is in '${state.status}' state.`
    );
  }

  const causes = extractRootCauses(state);
  if (causes.length === 0) {
    throw new ValidationError(
      "No root causes identified. Cannot create a plan without a root cause."
    );
  }

  return { state, causes };
}

/**
 * Validate the cause selection.
 */
function validateCauseSelection(
  causes: RootCause[],
  selectedCause: number | undefined,
  issueId: string
): number {
  // If only one cause and none specified, use it
  if (causes.length === 1 && selectedCause === undefined) {
    return 0;
  }

  // If multiple causes and none specified, error with list
  if (causes.length > 1 && selectedCause === undefined) {
    const lines = [
      "Multiple root causes found. Please specify one with --cause <id>:",
      "",
    ];
    for (let i = 0; i < causes.length; i++) {
      const cause = causes[i];
      if (cause) {
        lines.push(`  ${i}: ${cause.description.slice(0, 60)}...`);
      }
    }
    lines.push("");
    lines.push(`Example: sentry issue plan ${issueId} --cause 0`);
    throw new ValidationError(lines.join("\n"));
  }

  const causeId = selectedCause ?? 0;

  // Validate the cause ID is in range
  if (causeId < 0 || causeId >= causes.length) {
    throw new ValidationError(
      `Invalid cause ID: ${causeId}. Valid range is 0-${causes.length - 1}.`
    );
  }

  return causeId;
}

export const planCommand = buildCommand({
  docs: {
    brief: "Create a PR with a plan using Seer AI",
    fullDescription:
      "Create a pull request with a plan for a Sentry issue using Seer AI.\n\n" +
      "This command requires that 'sentry issue explain' has been run first " +
      "to identify the root cause. It will then generate code changes and " +
      "create a pull request with the plan.\n\n" +
      "If multiple root causes were identified, use --cause to specify which one.\n\n" +
      "Prerequisites:\n" +
      "  - GitHub integration configured for your organization\n" +
      "  - Code mappings set up for your project\n" +
      "  - Repository write access for the integration\n\n" +
      "Examples:\n" +
      "  sentry issue plan 123456789 --cause 0\n" +
      "  sentry issue plan MYPROJECT-ABC --org my-org --cause 1",
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
      cause: {
        kind: "parsed",
        parse: numberParser,
        brief: "Root cause ID to plan (required if multiple causes exist)",
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
    flags: PlanFlags,
    issueId: string
  ): Promise<void> {
    const { stdout, stderr, cwd } = this;

    try {
      // Resolve org and issue ID
      const { org, issueId: numericId } = await resolveOrgAndIssueId(
        issueId,
        flags.org,
        cwd,
        `sentry issue plan ${issueId} --org <org-slug>`
      );

      // Get current autofix state
      const currentState = await getAutofixState(org, numericId);

      // Validate we have a completed root cause analysis
      const { state, causes } = validateAutofixState(currentState, issueId);

      // Validate cause selection
      const causeId = validateCauseSelection(causes, flags.cause, issueId);
      const selectedCause = causes[causeId];

      if (!flags.json) {
        stderr.write(`Creating plan for cause #${causeId}...\n`);
        if (selectedCause) {
          stderr.write(`${muted(`"${selectedCause.description}"`)}\n\n`);
        }
      }

      // Trigger solution planning to continue to PR creation
      await triggerSolutionPlanning(org, numericId, state.run_id);

      // Poll until PR is created
      const finalState = await pollAutofixState({
        orgSlug: org,
        issueId: numericId,
        stderr,
        json: flags.json,
        timeoutMessage:
          "PR creation timed out after 10 minutes. Check the issue in Sentry web UI.",
      });

      // Handle errors
      if (finalState.status === "ERROR") {
        throw new Error(
          "Plan creation failed. Check the Sentry web UI for details."
        );
      }

      if (finalState.status === "CANCELLED") {
        throw new Error("Plan creation was cancelled.");
      }

      // Extract solution artifact
      const solution = extractSolution(finalState);

      // Output results
      if (flags.json) {
        writeJson(stdout, {
          run_id: finalState.run_id,
          status: finalState.status,
          solution: solution?.data ?? null,
        });
        return;
      }

      // Human-readable output
      if (solution) {
        const lines = formatSolution(solution);
        stdout.write(`${lines.join("\n")}\n`);
      } else {
        stderr.write(
          "No solution found. Check the Sentry web UI for details.\n"
        );
      }
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
