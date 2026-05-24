/**
 * sentry conversation view
 *
 * View the transcript of a specific AI conversation.
 */

import type { SentryContext } from "../../context.js";
import { getConversationSpans } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import {
  buildTranscriptResult,
  formatTranscriptResult,
  type TranscriptResult,
} from "../../lib/formatters/conversation.js";
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

export const viewCommand = buildCommand({
  docs: {
    brief: "View an AI conversation transcript",
    fullDescription:
      "View the full transcript of an AI conversation.\n\n" +
      "Examples:\n" +
      "  sentry conversation view my-org conv-123\n" +
      "  sentry conversation view my-org conv-123 --json\n",
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
          brief: "Organization slug (optional if auto-detected)",
          parse: String,
          optional: true,
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
    orgOrConversationId: string,
    maybeConversationId?: string
  ) {
    applyFreshFlag(flags);
    const { cwd } = this;

    let org: string;
    let conversationId: string;

    if (maybeConversationId) {
      org = orgOrConversationId;
      conversationId = maybeConversationId;
    } else if (orgOrConversationId) {
      const resolved = await resolveOrg({ cwd });
      if (!resolved) {
        throw new ContextError(
          "Organization",
          "sentry conversation view <org> <conversation-id>"
        );
      }
      org = resolved.org;
      conversationId = orgOrConversationId;
    } else {
      throw new Error(
        "Missing conversation ID. Usage: sentry conversation view [org] <conversation-id>"
      );
    }

    const { spans, truncated } = await withProgress(
      {
        message: "Fetching conversation spans...",
        json: flags.json,
      },
      () => getConversationSpans(org, conversationId)
    );

    const result = buildTranscriptResult(conversationId, org, spans);
    result.truncated = truncated;
    yield new CommandOutput<TranscriptResult>(result);
  },
});
