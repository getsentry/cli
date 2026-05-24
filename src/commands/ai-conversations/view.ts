/**
 * sentry ai-conversations view
 *
 * View the transcript of a specific AI conversation.
 */

import type { SentryContext } from "../../context.js";
import { getConversationSpans } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import {
  buildTranscriptResult,
  formatTranscriptResult,
  type TranscriptResult,
} from "../../lib/formatters/ai-conversations.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { withProgress } from "../../lib/polling.js";

type ViewFlags = {
  readonly json: boolean;
  readonly fresh: boolean;
};

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
    human: formatTranscriptResult,
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
    conversationId: string
  ) {
    applyFreshFlag(flags);

    const spans = await withProgress(
      {
        message: "Fetching conversation spans...",
        json: flags.json,
      },
      () => getConversationSpans(org, conversationId)
    );

    const result = buildTranscriptResult(conversationId, org, spans);
    yield new CommandOutput<TranscriptResult>(result);
  },
});
