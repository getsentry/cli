/**
 * sentry issue explain
 *
 * Trigger Seer root cause analysis for a Sentry issue.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import {
  getAutofixState,
  getIssueByShortId,
  isShortId,
  triggerAutofix,
} from "../../lib/api-client.js";
import { ApiError, ContextError } from "../../lib/errors.js";
import {
  formatAutofixError,
  formatProgressLine,
  formatRootCauseList,
  getProgressMessage,
} from "../../lib/formatters/autofix.js";
import { writeJson } from "../../lib/formatters/index.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { extractRootCauses, isTerminalStatus } from "../../types/autofix.js";
import type { Writer } from "../../types/index.js";

/** Polling interval in milliseconds */
const POLL_INTERVAL_MS = 3000;

/** Maximum time to wait for completion in milliseconds (10 minutes) */
const TIMEOUT_MS = 600_000;

type ExplainFlags = {
  readonly org?: string;
  readonly event?: string;
  readonly instruction?: string;
  readonly json: boolean;
};

/**
 * Resolve the numeric issue ID from either a numeric ID or short ID.
 *
 * @param issueId - User-provided issue ID (numeric or short)
 * @param org - Optional org slug for short ID resolution
 * @param cwd - Current working directory
 * @returns Numeric issue ID
 */
async function resolveIssueId(
  issueId: string,
  org: string | undefined,
  cwd: string
): Promise<string> {
  if (!isShortId(issueId)) {
    return issueId;
  }

  // Short ID requires organization context
  const resolved = await resolveOrg({ org, cwd });
  if (!resolved) {
    throw new ContextError(
      "Organization",
      `sentry issue explain ${issueId} --org <org-slug>`
    );
  }

  const issue = await getIssueByShortId(resolved.org, issueId);
  return issue.id;
}

/**
 * Poll for autofix completion with progress display.
 *
 * @param issueId - Numeric issue ID
 * @param stdout - Output writer
 * @param stderr - Error writer
 * @param json - Whether to suppress progress output (for JSON mode)
 */
async function pollUntilComplete(
  issueId: string,
  _stdout: Writer,
  stderr: Writer,
  json: boolean
): Promise<ReturnType<typeof getAutofixState>> {
  const startTime = Date.now();
  let tick = 0;
  let lastMessage = "";

  while (Date.now() - startTime < TIMEOUT_MS) {
    const state = await getAutofixState(issueId);

    if (!state) {
      // No autofix state yet, keep waiting
      await Bun.sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Show progress if not in JSON mode
    if (!json) {
      const message = getProgressMessage(state);
      if (message !== lastMessage) {
        // Clear current line and write new progress
        stderr.write(`\r\x1b[K${formatProgressLine(message, tick)}`);
        lastMessage = message;
      } else {
        // Update spinner
        stderr.write(`\r\x1b[K${formatProgressLine(message, tick)}`);
      }
      tick += 1;
    }

    // Check if we're done
    if (isTerminalStatus(state.status)) {
      if (!json) {
        stderr.write("\n");
      }
      return state;
    }

    // Also check for WAITING_FOR_USER_RESPONSE which means root cause is ready
    if (state.status === "WAITING_FOR_USER_RESPONSE") {
      if (!json) {
        stderr.write("\n");
      }
      return state;
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    "Analysis timed out after 10 minutes. Check the issue in Sentry web UI."
  );
}

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
      const numericId = await resolveIssueId(issueId, flags.org, cwd);

      if (!flags.json) {
        stderr.write(`Analyzing issue ${issueId}...\n`);
      }

      // Trigger the autofix with root_cause stopping point
      await triggerAutofix(numericId, {
        stoppingPoint: "root_cause",
        eventId: flags.event,
        instruction: flags.instruction,
      });

      // Poll until complete
      const finalState = await pollUntilComplete(
        numericId,
        stdout,
        stderr,
        flags.json
      );

      if (!finalState) {
        throw new Error("No autofix state returned.");
      }

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
