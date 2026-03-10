/**
 * Shared output utilities
 *
 * Handles the common pattern of JSON vs human-readable output
 * that appears in most CLI commands.
 */

import type { Writer } from "../../types/index.js";
import { muted } from "./colors.js";
import { writeJson } from "./json.js";

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
  /** Optional source description if data was auto-detected */
  detectedFrom?: string;
  /** Footer hint shown after human output (suppressed in JSON mode) */
  footer?: string;
};

/**
 * Options for {@link writeOutput} when JSON needs a different data shape.
 *
 * Some commands build a richer or narrower object for JSON than the one
 * the human formatter receives. Supply `jsonData` to decouple the two.
 *
 * @typeParam T - Type of data used by the human formatter
 * @typeParam J - Type of data serialized to JSON (defaults to T)
 */
type WriteOutputDivergentOptions<T, J> = WriteOutputOptions<T> & {
  /**
   * Separate data object to serialize when `json: true`.
   * When provided, `data` is only used by `formatHuman` and
   * `jsonData` is passed to `writeJson`.
   */
  jsonData: J;
};

/**
 * Write formatted output to stdout based on output format.
 *
 * Handles the common JSON-vs-human pattern used across commands:
 * - JSON mode: serialize data (or `jsonData` if provided) with optional field filtering
 * - Human mode: call `formatHuman`, then optionally print `detectedFrom` and `footer`
 *
 * When JSON and human paths need different data shapes, pass `jsonData`:
 * ```ts
 * writeOutput(stdout, fullUser, {
 *   json: true,
 *   jsonData: { id: fullUser.id, email: fullUser.email },
 *   formatHuman: formatUserIdentity,
 * });
 * ```
 */
export function writeOutput<T, J = T>(
  stdout: Writer,
  data: T,
  options: WriteOutputOptions<T> | WriteOutputDivergentOptions<T, J>
): void {
  if (options.json) {
    const jsonPayload = "jsonData" in options ? options.jsonData : data;
    writeJson(stdout, jsonPayload, options.fields);
    return;
  }

  const text = options.formatHuman(data);
  stdout.write(`${text}\n`);

  if (options.detectedFrom) {
    stdout.write(`\nDetected from ${options.detectedFrom}\n`);
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
