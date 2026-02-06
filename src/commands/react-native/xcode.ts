/**
 * sentry react-native xcode
 *
 * Upload React Native iOS build artifacts (macOS only).
 * Wraps: sentry-cli react-native xcode
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const xcodeCommand = buildCommand({
  docs: {
    brief: "Upload React Native iOS build artifacts",
    fullDescription:
      "Upload React Native iOS build artifacts to Sentry.\n\n" +
      "Wraps: sentry-cli react-native xcode\n\n" +
      "Note: This command is only available on macOS.\n\n" +
      "Examples:\n" +
      "  sentry react-native xcode",
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
    await runSentryCli(["react-native", "xcode", ...args]);
  },
});
