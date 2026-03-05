/**
 * Command builder with telemetry and global logging flag injection.
 *
 * Provides `buildCommand` — the standard command builder for all Sentry CLI
 * commands. It wraps Stricli's `buildCommand` with:
 *
 * 1. **Automatic flag/arg telemetry** — captures flag values and positional
 *    arguments as Sentry span context for observability.
 *
 * 2. **Hidden global logging flags** — injects `--log-level` and `--verbose`
 *    into every command's parameters. These are intercepted before the original
 *    `func` runs: the logger level is set, and the injected flags are stripped
 *    so the original function never sees them. If a command already defines its
 *    own `--verbose` flag (e.g. `api` uses it for HTTP output), the injected
 *    one is skipped and the command's own value is used for both purposes.
 *
 * ALL commands MUST use `buildCommand` from this module, NOT from
 * `@stricli/core`. Importing directly from Stricli silently bypasses
 * telemetry and global flag handling.
 *
 * ```
 * Correct:   import { buildCommand } from "../../lib/command.js";
 * Incorrect: import { buildCommand } from "@stricli/core";         // skips everything!
 * ```
 */

import {
  type Command,
  type CommandContext,
  type CommandFunction,
  buildCommand as stricliCommand,
  numberParser as stricliNumberParser,
} from "@stricli/core";
import {
  LOG_LEVEL_NAMES,
  type LogLevelName,
  parseLogLevel,
  setLogLevel,
} from "./logger.js";
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

// ---------------------------------------------------------------------------
// Global logging flags
// ---------------------------------------------------------------------------

/**
 * Hidden `--log-level` flag injected into every command by {@link buildCommand}.
 *
 * Accepts one of the valid log level names. Hidden so it doesn't clutter
 * individual command `--help` output — it's documented at the CLI level.
 */
export const LOG_LEVEL_FLAG = {
  kind: "enum" as const,
  values: LOG_LEVEL_NAMES as unknown as LogLevelName[],
  brief: "Set log verbosity level",
  optional: true as const,
  hidden: true as const,
} as const;

/**
 * Hidden `--verbose` flag injected into every command by {@link buildCommand}.
 * Equivalent to `--log-level debug`.
 */
export const VERBOSE_FLAG = {
  kind: "boolean" as const,
  brief: "Enable verbose (debug-level) logging output",
  default: false,
  hidden: true as const,
} as const;

/** The flag key for the injected --log-level flag (always stripped) */
const LOG_LEVEL_KEY = "log-level";

/**
 * Apply logging flags parsed by Stricli.
 *
 * `--log-level` takes priority over `--verbose`. If neither is specified,
 * the level is left as-is (env var or default).
 *
 * @param logLevel - Value of the `--log-level` flag, if provided
 * @param verbose - Value of the `--verbose` flag
 */
export function applyLoggingFlags(
  logLevel: LogLevelName | undefined,
  verbose: boolean
): void {
  if (logLevel) {
    setLogLevel(parseLogLevel(logLevel));
  } else if (verbose) {
    setLogLevel(parseLogLevel("debug"));
  }
}

// ---------------------------------------------------------------------------
// buildCommand — the single entry point for all Sentry CLI commands
// ---------------------------------------------------------------------------

/**
 * Build a Sentry CLI command with telemetry and global logging flags.
 *
 * This is the **only** command builder that should be used. It:
 * 1. Injects hidden `--log-level` and `--verbose` flags into the parameters
 * 2. Intercepts them before the original `func` runs to call `setLogLevel()`
 * 3. Strips injected flags so the original function never sees them
 * 4. Captures flag values and positional arguments as Sentry telemetry context
 *
 * When a command already defines its own `verbose` flag (e.g. the `api` command
 * uses `--verbose` for HTTP request/response output), the injected `VERBOSE_FLAG`
 * is skipped. The command's own `verbose` value is still used for log-level
 * side-effects, and it is **not** stripped — the original func receives it as usual.
 *
 * Flag keys use kebab-case because Stricli uses the literal object key as
 * the CLI flag name (e.g. `"log-level"` → `--log-level`).
 *
 * @param builderArgs - Same shape as Stricli's buildCommand arguments
 * @returns A fully-wrapped Stricli Command
 */
export function buildCommand<
  const FLAGS extends BaseFlags = NonNullable<unknown>,
  const ARGS extends BaseArgs = [],
  const CONTEXT extends CommandContext = CommandContext,
>(
  builderArgs: LocalCommandBuilderArguments<FLAGS, ARGS, CONTEXT>
): Command<CONTEXT> {
  const originalFunc = builderArgs.func;

  // Merge logging flags into the command's flag definitions.
  // Quoted keys produce kebab-case CLI flags: "log-level" → --log-level
  const existingParams = (builderArgs.parameters ?? {}) as Record<
    string,
    unknown
  >;
  const existingFlags = (existingParams.flags ?? {}) as Record<string, unknown>;

  // If the command already defines --verbose (e.g. api command), don't override it.
  const commandOwnsVerbose = "verbose" in existingFlags;

  const mergedFlags: Record<string, unknown> = {
    ...existingFlags,
    [LOG_LEVEL_KEY]: LOG_LEVEL_FLAG,
  };
  if (!commandOwnsVerbose) {
    mergedFlags.verbose = VERBOSE_FLAG;
  }
  const mergedParams = { ...existingParams, flags: mergedFlags };

  // Wrap func to intercept logging flags, capture telemetry, then call original
  // biome-ignore lint/suspicious/noExplicitAny: Stricli's CommandFunction type is complex
  const wrappedFunc = function (this: CONTEXT, flags: any, ...args: any[]) {
    // Apply logging side-effects from whichever flags are present.
    // The command's own --verbose (if any) also triggers debug-level logging.
    const logLevel = flags[LOG_LEVEL_KEY] as LogLevelName | undefined;
    const verbose = flags.verbose as boolean;
    applyLoggingFlags(logLevel, verbose);

    // Strip only the flags WE injected — never strip command-owned flags.
    // --log-level is always ours. --verbose is only stripped when we injected it.
    const cleanFlags: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      flags as Record<string, unknown>
    )) {
      if (key === LOG_LEVEL_KEY) {
        continue;
      }
      if (key === "verbose" && !commandOwnsVerbose) {
        continue;
      }
      cleanFlags[key] = value;
    }

    // Capture flag values as telemetry tags
    setFlagContext(cleanFlags);

    // Capture positional arguments as context
    if (args.length > 0) {
      setArgsContext(args);
    }

    return originalFunc.call(
      this,
      cleanFlags as FLAGS,
      ...(args as unknown as ARGS)
    );
  } as typeof originalFunc;

  // Build the command with the wrapped function via Stricli
  return stricliCommand({
    ...builderArgs,
    parameters: mergedParams,
    func: wrappedFunc,
    // biome-ignore lint/suspicious/noExplicitAny: Stricli types are complex unions
  } as any);
}
