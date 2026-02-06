/**
 * sentry sourcemaps upload
 *
 * Upload sourcemaps to Sentry.
 * Wraps: sentry-cli sourcemaps upload
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const uploadCommand = buildCommand({
  docs: {
    brief: "Upload sourcemaps",
    fullDescription:
      "Upload sourcemaps to Sentry for a release.\n\n" +
      "Wraps: sentry-cli sourcemaps upload\n\n" +
      "Examples:\n" +
      "  sentry sourcemaps upload ./dist\n" +
      "  sentry sourcemaps upload --release 1.0.0 ./dist",
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
    await runSentryCli(["sourcemaps", "upload", ...args]);
  },
});
