/**
 * Help Command
 *
 * Provides help information for the CLI.
 * - `sentry help` or `sentry` (no args): Shows branded help with banner
 * - `sentry help <command>`: Shows detailed help for that command
 * - `sentry help --json`: Emits full command tree as structured JSON
 * - `sentry help --json <command>`: Emits specific command/group metadata as JSON
 */

import type { SentryContext } from "../context.js";
import { buildCommand } from "../lib/command.js";
import { getCommandSuggestion } from "../lib/command-suggestions.js";
import { OutputError } from "../lib/errors.js";
import { CommandOutput } from "../lib/formatters/output.js";
import {
  formatHelpHuman,
  introspectAllCommands,
  introspectCommand,
  printCustomHelp,
} from "../lib/help.js";

export const helpCommand = buildCommand({
  auth: false,
  docs: {
    brief: "Display help for a command",
    fullDescription:
      "Display help information. Run 'sentry help' for an overview, " +
      "or 'sentry help <command>' for detailed help on a specific command. " +
      "Use --json for machine-readable output suitable for AI agents.",
  },
  output: {
    human: formatHelpHuman,
    jsonExclude: ["_banner"] as const,
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
  // biome-ignore lint/suspicious/useAwait: async generator required by Stricli buildCommand pattern
  async *func(this: SentryContext, _flags: {}, ...commandPath: string[]) {
    if (commandPath.length === 0) {
      // Yield the full command tree. Attach the branded banner for human display;
      // jsonExclude strips _banner from JSON output.
      const tree = introspectAllCommands();
      const banner = printCustomHelp();
      return yield new CommandOutput({ ...tree, _banner: banner });
    }

    // Resolve the command path and yield the result.
    // This ensures --json mode always gets structured output.
    const result = introspectCommand(commandPath);
    if ("error" in result) {
      // Enrich the error with a command suggestion when the unknown token
      // matches a known synonym (e.g., "info" → "sentry auth status").
      // Without this, agents and scripts that run `sentry info` get a bare
      // "command not found" dump instead of an actionable hint (CLI-TM).
      const suggestion = getCommandSuggestion("", commandPath[0] ?? "");
      if (suggestion) {
        const hint = suggestion.explanation
          ? `${suggestion.explanation} ${suggestion.command}`
          : `Try: ${suggestion.command}`;
        result.suggestions = [hint, ...(result.suggestions ?? [])];
      }
      // OutputError renders through the output system but exits non-zero
      throw new OutputError(result);
    }
    return yield new CommandOutput(result);
  },
});
