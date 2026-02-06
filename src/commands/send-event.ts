/**
 * sentry send-event
 *
 * Send an event to Sentry.
 * Wraps: sentry-cli send-event
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../context.js";
import { runSentryCli } from "../lib/sentry-cli-runner.js";

export const sendEventCommand = buildCommand({
  docs: {
    brief: "Send an event to Sentry",
    fullDescription:
      "Send an event to Sentry from the command line.\n\n" +
      "Wraps: sentry-cli send-event\n\n" +
      "Examples:\n" +
      "  sentry send-event -m 'Something happened'\n" +
      "  sentry send-event -m 'Error' --level error\n" +
      "  sentry send-event -m 'Tagged event' --tag key:value",
  },
  parameters: {
    flags: {},
    positional: {
      kind: "array",
      parameter: {
        brief: "Arguments to pass to sentry-cli",
        parse: String,
        placeholder: "args",
      },
    },
  },
  async func(
    this: SentryContext,
    _flags: Record<string, never>,
    ...args: string[]
  ): Promise<void> {
    await runSentryCli(["send-event", ...args]);
  },
});
