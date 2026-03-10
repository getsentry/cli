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
import { writeJson } from "./json.js";

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
};

/**
 * Return type for commands with {@link OutputConfig}.
 *
 * Commands wrap their return value in this object so the `buildCommand` wrapper
 * can unambiguously detect data vs void returns. The optional `hint` provides
 * rendering metadata that depends on execution-time values (e.g. auto-detection
 * source). Hints are shown in human mode and suppressed in JSON mode.
 *
 * @typeParam T - The data type (matches the `OutputConfig<T>` type parameter)
 */
export type CommandOutput<T> = {
  /** The data to render (serialized as-is to JSON, passed to `human` formatter) */
  data: T;
  /** Short hint line appended after human output (e.g. "Detected from .env") */
  hint?: string;
};

/**
 * Full rendering context passed to {@link renderCommandOutput}.
 * Combines the command's runtime hints with wrapper-injected flags.
 */
type RenderContext = {
  /** Whether `--json` was passed */
  json: boolean;
  /** Pre-parsed `--fields` value */
  fields?: string[];
  /** Short hint line appended after human output (suppressed in JSON mode) */
  hint?: string;
};

/**
 * Render a command's return value using an {@link OutputConfig}.
 *
 * Called by the `buildCommand` wrapper when a command with `output: { ... }`
 * returns data. In JSON mode the data is serialized as-is (with optional
 * field filtering); in human mode the config's `human` formatter is called.
 *
 * @param stdout - Writer to output to
 * @param data - The data returned by the command
 * @param config - The output config declared on buildCommand
 * @param ctx - Merged rendering context (command hints + runtime flags)
 */
export function renderCommandOutput(
  stdout: Writer,
  data: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: Variance — human is contravariant in T; safe because data and config are paired at build time.
  config: OutputConfig<any>,
  ctx: RenderContext
): void {
  if (ctx.json) {
    writeJson(stdout, data, ctx.fields);
    return;
  }

  const text = config.human(data);
  stdout.write(`${text}\n`);

  if (ctx.hint) {
    stdout.write(`\n${muted(ctx.hint)}\n`);
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
export function writeFooter(stdout: Writer, text: string): void {
  stdout.write("\n");
  stdout.write(`${muted(text)}\n`);
}
