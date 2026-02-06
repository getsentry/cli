/**
 * sentry monitors run
 *
 * Run a command and report to a cron monitor.
 * Wraps: sentry-cli monitors run
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const runMonitorCommand = buildCommand({
  docs: {
    brief: "Run a command and report to a cron monitor",
    fullDescription:
      "Run a command and report its status to a Sentry cron monitor.\n\n" +
      "Wraps: sentry-cli monitors run\n\n" +
      "Examples:\n" +
      "  sentry monitors run my-monitor -- ./my-script.sh",
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
    await runSentryCli(["monitors", "run", ...args]);
  },
});
