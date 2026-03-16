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
 * 2. **Yield-based** — declare formatting in {@link OutputConfig} on
 *    `buildCommand`, then yield data from the generator:
 *    ```ts
 *    buildCommand({
 *      output: { human: formatUser },
 *      async *func() { yield new CommandOutput(data); },
 *    })
 *    ```
 *    The wrapper reads `json`/`fields` from flags and applies formatting
 *    automatically. Generators return `{ hint }` for footer text.
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
 * Stateful human renderer created once per command invocation.
 *
 * The wrapper calls `render()` once per yielded value and `finalize()`
 * once after the generator completes. This enables streaming commands
 * to maintain per-invocation rendering state (e.g., a table that needs
 * a header on first call and a footer on last).
 *
 * For stateless commands, `finalize` can be omitted — the wrapper falls
 * back to `writeFooter(hint)`.
 *
 * @typeParam T - The data type yielded by the command
 */
export type HumanRenderer<T> = {
  /** Render a single yielded data chunk as human-readable text. */
  render: (data: T) => string;
  /**
   * Called once after the generator completes. Returns the final output
   * string (e.g., a streaming table's bottom border + formatted hint).
   *
   * When defined, replaces the default `writeFooter(hint)` behavior —
   * the wrapper writes the returned string directly.
   *
   * When absent, the wrapper falls back to `writeFooter(hint)`.
   */
  finalize?: (hint?: string) => string;
};

/**
 * Resolve the `human` field of an {@link OutputConfig} into a
 * {@link HumanRenderer}. Supports two forms:
 *
 * 1. **Plain function** — `(data: T) => string` — auto-wrapped into a
 *    stateless renderer (no `finalize`).
 * 2. **Factory** — `() => HumanRenderer<T>` — called once per invocation
 *    to produce a renderer with optional `finalize()`.
 *
 * Disambiguation: a function with `.length === 0` is treated as a factory.
 */
export function resolveRenderer<T>(human: HumanOutput<T>): HumanRenderer<T> {
  // Factory: zero-arg function that returns a renderer
  if (human.length === 0) {
    return (human as () => HumanRenderer<T>)();
  }
  // Plain formatter: wrap in a stateless renderer
  return { render: human as (data: T) => string };
}

/**
 * Human rendering for an {@link OutputConfig}.
 *
 * Two forms:
 * - **Plain function** `(data: T) => string` — stateless, auto-wrapped.
 * - **Factory** `() => HumanRenderer<T>` — called per invocation for
 *   stateful renderers (e.g., streaming tables with `finalize()`).
 */
export type HumanOutput<T> = ((data: T) => string) | (() => HumanRenderer<T>);

/**
 * Output configuration declared on `buildCommand` for automatic rendering.
 *
 * When present, `--json` and `--fields` flags are injected and the wrapper
 * auto-renders yielded {@link CommandOutput} values.
 *
 * @typeParam T - Type of data the command yields (used by `human` formatter
 *   and serialized as-is to JSON)
 */
export type OutputConfig<T> = {
  /**
   * Human-readable renderer.
   *
   * Pass a plain `(data: T) => string` for stateless formatting, or a
   * zero-arg factory `() => HumanRenderer<T>` for stateful rendering
   * with `finalize()` support.
   */
  human: HumanOutput<T>;
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
 * Yield type for commands with {@link OutputConfig}.
 *
 * Commands wrap each yielded value in this class so the `buildCommand`
 * wrapper can unambiguously detect data vs void/raw yields via `instanceof`.
 *
 * Hints are NOT carried on yielded values — they belong on the generator's
 * return value ({@link CommandReturn}) so the framework renders them once
 * after the generator completes.
 *
 * @typeParam T - The data type (matches the `OutputConfig<T>` type parameter)
 */
export class CommandOutput<T> {
  /** The data to render (serialized as-is to JSON, passed to `human` formatter) */
  readonly data: T;
  constructor(data: T) {
    this.data = data;
  }
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
  /**
   * Hint line appended after all output (suppressed in JSON mode).
   *
   * When the renderer has a `finalize()` method, the hint is passed
   * to it — the renderer decides how to render it alongside any
   * cleanup output (e.g., table footer). Otherwise the wrapper writes
   * it via `writeFooter()`.
   */
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
 * chunks in JSON mode). All other values are serialized as a single
 * JSON line.
 */
function writeTransformedJson(stdout: Writer, transformed: unknown): void {
  if (transformed === undefined) {
    return;
  }
  stdout.write(`${formatJson(transformed)}\n`);
}

/**
 * Render a single yielded `CommandOutput<T>` chunk.
 *
 * Called by the `buildCommand` wrapper per yielded value. In JSON mode
 * the data is serialized (with optional field filtering / transform);
 * in human mode the resolved renderer's `render()` is called.
 *
 * Hints are NOT rendered here — the wrapper calls `finalize()` or
 * `writeFooter()` once after the generator completes.
 *
 * @param stdout - Writer to output to
 * @param data - The data yielded by the command
 * @param config - The output config declared on buildCommand
 * @param renderer - Per-invocation renderer (from `config.human()`)
 * @param ctx - Rendering context with flag values
 */
// biome-ignore lint/nursery/useMaxParams: Framework function — config/renderer/ctx are all required for JSON vs human split.
export function renderCommandOutput(
  stdout: Writer,
  data: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: Variance erasure — config/renderer are paired at build time, but the framework iterates over unknown yields.
  config: OutputConfig<any>,
  // biome-ignore lint/suspicious/noExplicitAny: Renderer type mirrors erased OutputConfig<T>
  renderer: HumanRenderer<any>,
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

  const text = renderer.render(data);
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

/** Format footer text (muted, with surrounding newlines). */
export function formatFooter(text: string): string {
  return `\n${muted(text)}\n`;
}

/**
 * Write a formatted footer hint to stdout.
 * Adds empty line separator and applies muted styling.
 */
export function writeFooter(stdout: Writer, text: string): void {
  stdout.write(formatFooter(text));
}
