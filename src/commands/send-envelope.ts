/**
 * sentry send-envelope
 *
 * Send a raw envelope to Sentry.
 * Wraps: sentry-cli send-envelope
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../context.js";
import { runSentryCli } from "../lib/sentry-cli-runner.js";

export const sendEnvelopeCommand = buildCommand({
  docs: {
    brief: "Send an envelope to Sentry",
    fullDescription:
      "Send a raw envelope to Sentry from the command line.\n\n" +
      "Wraps: sentry-cli send-envelope\n\n" +
      "Examples:\n" +
      "  sentry send-envelope ./path/to/envelope",
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
    await runSentryCli(["send-envelope", ...args]);
  },
});
