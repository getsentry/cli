/**
 * Feedback Command
 *
 * Allows users to submit feedback about the CLI.
 * All arguments after 'feedback' are joined into a single message.
 *
 * @example sentry cli feedback i love this tool
 * @example sentry cli feedback the issue view is confusing
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { ValidationError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

const log = logger.withTag("cli.feedback");

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
    const message = messageParts.join(" ");

    if (!message.trim()) {
      throw new ValidationError("Please provide a feedback message.");
    }

    if (!Sentry.isEnabled()) {
      log.warn("Feedback not sent: telemetry is disabled.");
      log.warn("Unset SENTRY_CLI_NO_TELEMETRY to enable feedback.");
      return;
    }

    Sentry.captureFeedback({ message });

    // Flush to ensure feedback is sent before process exits
    const sent = await Sentry.flush(3000);

    if (sent) {
      log.success("Feedback submitted. Thank you!");
    } else {
      log.warn("Feedback may not have been sent (network timeout).");
    }
  },
});
