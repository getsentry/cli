/**
 * sentry deploys list
 *
 * List deployments for a release.
 * Wraps: sentry-cli deploys list
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const listCommand = buildCommand({
  docs: {
    brief: "List deployments",
    fullDescription:
      "List deployments for a Sentry release.\n\n" +
      "Wraps: sentry-cli deploys list\n\n" +
      "Examples:\n" +
      "  sentry deploys list --org my-org --project my-project --release 1.0.0",
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
    await runSentryCli(["deploys", "list", ...args]);
  },
});
