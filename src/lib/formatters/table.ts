/**
 * Generic column-based table renderer.
 *
 * Generates markdown tables and renders them through `renderMarkdown()` so
 * all list commands get consistent Unicode-bordered tables via cli-table3.
 * Pre-rendered ANSI escape codes in cell values are preserved — cli-table3
 * uses string-width which correctly treats them as zero-width.
 */

import type { Writer } from "../../types/index.js";
import { escapeMarkdownCell, renderMarkdown } from "./markdown.js";

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
  /** Minimum column width (header width is always respected) */
};

/**
 * Build a markdown table string from items and column definitions.
 *
 * Cell values are escaped via {@link escapeMarkdownCell} so pipe and
 * backslash characters in API-supplied strings don't break the table.
 * Pre-rendered ANSI codes survive the pipeline — cli-table3 uses
 * `string-width` for column width calculation.
 *
 * @param items - Row data
 * @param columns - Column definitions
 * @returns Markdown table string
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
 * Render items as a formatted table with Unicode borders.
 *
 * Column widths are auto-sized by cli-table3. Columns are defined via the
 * `columns` array; ANSI-colored cell values are preserved.
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
  stdout.write(`${renderMarkdown(buildMarkdownTable(items, columns))}\n`);
}
