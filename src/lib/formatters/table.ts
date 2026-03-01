/**
 * Generic column-based table renderer.
 *
 * Provides `writeTable()` for rendering structured data as Unicode-bordered
 * tables directly via the text-table renderer, and `buildMarkdownTable()`
 * for producing raw CommonMark table syntax (used in plain/non-TTY mode).
 *
 * ANSI escape codes in cell values are preserved — `string-width` correctly
 * treats them as zero-width for column sizing.
 */

import type { Writer } from "../../types/index.js";
import {
  escapeMarkdownCell,
  isPlainOutput,
  renderInlineMarkdown,
  stripColorTags,
} from "./markdown.js";
import { type Alignment, renderTextTable } from "./text-table.js";

/**
 * Describes a single column in a table.
 *
 * @template T - Row data type
 */
export type Column<T> = {
  /** Column header label (e.g., "ORG", "SLUG") */
  header: string;
  /** Extract the display value from a row */
  value: (item: T) => string;
  /** Column alignment. Defaults to "left". */
  align?: "left" | "right";
  /** Minimum content width. Column will not shrink below this. */
  minWidth?: number;
  /** Whether this column can be shrunk when the table exceeds terminal width. @default true */
  shrinkable?: boolean;
  /** Truncate long values with "\u2026" instead of wrapping. @default false */
  truncate?: boolean;
};

/**
 * Build a raw CommonMark table string from items and column definitions.
 *
 * Column value functions should call {@link escapeMarkdownCell} on user data so pipe and
 * backslash characters in API-supplied strings don't break the table.
 *
 * Used for plain/non-TTY output mode.
 */
export function buildMarkdownTable<T>(
  items: T[],
  columns: Column<T>[]
): string {
  const header = `| ${columns.map((c) => c.header).join(" | ")} |`;
  const separator = `| ${columns.map((c) => (c.align === "right" ? "---:" : "---")).join(" | ")} |`;
  const rows = items
    .map(
      (item) =>
        `| ${columns.map((c) => stripColorTags(c.value(item))).join(" | ")} |`
    )
    .join("\n");
  return `${header}\n${separator}\n${rows}`;
}

/**
 * Render items as a formatted table.
 *
 * Cell values are markdown strings — in TTY mode they are rendered through
 * \ before column sizing, so \,
 * \code\, and \ in cell values render as styled/clickable text.
 * Pre-existing ANSI codes (e.g. chalk colors) pass through the markdown
 * parser untouched.
 *
 * In plain mode: emits raw CommonMark table syntax.
 *
 * @param stdout - Output writer
 * @param items - Row data
 * @param columns - Column definitions (ordering determines display order)
 */
/** Options for writeTable. */
export type WriteTableOptions = {
  /** Truncate cells to one line with "\u2026" instead of wrapping. @default false */
  truncate?: boolean;
};

export function writeTable<T>(
  stdout: Writer,
  items: T[],
  columns: Column<T>[],
  options?: WriteTableOptions
): void {
  if (isPlainOutput()) {
    stdout.write(`${buildMarkdownTable(items, columns)}\n`);
    return;
  }

  const headers = columns.map((c) => c.header);
  const rows = items.map((item) =>
    columns.map((c) => renderInlineMarkdown(c.value(item)))
  );
  const alignments: Alignment[] = columns.map((c) => c.align ?? "left");

  const minWidths = columns.map((c) => c.minWidth ?? 0);
  const shrinkable = columns.map((c) => c.shrinkable ?? true);

  stdout.write(
    renderTextTable(headers, rows, {
      alignments,
      minWidths,
      shrinkable,
      truncate: options?.truncate,
    })
  );
}
