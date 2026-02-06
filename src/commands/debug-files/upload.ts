/**
 * sentry debug-files upload
 *
 * Upload debug information files to Sentry.
 * Wraps: sentry-cli debug-files upload
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const uploadCommand = buildCommand({
  docs: {
    brief: "Upload debug information files",
    fullDescription:
      "Upload debug information files to Sentry.\n\n" +
      "Wraps: sentry-cli debug-files upload\n\n" +
      "Examples:\n" +
      "  sentry debug-files upload ./path/to/dsyms\n" +
      "  sentry debug-files upload --include-sources ./path/to/dsyms",
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
    await runSentryCli(["debug-files", "upload", ...args]);
  },
});
