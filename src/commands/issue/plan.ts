/**
 * sentry issue plan
 *
 * Generate a solution plan for a Sentry issue using Seer AI.
 * Automatically runs root cause analysis if not already done.
 */

import type { SentryContext } from "../../context.js";
import { triggerSolutionPlanning } from "../../lib/api-client.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { ApiError, ValidationError } from "../../lib/errors.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  formatSolution,
  handleSeerApiError,
} from "../../lib/formatters/seer.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import { classifySeerError, recordSeerOutcome } from "../../lib/telemetry.js";
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
  readonly fresh: boolean;
  readonly fields?: string[];
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

/** Return type for issue plan — includes state metadata and solution data */
type PlanData = {
  run_id: number;
  status: string;
  /** The solution data (without the artifact wrapper). Null when no solution is available. */
  solution: SolutionArtifact["data"] | null;
};

/**
 * Format solution plan data for human-readable terminal output.
 *
 * Returns the formatted solution or a "no solution" message.
 */
function formatPlanOutput(data: PlanData): string {
  if (data.solution) {
    return formatSolution({ key: "solution", data: data.solution });
  }
  return "No solution found. Check the Sentry web UI for details.";
}

/**
 * Build the plan data object from autofix state.
 *
 * Stores `solution.data` (not the full artifact) to keep the JSON shape flat —
 * consumers get `{ run_id, status, solution: { one_line_summary, steps, ... } }`.
 */
function buildPlanData(state: AutofixState): PlanData {
  const solution = extractSolution(state);
  return {
    run_id: state.run_id,
    status: state.status,
    solution: solution?.data ?? null,
  };
}

/**
 * Handle errors in Seer commands with outcome recording.
 *
 * Records the Seer outcome if not already recorded, maps API errors to
 * Seer-specific errors, and re-throws. Extracted from the catch block to
 * keep command function complexity under the Biome limit.
 *
 * @param error - The caught error
 * @param recorded - Whether outcome was already recorded before the error
 * @param resolvedOrg - Org slug for Seer error messages
 * @returns never — always throws
 */
function handleSeerCommandError(
  error: unknown,
  recorded: boolean,
  resolvedOrg: string | undefined
): never {
  if (!recorded) {
    if (error instanceof ApiError) {
      const mapped = handleSeerApiError(
        error.status,
        error.detail,
        resolvedOrg
      );
      recordSeerOutcome(classifySeerError(mapped));
      throw mapped;
    }
    recordSeerOutcome(classifySeerError(error));
  } else if (error instanceof ApiError) {
    throw handleSeerApiError(error.status, error.detail, resolvedOrg);
  }
  throw error;
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
      "  @latest          - Most recent unresolved issue\n" +
      "  @most_frequent   - Issue with highest event frequency\n" +
      "  <org>/ID         - Explicit org: sentry/EXTENSION-7, sentry/cli-G\n" +
      "  <org>/@selector  - Selector with org: my-org/@latest\n" +
      "  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y\n" +
      "  ID               - Short ID: CLI-G (searches across orgs)\n" +
      "  suffix           - Suffix only: G (requires DSN context)\n" +
      "  numeric          - Numeric ID: 123456789\n\n" +
      "Prerequisites:\n" +
      "  - GitHub integration configured for your organization\n" +
      "  - Code mappings set up for your project\n\n" +
      "Examples:\n" +
      "  sentry issue plan @latest --cause 0\n" +
      "  sentry issue plan 123456789 --cause 0\n" +
      "  sentry issue plan sentry/EXTENSION-7 --cause 1\n" +
      "  sentry issue plan cli-G --cause 0\n" +
      "  sentry issue plan 123456789 --force",
  },
  output: {
    human: formatPlanOutput,
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
      force: {
        kind: "boolean",
        brief: "Force new plan even if one exists",
        default: false,
      },
      fresh: FRESH_FLAG,
    },
    aliases: FRESH_ALIASES,
  },
  async *func(this: SentryContext, flags: PlanFlags, issueArg: string) {
    applyFreshFlag(flags);
    const { cwd } = this;

    let resolvedOrg: string | undefined;
    let recorded = false;

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
          yield new CommandOutput(buildPlanData(state));
          recorded = true;
          recordSeerOutcome("success");
          return;
        }
      }

      // No solution exists, trigger planning
      if (!flags.json) {
        const log = logger.withTag("issue.plan");
        log.info(`Creating plan for cause #${causeId}...`);
        if (selectedCause) {
          log.info(`"${selectedCause.description}"`);
        }
      }

      await triggerSolutionPlanning(org, numericId, state.run_id);

      // Poll until plan is created
      const finalState = await pollAutofixState({
        orgSlug: org,
        issueId: numericId,
        json: flags.json,
        timeoutMessage:
          "Plan creation timed out after 6 minutes. Try again or check the issue in Sentry web UI.",
        timeoutHint:
          "The plan may still be generated in the background.\n" +
          `  Or retry: sentry issue plan ${issueArg}`,
      });

      // Handle terminal error states
      if (finalState.status === "ERROR") {
        recorded = true;
        recordSeerOutcome("error");
        throw new Error(
          "Plan creation failed. Check the Sentry web UI for details."
        );
      }

      if (finalState.status === "CANCELLED") {
        recorded = true;
        recordSeerOutcome("error");
        throw new Error("Plan creation was cancelled.");
      }

      const planData = buildPlanData(finalState);
      yield new CommandOutput(planData);
      recorded = true;
      recordSeerOutcome(planData.solution ? "success" : "no_solution");
      return;
    } catch (error) {
      handleSeerCommandError(error, recorded, resolvedOrg);
    }
  },
});
