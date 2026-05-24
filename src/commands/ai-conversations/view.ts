/**
 * sentry ai-conversations view
 *
 * View the transcript of a specific AI conversation.
 */

import type { SentryContext } from "../../context.js";
import { getConversationSpans } from "../../lib/api/ai-conversations.js";
import { buildCommand } from "../../lib/command.js";
import {
  buildTranscriptResult,
  formatTranscript,
  type TranscriptResult,
} from "../../lib/formatters/ai-conversations.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { withProgress } from "../../lib/polling.js";
import { resolveOrg } from "../../lib/resolve-target.js";

type ViewFlags = {
  readonly json: boolean;
  readonly fresh: boolean;
};

function formatViewHuman(result: TranscriptResult): string {
  if (result.spanCount === 0) {
    return `No spans found for conversation ${result.conversationId} in the last 30 days.`;
  }

  const lines: string[] = [];
  lines.push(`AI Conversation: ${result.conversationId}`);
  lines.push("");
  lines.push(`  Org:      ${result.org}`);
  lines.push(`  Projects: ${result.projects.join(", ") || "—"}`);
  lines.push(
    `  Started:  ${new Date(result.startTimestamp * 1000).toISOString()}`,
  );
  lines.push(
    `  Ended:    ${new Date(result.endTimestamp * 1000).toISOString()}`,
  );
  lines.push(`  Turns:    ${result.turns.length}`);
  lines.push(`  Spans:    ${result.spanCount}`);
  lines.push(`  Tokens:   ${result.totalTokens}`);
  lines.push("");

  for (const turn of result.turns) {
    const meta = [
      turn.model,
      turn.agentName,
      turn.totalTokens > 0 ? `${turn.totalTokens} tokens` : null,
      turn.durationMs < 1000
        ? `${turn.durationMs}ms`
        : `${(turn.durationMs / 1000).toFixed(1)}s`,
    ]
      .filter(Boolean)
      .join(" | ");

    lines.push(
      `── Turn ${turn.turn} — ${new Date(turn.started * 1000).toISOString()}`,
    );
    if (meta) lines.push(`   ${meta}`);
    lines.push("");

    if (turn.userContent) {
      lines.push("   [user]");
      const content =
        turn.userContent.length > 600
          ? `${turn.userContent.slice(0, 599)}…`
          : turn.userContent;
      for (const line of content.split("\n")) {
        lines.push(`   ${line}`);
      }
      lines.push("");
    }

    if (turn.assistantContent) {
      lines.push("   [assistant]");
      const content =
        turn.assistantContent.length > 600
          ? `${turn.assistantContent.slice(0, 599)}…`
          : turn.assistantContent;
      for (const line of content.split("\n")) {
        lines.push(`   ${line}`);
      }
      lines.push("");
    }

    if (turn.toolCalls.length > 0) {
      lines.push("   [tools]");
      for (const tc of turn.toolCalls) {
        const dur =
          tc.durationMs < 1000
            ? `${tc.durationMs}ms`
            : `${(tc.durationMs / 1000).toFixed(1)}s`;
        const status =
          tc.status && tc.status !== "ok" ? ` (${tc.status})` : "";
        lines.push(`   • ${tc.name} — ${dur}${status}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View an AI conversation transcript",
    fullDescription:
      "View the full transcript of an AI conversation.\n\n" +
      "Examples:\n" +
      "  sentry ai-conversations view my-org conv-123\n" +
      "  sentry ai-conversations view my-org conv-123 --json\n",
  },
  output: {
    human: formatViewHuman,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org",
          brief: "Organization slug",
          parse: String,
        },
        {
          placeholder: "conversation-id",
          brief: "AI conversation ID",
          parse: String,
        },
      ],
    },
    flags: {
      fresh: FRESH_FLAG,
    },
    aliases: FRESH_ALIASES,
  },
  async *func(
    this: SentryContext,
    flags: ViewFlags,
    org: string,
    conversationId: string,
  ) {
    applyFreshFlag(flags);

    const spans = await withProgress(
      {
        message: "Fetching conversation spans...",
        json: flags.json,
      },
      () => getConversationSpans(org, conversationId),
    );

    const result = buildTranscriptResult(conversationId, org, spans);
    yield new CommandOutput<TranscriptResult>(result);
  },
});
