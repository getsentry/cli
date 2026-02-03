/**
 * sentry issue explain
 *
 * Get root cause analysis for a Sentry issue using Seer AI.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import {
  getAutofixState,
  triggerRootCauseAnalysis,
} from "../../lib/api-client.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import { formatRootCauseList } from "../../lib/formatters/seer.js";
import { trackSeerOutcome } from "../../lib/telemetry.js";
import { extractRootCauses } from "../../types/seer.js";
import {
  buildCommandHint,
  handleSeerCommandError,
  type IssueIdFlags,
  issueIdFlags,
  issueIdPositional,
  pollAutofixState,
  resolveOrgAndIssueId,
} from "./utils.js";

interface ExplainFlags extends IssueIdFlags {
  readonly json: boolean;
  readonly force: boolean;
}

export const explainCommand = buildCommand({
  docs: {
    brief: "Analyze an issue's root cause using Seer AI",
    fullDescription:
      "Get a root cause analysis for a Sentry issue using Seer AI.\n\n" +
      "This command analyzes the issue and provides:\n" +
      "  - Identified root causes\n" +
      "  - Reproduction steps\n" +
      "  - Relevant code locations\n\n" +
      "The analysis may take a few minutes for new issues.\n" +
      "Use --force to trigger a fresh analysis even if one already exists.\n\n" +
      "Examples:\n" +
      "  sentry issue explain 123456789\n" +
      "  sentry issue explain MYPROJECT-ABC --org my-org\n" +
      "  sentry issue explain G --org my-org --project my-project\n" +
      "  sentry issue explain 123456789 --json\n" +
      "  sentry issue explain 123456789 --force",
  },
  parameters: {
    positional: issueIdPositional,
    flags: {
      ...issueIdFlags,
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      force: {
        kind: "boolean",
        brief: "Force new analysis even if one exists",
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

    // Declare org outside try block so it's accessible in catch for error messages
    let resolvedOrg: string | undefined;

    try {
      // Resolve org and issue ID
      const { org, issueId: numericId } = await resolveOrgAndIssueId({
        issueId,
        org: flags.org,
        project: flags.project,
        cwd,
        commandHint: buildCommandHint("explain", issueId),
      });
      resolvedOrg = org;

      // 1. Check for existing analysis (skip if --force)
      let state = flags.force ? null : await getAutofixState(org, numericId);

      // Handle error status, we are gonna retry the analysis
      if (state?.status === "ERROR") {
        stderr.write("Root cause analysis failed, retrying...\n");
        state = null;
      }

      // 2. Trigger new analysis if none exists or forced
      if (!state) {
        if (!flags.json) {
          const prefix = flags.force ? "Forcing fresh" : "Starting";
          stderr.write(
            `${prefix} root cause analysis, it can take several minutes...\n`
          );
        }
        await triggerRootCauseAnalysis(org, numericId);
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
        trackSeerOutcome("explain", "no_solution");
        throw new Error(
          "Analysis completed but no root causes found. " +
            "The issue may not have enough context for root cause analysis."
        );
      }

      // Track successful outcome
      trackSeerOutcome("explain", "success");

      // 5. Output results
      if (flags.json) {
        writeJson(stdout, causes);
        return;
      }

      // Human-readable output
      const lines = formatRootCauseList(causes);
      stdout.write(`${lines.join("\n")}\n`);
      writeFooter(
        stdout,
        `To create a plan, run: sentry issue plan ${issueId}`
      );
    } catch (error) {
      throw handleSeerCommandError(error, "explain", resolvedOrg);
    }
  },
});
