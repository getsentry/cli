/**
 * sentry issue explain
 *
 * Get root cause analysis for a Sentry issue using Seer AI.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { ApiError } from "../../lib/errors.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import {
  formatRootCauseList,
  handleSeerApiError,
} from "../../lib/formatters/seer.js";
import { extractRootCauses } from "../../types/seer.js";
import {
  ensureRootCauseAnalysis,
  issueIdPositional,
  resolveOrgAndIssueId,
} from "./utils.js";

type ExplainFlags = {
  readonly json: boolean;
  readonly force: boolean;
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
      "The analysis may take a few minutes for new issues.\n" +
      "Use --force to trigger a fresh analysis even if one already exists.\n\n" +
      "Issue formats:\n" +
      "  <org>/ID       - Explicit org: sentry/EXTENSION-7, sentry/cli-G\n" +
      "  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y\n" +
      "  ID             - Short ID: CLI-G (searches across orgs)\n" +
      "  suffix         - Suffix only: G (requires DSN context)\n" +
      "  numeric        - Numeric ID: 123456789\n\n" +
      "Examples:\n" +
      "  sentry issue explain 123456789\n" +
      "  sentry issue explain sentry/EXTENSION-7\n" +
      "  sentry issue explain cli-G\n" +
      "  sentry issue explain 123456789 --json\n" +
      "  sentry issue explain 123456789 --force",
  },
  parameters: {
    positional: issueIdPositional,
    flags: {
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
        command: "explain",
      });
      resolvedOrg = org;

      // Ensure root cause analysis exists (triggers if needed)
      const state = await ensureRootCauseAnalysis({
        org,
        issueId: numericId,
        stderr,
        json: flags.json,
        force: flags.force,
      });

      // Extract root causes from steps
      const causes = extractRootCauses(state);
      if (causes.length === 0) {
        throw new Error(
          "Analysis completed but no root causes found. " +
            "The issue may not have enough context for root cause analysis."
        );
      }

      // Output results
      if (flags.json) {
        writeJson(stdout, causes);
        return;
      }

      // Human-readable output
      stdout.write(`${formatRootCauseList(causes)}\n`);
      writeFooter(
        stdout,
        `To create a plan, run: sentry issue plan ${issueArg}`
      );
    } catch (error) {
      // Handle API errors with friendly messages
      if (error instanceof ApiError) {
        throw handleSeerApiError(error.status, error.detail, resolvedOrg);
      }
      throw error;
    }
  },
});
