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
};

/**
 * Build a raw CommonMark table string from items and column definitions.
 *
 * Cell values are escaped via {@link escapeMarkdownCell} so pipe and
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
        `| ${columns.map((c) => escapeMarkdownCell(c.value(item))).join(" | ")} |`
    )
    .join("\n");
  return `${header}\n${separator}\n${rows}`;
}

/**
 * Render items as a formatted table.
 *
 * In TTY mode: renders directly via text-table with Unicode box borders.
 * In plain mode: emits raw CommonMark table syntax.
 *
 * @param stdout - Output writer
 * @param items - Row data
 * @param columns - Column definitions (ordering determines display order)
 */
export function writeTable<T>(
  stdout: Writer,
  items: T[],
  columns: Column<T>[]
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

  stdout.write(renderTextTable(headers, rows, { alignments }));
}
