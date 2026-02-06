/**
 * sentry releases delete
 *
 * Delete a release in Sentry.
 * Wraps: sentry-cli releases delete
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const deleteCommand = buildCommand({
  docs: {
    brief: "Delete a release",
    fullDescription:
      "Delete a release in Sentry.\n\n" +
      "Wraps: sentry-cli releases delete\n\n" +
      "Examples:\n" +
      "  sentry releases delete 1.0.0",
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
    await runSentryCli(["releases", "delete", ...args]);
  },
});
