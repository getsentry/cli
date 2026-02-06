/**
 * sentry sourcemaps inject
 *
 * Inject debug IDs into source files.
 * Wraps: sentry-cli sourcemaps inject
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const injectCommand = buildCommand({
  docs: {
    brief: "Inject debug IDs into source files",
    fullDescription:
      "Inject debug IDs into source files and sourcemaps.\n\n" +
      "Wraps: sentry-cli sourcemaps inject\n\n" +
      "Examples:\n" +
      "  sentry sourcemaps inject ./dist",
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
    await runSentryCli(["sourcemaps", "inject", ...args]);
  },
});
