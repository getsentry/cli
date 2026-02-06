/**
 * sentry releases new
 *
 * Create a new release in Sentry.
 * Wraps: sentry-cli releases new
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const newCommand = buildCommand({
  docs: {
    brief: "Create a new release",
    fullDescription:
      "Create a new release in Sentry.\n\n" +
      "Wraps: sentry-cli releases new\n\n" +
      "Examples:\n" +
      "  sentry releases new 1.0.0\n" +
      "  sentry releases new 1.0.0 --org my-org --project my-project",
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
    await runSentryCli(["releases", "new", ...args]);
  },
});
