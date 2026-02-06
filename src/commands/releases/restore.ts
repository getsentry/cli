/**
 * sentry releases restore
 *
 * Restore an archived release in Sentry.
 * Wraps: sentry-cli releases restore
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const restoreCommand = buildCommand({
  docs: {
    brief: "Restore an archived release",
    fullDescription:
      "Restore an archived release in Sentry.\n\n" +
      "Wraps: sentry-cli releases restore\n\n" +
      "Examples:\n" +
      "  sentry releases restore 1.0.0",
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
    await runSentryCli(["releases", "restore", ...args]);
  },
});
