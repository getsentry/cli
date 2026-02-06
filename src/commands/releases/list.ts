/**
 * sentry releases list
 *
 * List releases in Sentry.
 * Wraps: sentry-cli releases list
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const listCommand = buildCommand({
  docs: {
    brief: "List releases",
    fullDescription:
      "List releases in Sentry.\n\n" +
      "Wraps: sentry-cli releases list\n\n" +
      "Examples:\n" +
      "  sentry releases list\n" +
      "  sentry releases list --org my-org --project my-project",
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
    await runSentryCli(["releases", "list", ...args]);
  },
});
