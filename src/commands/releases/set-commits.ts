/**
 * sentry releases set-commits
 *
 * Associate commits with a release.
 * Wraps: sentry-cli releases set-commits
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const setCommitsCommand = buildCommand({
  docs: {
    brief: "Associate commits with a release",
    fullDescription:
      "Associate commits with a release in Sentry.\n\n" +
      "Wraps: sentry-cli releases set-commits\n\n" +
      "Examples:\n" +
      "  sentry releases set-commits 1.0.0 --auto\n" +
      "  sentry releases set-commits 1.0.0 --commit 'my-org/my-repo@from..to'",
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
    await runSentryCli(["releases", "set-commits", ...args]);
  },
});
