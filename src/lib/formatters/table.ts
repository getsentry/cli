/**
 * Generic column-based table renderer.
 *
 * Replaces the duplicated calculateColumnWidths / writeHeader / writeRows
 * pattern used across team, repo, and project list commands.
 */

import type { Writer } from "../../types/index.js";

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
  minWidth?: number;
};

/**
 * Render items as a formatted table with auto-sized columns.
 *
 * Column widths are computed as `max(header.length, minWidth, longestValue)`.
 * Columns are separated by two spaces. No trailing separator after the last column.
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
  // Pre-compute widths
  const widths = columns.map((col) => {
    const headerLen = col.header.length;
    const minLen = col.minWidth ?? 0;
    const maxValue = items.reduce(
      (max, item) => Math.max(max, col.value(item).length),
      0
    );
    return Math.max(headerLen, minLen, maxValue);
  });

  // Header row
  const headerCells = columns.map((col, i) =>
    pad(col.header, widths[i] as number, col.align)
  );
  stdout.write(`${headerCells.join("  ")}\n`);

  // Data rows
  for (const item of items) {
    const cells = columns.map((col, i) =>
      pad(col.value(item), widths[i] as number, col.align)
    );
    stdout.write(`${cells.join("  ")}\n`);
  }
}

/** Pad a string to width with the given alignment. */
function pad(
  value: string,
  width: number,
  align: "left" | "right" = "left"
): string {
  return align === "right" ? value.padStart(width) : value.padEnd(width);
}
