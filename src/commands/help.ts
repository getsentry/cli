/**
 * Help Command
 *
 * Provides help information for the CLI.
 * - `sentry help` or `sentry` (no args): Shows branded help with banner
 * - `sentry help <command>`: Shows Stricli's detailed help (--helpAll) for that command
 */

import { buildCommand, run } from "@stricli/core";
import type { SentryContext } from "../context.js";
import { printCustomHelp } from "../lib/help.js";

export const helpCommand = buildCommand({
  docs: {
    brief: "Display help for a command",
    fullDescription:
      "Display help information. Run 'sentry help' for an overview, " +
      "or 'sentry help <command>' for detailed help on a specific command.",
  },
  parameters: {
    flags: {},
    positional: {
      kind: "array",
      parameter: {
        brief: "Command to get help for",
        parse: String,
        placeholder: "command",
      },
    },
  },
  // biome-ignore lint/complexity/noBannedTypes: Stricli requires empty object for commands with no flags
  async func(this: SentryContext, _flags: {}, ...commandPath: string[]) {
    const { stdout } = this;

    // No args: show branded help
    if (commandPath.length === 0) {
      await printCustomHelp(stdout);
      return;
    }

    // With args: re-invoke with --helpAll to show full help including hidden items
    // Use dynamic imports to avoid circular dependency (app.ts imports helpCommand)
    const { app } = await import("../app.js");
    const { buildContext } = await import("../context.js");
    await run(app, [...commandPath, "--helpAll"], buildContext(this.process));
  },
});
