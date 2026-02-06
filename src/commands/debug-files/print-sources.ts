/**
 * sentry debug-files print-sources
 *
 * Print source files embedded in debug information files.
 * Wraps: sentry-cli debug-files print-sources
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const printSourcesCommand = buildCommand({
  docs: {
    brief: "Print embedded source files",
    fullDescription:
      "Print source files embedded in debug information files.\n\n" +
      "Wraps: sentry-cli debug-files print-sources\n\n" +
      "Examples:\n" +
      "  sentry debug-files print-sources ./path/to/debug-file",
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
    await runSentryCli(["debug-files", "print-sources", ...args]);
  },
});
