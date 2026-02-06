/**
 * sentry releases info
 *
 * Show information about a release.
 * Wraps: sentry-cli releases info
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const infoCommand = buildCommand({
  docs: {
    brief: "Show release info",
    fullDescription:
      "Show information about a release in Sentry.\n\n" +
      "Wraps: sentry-cli releases info\n\n" +
      "Examples:\n" +
      "  sentry releases info 1.0.0",
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
    await runSentryCli(["releases", "info", ...args]);
  },
});
