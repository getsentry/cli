/**
 * Shared output utilities
 *
 * Handles the common pattern of JSON vs human-readable output
 * that appears in most CLI commands.
 *
 * Two usage modes:
 *
 * 1. **Imperative** — call {@link writeOutput} directly from the command:
 *    ```ts
 *    writeOutput(stdout, data, { json, formatHuman, hint });
 *    ```
 *
 * 2. **Return-based** — declare formatting in {@link OutputConfig} on
 *    `buildCommand`, then return bare data from `func`:
 *    ```ts
 *    buildCommand({
 *      output: { json: true, human: fn },
 *      func() { return data; },
 *    })
 *    ```
 *    The wrapper reads `json`/`fields` from flags and applies formatting
 *    automatically. Commands return `{ data }` or `{ data, hint }` objects.
 *
 * Both modes serialize the same data object to JSON and pass it to
 * `formatHuman` — there is no divergent-data path.
 */

import type { Writer } from "../../types/index.js";
import { muted } from "./colors.js";
import { formatJson, writeJson } from "./json.js";

// ---------------------------------------------------------------------------
// Shared option types
// ---------------------------------------------------------------------------

/**
 * Options for {@link writeOutput} when JSON and human data share the same type.
 *
 * Most commands fetch data and then either serialize it to JSON or format it
 * for the terminal — use this form when the same object works for both paths.
 */
type WriteOutputOptions<T> = {
  /** Output JSON format instead of human-readable */
  json: boolean;
  /** Pre-parsed field paths to include in JSON output (from `--fields`) */
  fields?: string[];
  /** Function to format data as a rendered string */
  formatHuman: (data: T) => string;
  /** Short hint appended after human output (suppressed in JSON mode) */
  hint?: string;
  /** Footer hint shown after human output (suppressed in JSON mode) */
  footer?: string;
};

// ---------------------------------------------------------------------------
// Return-based output config (declared on buildCommand)
// ---------------------------------------------------------------------------

/**
 * Output configuration declared on `buildCommand` for automatic rendering.
 *
 * Two forms:
 *
 * 1. **Flag-only** — `output: "json"` — injects `--json` and `--fields` flags
 *    but does not intercept returns. Commands handle their own output.
 *
 * 2. **Full config** — `output: { json: true, human: fn }` — injects flags
 *    AND auto-renders the command's return value. Commands return
 *    `{ data }` or `{ data, hint }` objects.
 *
 * @typeParam T - Type of data the command returns (used by `human` formatter
 *   and serialized as-is to JSON)
 */
export type OutputConfig<T> = {
  /** Enable `--json` and `--fields` flag injection */
  json: true;
  /** Format data as a human-readable string for terminal output */
  human: (data: T) => string;
  /**
   * Top-level keys to strip from JSON output.
   *
   * Use this for fields that exist only for the human formatter
   * (e.g. pre-formatted terminal strings) and should not appear
   * in the JSON contract.
   *
   * Ignored when {@link jsonTransform} is set — the transform is
   * responsible for shaping the final JSON output.
   */
  jsonExclude?: ReadonlyArray<keyof T & string>;
  /**
   * Custom JSON serialization transform.
   *
   * When set, replaces the default JSON output path entirely.
   * The function receives the raw command data and the parsed `--fields`
   * list, and returns the final object to serialize.
   *
   * This is useful for list commands that wrap items in a
   * `{ data, hasMore, nextCursor }` envelope and need per-element
   * field filtering rather than top-level filtering.
   *
   * When `jsonTransform` is set, `jsonExclude` is ignored.
   */
  jsonTransform?: (data: T, fields?: string[]) => unknown;
};

/**
 * Unique brand for {@link CommandOutput} objects.
 *
 * Using a Symbol instead of duck-typing (`"data" in v`) prevents false
 * positives when a command accidentally yields a raw API response that
 * happens to have a `data` property.
 */
export const COMMAND_OUTPUT_BRAND: unique symbol = Symbol.for(
  "sentry-cli:command-output"
);

/**
 * Yield type for commands with {@link OutputConfig}.
 *
 * Commands wrap each yielded value in this object so the `buildCommand`
 * wrapper can unambiguously detect data vs void/raw yields. The brand
 * symbol provides a runtime discriminant that cannot collide with
 * arbitrary data shapes.
 *
 * Hints are NOT carried on yielded values — they belong on the generator's
 * return value ({@link CommandReturn}) so the framework renders them once
 * after the generator completes.
 *
 * @typeParam T - The data type (matches the `OutputConfig<T>` type parameter)
 */
export type CommandOutput<T> = {
  /** Runtime brand — set automatically by {@link commandOutput} */
  [COMMAND_OUTPUT_BRAND]: true;
  /** The data to render (serialized as-is to JSON, passed to `human` formatter) */
  data: T;
};

/**
 * Create a branded {@link CommandOutput} value.
 *
 * Commands should use this helper instead of constructing `{ data }` literals
 * directly, so the brand is always present.
 *
 * @example
 * ```ts
 * yield commandOutput(myData);
 * ```
 */
export function commandOutput<T>(data: T): CommandOutput<T> {
  return { [COMMAND_OUTPUT_BRAND]: true, data };
}

/**
 * Return type for command generators.
 *
 * Carries metadata that applies to the entire command invocation — not to
 * individual yielded chunks. The `buildCommand` wrapper captures this from
 * the generator's return value (the `done: true` result of `.next()`).
 *
 * `hint` is shown in human mode and suppressed in JSON mode.
 */
export type CommandReturn = {
  /** Hint line appended after all output (suppressed in JSON mode) */
  hint?: string;
};

/**
 * Rendering context passed to {@link renderCommandOutput}.
 * Contains the wrapper-injected flag values needed for output mode selection.
 */
type RenderContext = {
  /** Whether `--json` was passed */
  json: boolean;
  /** Pre-parsed `--fields` value */
  fields?: string[];
};

/**
 * Apply `jsonExclude` keys to data, stripping excluded fields from
 * objects or from each element of an array. Returns the data unchanged
 * when no exclusions are configured.
 */
function applyJsonExclude(
  data: unknown,
  excludeKeys: readonly string[] | undefined
): unknown {
  if (!excludeKeys || excludeKeys.length === 0) {
    return data;
  }
  if (typeof data !== "object" || data === null) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item: unknown) => {
      if (typeof item !== "object" || item === null) {
        return item;
      }
      const copy = { ...item } as Record<string, unknown>;
      for (const key of excludeKeys) {
        delete copy[key];
      }
      return copy;
    });
  }
  const copy = { ...data } as Record<string, unknown>;
  for (const key of excludeKeys) {
    delete copy[key];
  }
  return copy;
}

/**
 * Write a JSON-transformed value to stdout.
 *
 * `undefined` suppresses the chunk entirely (e.g. streaming text-only
 * chunks in JSON mode).
 */
function writeTransformedJson(stdout: Writer, transformed: unknown): void {
  if (transformed !== undefined) {
    stdout.write(`${formatJson(transformed)}\n`);
  }
}

/**
 * Render a single yielded `CommandOutput<T>` chunk via an output config.
 *
 * Called by the `buildCommand` wrapper when a command with `output: { ... }`
 * yields data. In JSON mode the data is serialized as-is (with optional
 * field filtering); in human mode the config's `human` formatter is called.
 *
 * For streaming commands that yield multiple times, this function is called
 * once per yielded value. Each call appends to stdout independently.
 *
 * Hints are NOT rendered here — the wrapper renders them once after the
 * generator completes, using the generator's return value.
 *
 * @param stdout - Writer to output to
 * @param data - The data yielded by the command
 * @param config - The output config declared on buildCommand
 * @param ctx - Rendering context with flag values
 */
export function renderCommandOutput(
  stdout: Writer,
  data: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: Variance erasure — config.human is contravariant in T but data/config are paired at build time. Using `any` lets the framework call human(unknownData) without requiring every OutputConfig to accept unknown.
  config: OutputConfig<any>,
  ctx: RenderContext
): void {
  if (ctx.json) {
    if (config.jsonTransform) {
      writeTransformedJson(stdout, config.jsonTransform(data, ctx.fields));
      return;
    }
    writeJson(stdout, applyJsonExclude(data, config.jsonExclude), ctx.fields);
    return;
  }

  const text = config.human(data);
  if (text) {
    stdout.write(`${text}\n`);
  }
}

// ---------------------------------------------------------------------------
// Imperative output
// ---------------------------------------------------------------------------

/**
 * Write formatted output to stdout based on output format.
 *
 * Handles the common JSON-vs-human pattern used across commands:
 * - JSON mode: serialize data with optional field filtering
 * - Human mode: call `formatHuman`, then optionally print `hint` and `footer`
 */
export function writeOutput<T>(
  stdout: Writer,
  data: T,
  options: WriteOutputOptions<T>
): void {
  if (options.json) {
    writeJson(stdout, data, options.fields);
    return;
  }

  const text = options.formatHuman(data);
  stdout.write(`${text}\n`);

  if (options.hint) {
    stdout.write(`\n${muted(options.hint)}\n`);
  }

  if (options.footer) {
    writeFooter(stdout, options.footer);
  }
}

/**
 * Write a formatted footer hint to stdout.
 * Adds empty line separator and applies muted styling.
 *
 * @param stdout - Writer to output to
 * @param text - Footer text to display
 */
/** Format footer text (muted, with surrounding newlines). */
export function formatFooter(text: string): string {
  return `\n${muted(text)}\n`;
}

export function writeFooter(stdout: Writer, text: string): void {
  stdout.write(formatFooter(text));
}
