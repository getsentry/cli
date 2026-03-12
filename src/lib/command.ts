/**
 * Command builder with telemetry, global flag injection, and output modes.
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
 * 3. **Output mode injection** — when `output` has an {@link OutputConfig},
 *    `--json` and `--fields` flags are injected automatically. The command
 *    returns a `{ data, hint? }` object and the wrapper handles rendering
 *    via the config's `human` formatter.
 *    Commands that define their own `json` flag keep theirs.
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
  buildCommand as stricliCommand,
  numberParser as stricliNumberParser,
} from "@stricli/core";
import { OutputError } from "./errors.js";
import { parseFieldsList } from "./formatters/json.js";
import {
  type CommandOutput,
  type OutputConfig,
  renderCommandOutput,
} from "./formatters/output.js";
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
 * Command function type for Sentry CLI commands.
 *
 * ALL command functions are async generators. The framework iterates
 * each yielded value and renders it through the output config.
 *
 * - **Non-streaming**: yield a single `CommandOutput<T>` and return.
 * - **Streaming**: yield multiple values; each is rendered immediately
 *   (JSONL in `--json` mode, human text otherwise).
 * - **Void**: return without yielding for early exits (e.g. `--web`).
 */
type SentryCommandFunction<
  FLAGS extends BaseFlags,
  ARGS extends BaseArgs,
  CONTEXT extends CommandContext,
> = (
  this: CONTEXT,
  flags: FLAGS,
  ...args: ARGS
) => AsyncGenerator<unknown, void, undefined>;

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
  readonly func: SentryCommandFunction<FLAGS, ARGS, CONTEXT>;
  /**
   * Output configuration — controls flag injection and optional auto-rendering.
   *
   * Two forms:
   *
   * 1. **`"json"`** — injects `--json` and `--fields` flags only. The command
   *    handles its own output via `writeOutput` or direct writes.
   *
   * 2. **`{ json: true, human: fn }`** — injects flags AND auto-renders.
   *    The command returns `{ data }` or `{ data, hint }` and the wrapper
   *    handles JSON/human branching. Void returns are ignored.
   *
   * @example
   * ```ts
   * // Flag injection only:
   * buildCommand({ output: "json", func() { writeOutput(...); } })
   *
   * // Full auto-render:
   * buildCommand({
   *   output: { json: true, human: formatUserIdentity },
   *   func() { return user; },
   * })
   * ```
   */
  // biome-ignore lint/suspicious/noExplicitAny: OutputConfig is generic but we erase types at the builder level
  readonly output?: "json" | OutputConfig<any>;
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

// ---------------------------------------------------------------------------
// JSON output flags (injected when output config is present)
// ---------------------------------------------------------------------------

/**
 * `--json` flag injected by {@link buildCommand} when `output` config is set.
 * Outputs machine-readable JSON instead of human-readable text.
 */
export const JSON_FLAG = {
  kind: "boolean" as const,
  brief: "Output as JSON",
  default: false,
} as const;

/**
 * `--fields` flag injected by {@link buildCommand} when `output` config is set.
 *
 * Accepts a comma-separated list of field paths (dot-notation supported)
 * to include in JSON output. Reduces token consumption for agent workflows.
 *
 * The raw string is **pre-parsed** into a `string[]` by the wrapper before
 * the command's `func` receives it. Commands should declare their flags type
 * as `fields?: string[]` (not `string`).
 *
 * Only meaningful when `--json` is also set — silently ignored otherwise.
 */
export const FIELDS_FLAG = {
  kind: "parsed" as const,
  parse: String,
  brief:
    "Comma-separated fields to include in JSON output (dot.notation supported)",
  optional: true as const,
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
 * Build a Sentry CLI command with telemetry, global flags, and output modes.
 *
 * This is the **only** command builder that should be used. It:
 * 1. Injects hidden `--log-level` and `--verbose` flags into the parameters
 * 2. Intercepts them before the original `func` runs to call `setLogLevel()`
 * 3. Strips injected flags so the original function never sees them
 * 4. Captures flag values and positional arguments as Sentry telemetry context
 * 5. When `output` has an {@link OutputConfig}, injects `--json` and `--fields`
 *    flags, pre-parses `--fields`, and auto-renders the command's `{ data }` return
 *
 * When a command already defines its own `verbose` flag (e.g. the `api` command
 * uses `--verbose` for HTTP request/response output), the injected `VERBOSE_FLAG`
 * is skipped. The command's own `verbose` value is still used for log-level
 * side-effects, and it is **not** stripped — the original func receives it as usual.
 *
 * Similarly, when a command already defines its own `json` flag (e.g. for
 * custom brief text), the injected `JSON_FLAG` is skipped. `--fields` is
 * always injected when `output: "json"` regardless.
 *
 * Flag keys use kebab-case because Stricli uses the literal object key as
 * the CLI flag name (e.g. `"log-level"` → `--log-level`).
 *
 * @param builderArgs - Same shape as Stricli's buildCommand arguments,
 *   plus an optional `output` mode
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
  const rawOutput = builderArgs.output;
  /** Resolved output config (object form), or undefined if no auto-rendering */
  const outputConfig = typeof rawOutput === "object" ? rawOutput : undefined;
  /** Whether to inject --json/--fields flags */
  const hasJsonOutput = rawOutput === "json" || rawOutput?.json === true;

  // Merge logging flags into the command's flag definitions.
  // Quoted keys produce kebab-case CLI flags: "log-level" → --log-level
  const existingParams = (builderArgs.parameters ?? {}) as Record<
    string,
    unknown
  >;
  const existingFlags = (existingParams.flags ?? {}) as Record<string, unknown>;

  // If the command already defines --verbose (e.g. api command), don't override it.
  const commandOwnsVerbose = "verbose" in existingFlags;
  // If the command already defines --json (e.g. custom brief), don't override it.
  const commandOwnsJson = "json" in existingFlags;

  const mergedFlags: Record<string, unknown> = {
    ...existingFlags,
    [LOG_LEVEL_KEY]: LOG_LEVEL_FLAG,
  };
  if (!commandOwnsVerbose) {
    mergedFlags.verbose = VERBOSE_FLAG;
  }

  // Inject --json and --fields when output config is set
  if (hasJsonOutput) {
    if (!commandOwnsJson) {
      mergedFlags.json = JSON_FLAG;
    }
    // --fields is always injected (no command defines its own)
    mergedFlags.fields = FIELDS_FLAG;
  }

  const mergedParams = { ...existingParams, flags: mergedFlags };

  /**
   * Check if a value is a {@link CommandOutput} object (`{ data, hint? }`).
   *
   * The presence of a `data` property is the unambiguous discriminant —
   * no heuristic key-sniffing needed.
   */
  function isCommandOutput(v: unknown): v is CommandOutput<unknown> {
    return typeof v === "object" && v !== null && "data" in v;
  }

  /**
   * If the command returned a {@link CommandOutput}, render it via the
   * output config. Void/undefined/Error returns are ignored.
   */
  function handleReturnValue(
    context: CONTEXT,
    value: unknown,
    flags: Record<string, unknown>
  ): void {
    if (
      !outputConfig ||
      value === null ||
      value === undefined ||
      value instanceof Error ||
      !isCommandOutput(value)
    ) {
      return;
    }
    const stdout = (context as Record<string, unknown>)
      .stdout as import("../types/index.js").Writer;

    renderCommandOutput(stdout, value.data, outputConfig, {
      hint: value.hint,
      json: Boolean(flags.json),
      fields: flags.fields as string[] | undefined,
    });
  }

  /**
   * Strip injected flags from the raw Stricli-parsed flags object.
   * --log-level is always stripped. --verbose is stripped only when we
   * injected it (not when the command defines its own). --fields is
   * pre-parsed from comma-string to string[] when output: "json".
   */
  function cleanRawFlags(
    raw: Record<string, unknown>
  ): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === LOG_LEVEL_KEY) {
        continue;
      }
      if (key === "verbose" && !commandOwnsVerbose) {
        continue;
      }
      clean[key] = value;
    }
    if (hasJsonOutput && typeof clean.fields === "string") {
      clean.fields = parseFieldsList(clean.fields);
    }
    return clean;
  }

  // Wrap func to intercept logging flags, capture telemetry, then call original.
  // The wrapper is an async function that iterates the generator returned by func.
  const wrappedFunc = async function (
    this: CONTEXT,
    // biome-ignore lint/suspicious/noExplicitAny: Stricli's CommandFunction type is complex
    flags: any,
    // biome-ignore lint/suspicious/noExplicitAny: Stricli's CommandFunction type is complex
    ...args: any[]
  ) {
    applyLoggingFlags(
      flags[LOG_LEVEL_KEY] as LogLevelName | undefined,
      flags.verbose as boolean
    );

    const cleanFlags = cleanRawFlags(flags as Record<string, unknown>);
    setFlagContext(cleanFlags);
    if (args.length > 0) {
      setArgsContext(args);
    }

    // OutputError handler: render data through the output system, then
    // exit with the error's code. Stricli overwrites process.exitCode = 0
    // after successful returns, so process.exit() is the only way to
    // preserve a non-zero code. This lives in the framework — commands
    // simply `throw new OutputError(data)`.
    const handleOutputError = (err: unknown): never => {
      if (err instanceof OutputError && outputConfig) {
        // Only render if there's actual data to show
        if (err.data !== null && err.data !== undefined) {
          handleReturnValue(
            this,
            { data: err.data } as CommandOutput<unknown>,
            cleanFlags
          );
        }
        process.exit(err.exitCode);
      }
      throw err;
    };

    // Iterate the generator. Each yielded value is rendered through
    // the output config (if present). The generator itself never
    // touches stdout — all rendering is done here.
    try {
      const generator = originalFunc.call(
        this,
        cleanFlags as FLAGS,
        ...(args as unknown as ARGS)
      );
      for await (const value of generator) {
        handleReturnValue(this, value, cleanFlags);
      }
    } catch (err) {
      handleOutputError(err);
    }
  };

  // Build the command with the wrapped function via Stricli
  return stricliCommand({
    ...builderArgs,
    parameters: mergedParams,
    func: wrappedFunc,
    // biome-ignore lint/suspicious/noExplicitAny: Stricli types are complex unions
  } as any);
}
