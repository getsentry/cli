/**
 * sentry releases finalize
 *
 * Finalize a release in Sentry.
 * Wraps: sentry-cli releases finalize
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const finalizeCommand = buildCommand({
  docs: {
    brief: "Finalize a release",
    fullDescription:
      "Finalize a release in Sentry.\n\n" +
      "Wraps: sentry-cli releases finalize\n\n" +
      "Examples:\n" +
      "  sentry releases finalize 1.0.0",
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
    await runSentryCli(["releases", "finalize", ...args]);
  },
});
