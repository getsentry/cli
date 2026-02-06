/**
 * sentry debug-files check
 *
 * Check debug information files for issues.
 * Wraps: sentry-cli debug-files check
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const checkCommand = buildCommand({
  docs: {
    brief: "Check debug files for issues",
    fullDescription:
      "Check debug information files for issues.\n\n" +
      "Wraps: sentry-cli debug-files check\n\n" +
      "Examples:\n" +
      "  sentry debug-files check ./path/to/file",
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
    await runSentryCli(["debug-files", "check", ...args]);
  },
});
