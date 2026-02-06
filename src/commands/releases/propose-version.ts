/**
 * sentry releases propose-version
 *
 * Propose a version string for a new release.
 * Wraps: sentry-cli releases propose-version
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const proposeVersionCommand = buildCommand({
  docs: {
    brief: "Propose a version string",
    fullDescription:
      "Propose a version string for a new release based on commit history.\n\n" +
      "Wraps: sentry-cli releases propose-version\n\n" +
      "Examples:\n" +
      "  sentry releases propose-version",
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
    await runSentryCli(["releases", "propose-version", ...args]);
  },
});
