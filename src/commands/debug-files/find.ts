/**
 * sentry debug-files find
 *
 * Find debug information files.
 * Wraps: sentry-cli debug-files find
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const findCommand = buildCommand({
  docs: {
    brief: "Find debug information files",
    fullDescription:
      "Find debug information files in the given path.\n\n" +
      "Wraps: sentry-cli debug-files find\n\n" +
      "Examples:\n" +
      "  sentry debug-files find ./path/to/search",
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
    await runSentryCli(["debug-files", "find", ...args]);
  },
});
