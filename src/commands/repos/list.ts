/**
 * sentry repos list
 *
 * List repositories in Sentry.
 * Wraps: sentry-cli repos list
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const listCommand = buildCommand({
  docs: {
    brief: "List repositories",
    fullDescription:
      "List repositories configured in Sentry.\n\n" +
      "Wraps: sentry-cli repos list\n\n" +
      "Examples:\n" +
      "  sentry repos list\n" +
      "  sentry repos list --org my-org",
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
    await runSentryCli(["repos", "list", ...args]);
  },
});
