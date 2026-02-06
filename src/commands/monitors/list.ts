/**
 * sentry monitors list
 *
 * List cron monitors in Sentry.
 * Wraps: sentry-cli monitors list
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const listCommand = buildCommand({
  docs: {
    brief: "List cron monitors",
    fullDescription:
      "List cron monitors in Sentry.\n\n" +
      "Wraps: sentry-cli monitors list\n\n" +
      "Examples:\n" +
      "  sentry monitors list",
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
    await runSentryCli(["monitors", "list", ...args]);
  },
});
