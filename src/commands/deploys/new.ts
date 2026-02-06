/**
 * sentry deploys new
 *
 * Create a new deployment for a release.
 * Wraps: sentry-cli deploys new
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const newCommand = buildCommand({
  docs: {
    brief: "Create a new deployment",
    fullDescription:
      "Create a new deployment for a Sentry release.\n\n" +
      "Wraps: sentry-cli deploys new\n\n" +
      "Examples:\n" +
      "  sentry deploys new --env production --release 1.0.0",
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
    await runSentryCli(["deploys", "new", ...args]);
  },
});
