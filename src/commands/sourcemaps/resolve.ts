/**
 * sentry sourcemaps resolve
 *
 * Resolve minified source locations using sourcemaps.
 * Wraps: sentry-cli sourcemaps resolve
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const resolveCommand = buildCommand({
  docs: {
    brief: "Resolve minified source locations",
    fullDescription:
      "Resolve minified source locations using sourcemaps.\n\n" +
      "Wraps: sentry-cli sourcemaps resolve\n\n" +
      "Examples:\n" +
      "  sentry sourcemaps resolve",
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
    await runSentryCli(["sourcemaps", "resolve", ...args]);
  },
});
