/**
 * Command Builder with Telemetry
 *
 * Wraps Stricli's buildCommand to automatically capture flag usage for telemetry.
 * Commands should import buildCommand from this module instead of @stricli/core.
 */

import {
  type Command,
  type CommandContext,
  type CommandFunction,
  buildCommand as stricliCommand,
  numberParser as stricliNumberParser,
} from "@stricli/core";
import { setArgsContext, setFlagContext } from "./telemetry.js";

/**
 * Parse a string input as a number.
 * Re-exported from Stricli for convenience.
 */
export const numberParser = stricliNumberParser;

/** Base flags type from Stricli */
type BaseFlags = Readonly<Partial<Record<string, unknown>>>;

/** Base args type from Stricli */
type BaseArgs = readonly unknown[];

/** Command documentation */
type CommandDocumentation = {
  readonly brief: string;
  readonly fullDescription?: string;
};

/**
 * Arguments for building a command with a local function.
 * This is the subset of Stricli's CommandBuilderArguments that we support.
 */
type LocalCommandBuilderArguments<
  FLAGS extends BaseFlags,
  ARGS extends BaseArgs,
  CONTEXT extends CommandContext,
> = {
  readonly parameters?: Record<string, unknown>;
  readonly docs: CommandDocumentation;
  readonly func: CommandFunction<FLAGS, ARGS, CONTEXT>;
};

/**
 * Build a command with automatic flag telemetry.
 *
 * This is a drop-in replacement for Stricli's buildCommand that wraps the
 * command function to automatically capture flag values as Sentry tags.
 *
 * Usage is identical to Stricli's buildCommand - just change the import:
 * ```ts
 * // Before:
 * import { buildCommand } from "@stricli/core";
 *
 * // After:
 * import { buildCommand } from "../../lib/command.js";
 * ```
 *
 * @param builderArgs - Same arguments as Stricli's buildCommand
 * @returns A Command with automatic flag telemetry
 */
export function buildCommand<
  const FLAGS extends BaseFlags = NonNullable<unknown>,
  const ARGS extends BaseArgs = [],
  const CONTEXT extends CommandContext = CommandContext,
>(
  builderArgs: LocalCommandBuilderArguments<FLAGS, ARGS, CONTEXT>
): Command<CONTEXT> {
  const originalFunc = builderArgs.func;

  // Wrap the function to capture flags and args before execution
  const wrappedFunc = function (
    this: CONTEXT,
    flags: FLAGS,
    ...args: ARGS
  ): ReturnType<typeof originalFunc> {
    // Capture flag values as telemetry tags
    setFlagContext(flags as Record<string, unknown>);

    // Capture positional arguments as context
    if (args.length > 0) {
      setArgsContext(args);
    }

    // Call the original function with the same context and arguments
    return originalFunc.call(this, flags, ...args);
  } as typeof originalFunc;

  // Build the command with the wrapped function
  return stricliCommand({
    ...builderArgs,
    func: wrappedFunc,
    // biome-ignore lint/suspicious/noExplicitAny: Stricli types are complex unions
  } as any);
}
