/**
 * sentry debug-files bundle-sources
 *
 * Bundle source files for debug information.
 * Wraps: sentry-cli debug-files bundle-sources
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const bundleSourcesCommand = buildCommand({
  docs: {
    brief: "Bundle source files",
    fullDescription:
      "Bundle source files for debug information.\n\n" +
      "Wraps: sentry-cli debug-files bundle-sources\n\n" +
      "Examples:\n" +
      "  sentry debug-files bundle-sources ./path/to/debug-file",
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
    await runSentryCli(["debug-files", "bundle-sources", ...args]);
  },
});
