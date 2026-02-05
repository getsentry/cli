/**
 * sentry issue plan
 *
 * Generate a solution plan for a Sentry issue using Seer AI.
 * Automatically runs root cause analysis if not already done.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { triggerSolutionPlanning } from "../../lib/api-client.js";
import { ApiError, ValidationError } from "../../lib/errors.js";
import { muted } from "../../lib/formatters/colors.js";
import { writeJson } from "../../lib/formatters/index.js";
import {
  formatSolution,
  handleSeerApiError,
} from "../../lib/formatters/seer.js";
import type { Writer } from "../../types/index.js";
import {
  type AutofixState,
  extractRootCauses,
  extractSolution,
  type RootCause,
  type SolutionArtifact,
} from "../../types/seer.js";
import {
  ensureRootCauseAnalysis,
  issueIdPositional,
  pollAutofixState,
  resolveOrgAndIssueId,
} from "./utils.js";

type PlanFlags = {
  readonly cause?: number;
  readonly json: boolean;
  readonly force: boolean;
};

/**
 * Validate that the autofix state has root causes identified.
 *
 * @param state - Current autofix state (already ensured to exist)
 * @returns Array of root causes
 * @throws {ValidationError} If no root causes found
 */
function validateRootCauses(state: AutofixState): RootCause[] {
  const causes = extractRootCauses(state);
  if (causes.length === 0) {
    throw new ValidationError(
      "No root causes identified. Cannot create a plan without a root cause."
    );
  }
  return causes;
}

/**
 * Validate and resolve the cause selection for solution planning.
 *
 * @param causes - Array of available root causes
 * @param selectedCause - User-specified cause index, or undefined for auto-select
 * @param issueId - Issue ID for error message hints
 * @returns Validated cause index (0-based)
 * @throws {ValidationError} If multiple causes exist without selection, or if selection is out of range
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

type OutputSolutionOptions = {
  stdout: Writer;
  stderr: Writer;
  solution: SolutionArtifact | null;
  state: AutofixState;
  json: boolean;
};

/**
 * Output a solution artifact to stdout.
 */
function outputSolution(options: OutputSolutionOptions): void {
  const { stdout, stderr, solution, state, json } = options;

  if (json) {
    writeJson(stdout, {
      run_id: state.run_id,
      status: state.status,
      solution: solution?.data ?? null,
    });
    return;
  }

  if (solution) {
    const lines = formatSolution(solution);
    stdout.write(`${lines.join("\n")}\n`);
  } else {
    stderr.write("No solution found. Check the Sentry web UI for details.\n");
  }
}

export const planCommand = buildCommand({
  docs: {
    brief: "Generate a solution plan using Seer AI",
    fullDescription:
      "Generate a solution plan for a Sentry issue using Seer AI.\n\n" +
      "This command automatically runs root cause analysis if needed, then " +
      "generates a solution plan with specific implementation steps to fix the issue.\n\n" +
      "If multiple root causes are identified, use --cause to specify which one.\n" +
      "Use --force to regenerate a plan even if one already exists.\n\n" +
      "Issue formats:\n" +
      "  <org>/ID       - Explicit org: sentry/EXTENSION-7, sentry/cli-G\n" +
      "  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y\n" +
      "  ID             - Short ID: CLI-G (searches across orgs)\n" +
      "  suffix         - Suffix only: G (requires DSN context)\n" +
      "  numeric        - Numeric ID: 123456789\n\n" +
      "Prerequisites:\n" +
      "  - GitHub integration configured for your organization\n" +
      "  - Code mappings set up for your project\n\n" +
      "Examples:\n" +
      "  sentry issue plan 123456789 --cause 0\n" +
      "  sentry issue plan sentry/EXTENSION-7 --cause 1\n" +
      "  sentry issue plan cli-G --cause 0\n" +
      "  sentry issue plan 123456789 --force",
  },
  parameters: {
    positional: issueIdPositional,
    flags: {
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
      force: {
        kind: "boolean",
        brief: "Force new plan even if one exists",
        default: false,
      },
    },
  },
  async func(
    this: SentryContext,
    flags: PlanFlags,
    issueArg: string
  ): Promise<void> {
    const { stdout, stderr, cwd } = this;

    // Declare org outside try block so it's accessible in catch for error messages
    let resolvedOrg: string | undefined;

    try {
      // Resolve org and issue ID
      const { org, issueId: numericId } = await resolveOrgAndIssueId({
        issueArg,
        cwd,
        command: "plan",
      });
      resolvedOrg = org;

      // Ensure root cause analysis exists (runs explain if needed)
      const state = await ensureRootCauseAnalysis({
        org,
        issueId: numericId,
        stderr,
        json: flags.json,
      });

      // Validate we have root causes
      const causes = validateRootCauses(state);

      // Validate cause selection
      const causeId = validateCauseSelection(causes, flags.cause, issueArg);
      const selectedCause = causes[causeId];

      // Check if solution already exists (skip if --force)
      if (!flags.force) {
        const existingSolution = extractSolution(state);
        if (existingSolution) {
          outputSolution({
            stdout,
            stderr,
            solution: existingSolution,
            state,
            json: flags.json,
          });
          return;
        }
      }

      // No solution exists, trigger planning
      if (!flags.json) {
        stderr.write(`Creating plan for cause #${causeId}...\n`);
        if (selectedCause) {
          stderr.write(`${muted(`"${selectedCause.description}"`)}\n\n`);
        }
      }

      await triggerSolutionPlanning(org, numericId, state.run_id);

      // Poll until PR is created
      const finalState = await pollAutofixState({
        orgSlug: org,
        issueId: numericId,
        stderr,
        json: flags.json,
        timeoutMessage:
          "Plan creation timed out after 3 minutes. Try again or check the issue in Sentry web UI.",
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

      // Extract and output solution
      const solution = extractSolution(finalState);
      outputSolution({
        stdout,
        stderr,
        solution,
        state: finalState,
        json: flags.json,
      });
    } catch (error) {
      // Handle API errors with friendly messages
      if (error instanceof ApiError) {
        throw handleSeerApiError(error.status, error.detail, resolvedOrg);
      }
      throw error;
    }
  },
});
