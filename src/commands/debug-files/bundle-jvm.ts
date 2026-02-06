/**
 * sentry debug-files bundle-jvm
 *
 * Bundle JVM debug information files.
 * Wraps: sentry-cli debug-files bundle-jvm
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const bundleJvmCommand = buildCommand({
  docs: {
    brief: "Bundle JVM debug files",
    fullDescription:
      "Bundle JVM debug information files.\n\n" +
      "Wraps: sentry-cli debug-files bundle-jvm\n\n" +
      "Examples:\n" +
      "  sentry debug-files bundle-jvm ./path/to/classes",
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
    await runSentryCli(["debug-files", "bundle-jvm", ...args]);
  },
});
