/**
 * sentry react-native gradle
 *
 * Upload React Native Android build artifacts.
 * Wraps: sentry-cli react-native gradle
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const gradleCommand = buildCommand({
  docs: {
    brief: "Upload React Native Android build artifacts",
    fullDescription:
      "Upload React Native Android build artifacts to Sentry.\n\n" +
      "Wraps: sentry-cli react-native gradle\n\n" +
      "Examples:\n" +
      "  sentry react-native gradle",
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
    await runSentryCli(["react-native", "gradle", ...args]);
  },
});
