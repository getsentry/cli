/**
 * Feedback Command
 *
 * Allows users to submit feedback about the CLI.
 * All arguments after 'feedback' are joined into a single message.
 *
 * @example sentry feedback i love this tool
 * @example sentry feedback the issue view is confusing
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../context.js";

export const feedbackCommand = buildCommand({
  docs: {
    brief: "Send feedback about the CLI",
    fullDescription:
      "Submit feedback about your experience with the Sentry CLI. " +
      "All text after 'feedback' is sent as your message.",
  },
  parameters: {
    flags: {},
    positional: {
      kind: "array",
      parameter: {
        brief: "Your feedback message",
        parse: String,
        placeholder: "message",
      },
    },
  },
  // biome-ignore lint/complexity/noBannedTypes: Stricli requires empty object for commands with no flags
  async func(this: SentryContext, _flags: {}, ...messageParts: string[]) {
    const { stdout, stderr } = this;
    const message = messageParts.join(" ");

    if (!message.trim()) {
      stderr.write("Please provide a feedback message.\n");
      stderr.write("Usage: sentry feedback <message>\n");
      return;
    }

    Sentry.captureFeedback({ message });

    // Flush to ensure feedback is sent before process exits
    await Sentry.flush(3000);

    stdout.write("Feedback submitted. Thank you!\n");
  },
});
