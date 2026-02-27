/**
 * ANSI-aware text table renderer with Unicode box-drawing borders.
 *
 * Column fitting algorithms ported from OpenTUI's TextTable.
 * Measures string widths with `string-width` (handles ANSI codes, emoji,
 * CJK characters) and wraps with `wrap-ansi` for correct ANSI sequence
 * continuation across line breaks.
 *
 * @see https://github.com/anomalyco/opentui/blob/main/packages/core/src/renderables/TextTable.ts
 */

import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import {
  type BorderCharacters,
  BorderChars,
  type BorderStyle,
} from "./border.js";

/** Column alignment. */
export type Alignment = "left" | "right" | "center";

/** Options for rendering a text table. */
export type TextTableOptions = {
  /** Border style. @default "rounded" */
  borderStyle?: BorderStyle;
  /** Column fitting strategy when table exceeds maxWidth. @default "balanced" */
  columnFitter?: "proportional" | "balanced";
  /** Horizontal cell padding (each side). @default 1 */
  cellPadding?: number;
  /** Maximum table width in columns. @default process.stdout.columns or 80 */
  maxWidth?: number;
  /** Per-column alignment (indexed by column). Defaults to "left". */
  alignments?: Array<Alignment | null>;
  /** Whether to include a separator row after the header. @default true */
  headerSeparator?: boolean;
};

/**
 * Render a text table with Unicode box-drawing borders.
 *
 * Cell values may contain ANSI escape codes — widths are computed correctly
 * via `string-width` and word wrapping preserves ANSI sequences via `wrap-ansi`.
 *
 * @param headers - Column header strings
 * @param rows - 2D array of cell values (outer = rows, inner = columns)
 * @param options - Rendering options
 * @returns Rendered table string with box-drawing borders and newline at end
 */
export function renderTextTable(
  headers: string[],
  rows: string[][],
  options: TextTableOptions = {}
): string {
  const {
    borderStyle = "rounded",
    columnFitter = "balanced",
    cellPadding = 1,
    maxWidth = process.stdout.columns || 80,
    alignments = [],
    headerSeparator = true,
  } = options;

  const border = BorderChars[borderStyle];
  const colCount = headers.length;
  if (colCount === 0) {
    return "";
  }

  // Measure intrinsic column widths from all content
  const intrinsicWidths = measureIntrinsicWidths(
    headers,
    rows,
    colCount,
    cellPadding
  );

  // Fit columns to available width
  // Border overhead: outerLeft(1) + outerRight(1) + innerSeparators(colCount-1)
  const borderOverhead = 2 + (colCount - 1);
  const maxContentWidth = Math.max(colCount, maxWidth - borderOverhead);
  const columnWidths = fitColumns(
    intrinsicWidths,
    maxContentWidth,
    cellPadding,
    columnFitter
  );

  // Build all rows (header + optional separator + data rows)
  const allRows: string[][][] = [];

  // Header row
  allRows.push(wrapRow(headers, columnWidths, cellPadding));

  // Data rows
  for (const row of rows) {
    allRows.push(wrapRow(row, columnWidths, cellPadding));
  }

  // Render the grid
  return renderGrid({
    allRows,
    columnWidths,
    alignments,
    border,
    cellPadding,
    headerSeparator,
  });
}

/**
 * Measure the intrinsic (unconstrained) width of each column.
 * Returns the maximum visual width across all rows for each column,
 * plus horizontal padding.
 */
function measureIntrinsicWidths(
  headers: string[],
  rows: string[][],
  colCount: number,
  cellPadding: number
): number[] {
  const pad = cellPadding * 2;
  const widths: number[] = [];

  for (let c = 0; c < colCount; c++) {
    // Start with header width
    let maxW = stringWidth(headers[c] ?? "") + pad;

    // Check all data rows
    for (const row of rows) {
      const cellWidth = stringWidth(row[c] ?? "") + pad;
      if (cellWidth > maxW) {
        maxW = cellWidth;
      }
    }

    // Minimum: padding + 1 char
    widths.push(Math.max(maxW, pad + 1));
  }

  return widths;
}

/**
 * Fit column widths to the available content width.
 *
 * If columns fit naturally, returns intrinsic widths.
 * If columns exceed the max, shrinks using the selected fitter.
 */
function fitColumns(
  intrinsicWidths: number[],
  maxContentWidth: number,
  cellPadding: number,
  fitter: "proportional" | "balanced"
): number[] {
  const totalIntrinsic = intrinsicWidths.reduce((s, w) => s + w, 0);

  if (totalIntrinsic <= maxContentWidth) {
    return intrinsicWidths;
  }

  if (fitter === "balanced") {
    return fitBalanced(intrinsicWidths, maxContentWidth, cellPadding);
  }
  return fitProportional(intrinsicWidths, maxContentWidth, cellPadding);
}

/**
 * Proportional column fitting: shrinks each column proportional to its
 * excess over the minimum width.
 *
 * Ported from OpenTUI's fitColumnWidthsProportional.
 */
function fitProportional(
  widths: number[],
  target: number,
  cellPadding: number
): number[] {
  const minWidth = 1 + cellPadding * 2;
  const baseWidths = widths.map((w) => Math.max(minWidth, Math.floor(w)));
  const totalBase = baseWidths.reduce((s, w) => s + w, 0);

  if (totalBase <= target) {
    return baseWidths;
  }

  const floorWidths = baseWidths.map((w) => Math.min(w, minWidth + 1));
  const floorTotal = floorWidths.reduce((s, w) => s + w, 0);
  const clampedTarget = Math.max(floorTotal, target);

  if (totalBase <= clampedTarget) {
    return baseWidths;
  }

  const shrinkable = baseWidths.map((w, i) => w - (floorWidths[i] ?? 0));
  const totalShrinkable = shrinkable.reduce((s, v) => s + v, 0);
  if (totalShrinkable <= 0) {
    return [...floorWidths];
  }

  return allocateShrink({
    baseWidths,
    floorWidths,
    shrinkable,
    targetShrink: totalBase - clampedTarget,
    mode: "linear",
  });
}

/**
 * Balanced column fitting: uses sqrt-weighted shrinking so wide columns
 * don't dominate the shrink allocation.
 *
 * Ported from OpenTUI's fitColumnWidthsBalanced.
 */
function fitBalanced(
  widths: number[],
  target: number,
  cellPadding: number
): number[] {
  const minWidth = 1 + cellPadding * 2;
  const baseWidths = widths.map((w) => Math.max(minWidth, Math.floor(w)));
  const totalBase = baseWidths.reduce((s, w) => s + w, 0);

  if (totalBase <= target) {
    return baseWidths;
  }

  const evenShare = Math.max(minWidth, Math.floor(target / baseWidths.length));
  const floorWidths = baseWidths.map((w) => Math.min(w, evenShare));
  const floorTotal = floorWidths.reduce((s, w) => s + w, 0);
  const clampedTarget = Math.max(floorTotal, target);

  if (totalBase <= clampedTarget) {
    return baseWidths;
  }

  const shrinkable = baseWidths.map((w, i) => w - (floorWidths[i] ?? 0));
  const totalShrinkable = shrinkable.reduce((s, v) => s + v, 0);
  if (totalShrinkable <= 0) {
    return [...floorWidths];
  }

  return allocateShrink({
    baseWidths,
    floorWidths,
    shrinkable,
    targetShrink: totalBase - clampedTarget,
    mode: "sqrt",
  });
}

/** Parameters for the shrink allocation algorithm. */
type ShrinkParams = {
  baseWidths: number[];
  floorWidths: number[];
  shrinkable: number[];
  targetShrink: number;
  mode: "linear" | "sqrt";
};

/**
 * Distribute shrink across columns using weighted allocation with
 * fractional remainder distribution for pixel-perfect results.
 *
 * Ported from OpenTUI's allocateShrinkByWeight.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported algorithm
function allocateShrink(params: ShrinkParams): number[] {
  const { baseWidths, floorWidths, shrinkable, targetShrink, mode } = params;
  const computeWeight = (v: number) => {
    if (v <= 0) {
      return 0;
    }
    return mode === "sqrt" ? Math.sqrt(v) : v;
  };
  const weights = shrinkable.map(computeWeight);
  const totalWeight = weights.reduce((s, v) => s + v, 0);

  if (totalWeight <= 0) {
    return [...floorWidths];
  }

  const shrink = new Array<number>(baseWidths.length).fill(0);
  const fractions = new Array<number>(baseWidths.length).fill(0);
  let usedShrink = 0;

  for (let i = 0; i < baseWidths.length; i++) {
    const s = shrinkable[i] ?? 0;
    const wt = weights[i] ?? 0;
    if (s <= 0 || wt <= 0) {
      continue;
    }
    const exact = (wt / totalWeight) * targetShrink;
    const whole = Math.min(s, Math.floor(exact));
    shrink[i] = whole;
    fractions[i] = exact - whole;
    usedShrink += whole;
  }

  // Distribute fractional remainders to columns with largest fractions
  let remaining = targetShrink - usedShrink;
  while (remaining > 0) {
    let bestIdx = -1;
    let bestFrac = -1;
    for (let i = 0; i < baseWidths.length; i++) {
      const s = shrinkable[i] ?? 0;
      const sh = shrink[i] ?? 0;
      if (s - sh <= 0) {
        continue;
      }
      const f = fractions[i] ?? 0;
      if (
        f > bestFrac ||
        (f === bestFrac && bestIdx >= 0 && s > (shrinkable[bestIdx] ?? 0))
      ) {
        bestFrac = f;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) {
      break;
    }
    shrink[bestIdx] = (shrink[bestIdx] ?? 0) + 1;
    fractions[bestIdx] = 0;
    remaining -= 1;
  }

  return baseWidths.map((w, i) =>
    Math.max(floorWidths[i] ?? 0, w - (shrink[i] ?? 0))
  );
}

/**
 * Wrap a row's cell values to their allocated column widths.
 * Returns an array of lines per cell (for multi-line rows).
 */
function wrapRow(
  cells: string[],
  columnWidths: number[],
  cellPadding: number
): string[][] {
  const wrappedCells: string[][] = [];
  for (let c = 0; c < columnWidths.length; c++) {
    const contentWidth = (columnWidths[c] ?? 3) - cellPadding * 2;
    const text = c < cells.length ? (cells[c] ?? "") : "";
    if (contentWidth <= 0) {
      wrappedCells.push([""]);
      continue;
    }
    const wrapped = wrapAnsi(text, contentWidth, { hard: true, trim: false });
    wrappedCells.push(wrapped.split("\n"));
  }
  return wrappedCells;
}

/**
 * Pad a cell value to its column width respecting alignment.
 * Uses string-width for ANSI-aware padding calculation.
 */
function padCell(
  text: string,
  width: number,
  align: Alignment,
  padding: number
): string {
  const contentWidth = width - padding * 2;
  const textWidth = stringWidth(text);
  const pad = Math.max(0, contentWidth - textWidth);
  const leftPad = " ".repeat(padding);
  const rightPad = " ".repeat(padding);

  switch (align) {
    case "right":
      return `${leftPad}${" ".repeat(pad)}${text}${rightPad}`;
    case "center": {
      const left = Math.floor(pad / 2);
      return `${leftPad}${" ".repeat(left)}${text}${" ".repeat(pad - left)}${rightPad}`;
    }
    default:
      return `${leftPad}${text}${" ".repeat(pad)}${rightPad}`;
  }
}

/** Parameters for grid rendering. */
type GridParams = {
  allRows: string[][][];
  columnWidths: number[];
  alignments: Array<Alignment | null>;
  border: BorderCharacters;
  cellPadding: number;
  headerSeparator: boolean;
};

/**
 * Render the complete table grid with borders.
 */
function renderGrid(params: GridParams): string {
  const {
    allRows,
    columnWidths,
    alignments,
    border,
    cellPadding,
    headerSeparator,
  } = params;
  const lines: string[] = [];

  const hz = border.horizontal;

  // Top border
  lines.push(
    horizontalLine(columnWidths, {
      left: border.topLeft,
      junction: border.topT,
      right: border.topRight,
      horizontal: hz,
    })
  );

  for (let r = 0; r < allRows.length; r++) {
    const wrappedCells = allRows[r] ?? [];
    const rowHeight = Math.max(1, ...wrappedCells.map((c) => c.length));

    for (let line = 0; line < rowHeight; line++) {
      const cellTexts: string[] = [];
      for (let c = 0; c < columnWidths.length; c++) {
        const cellLines = wrappedCells[c] ?? [""];
        const text = cellLines[line] ?? "";
        const align = alignments[c] ?? "left";
        const colW = columnWidths[c] ?? 3;
        cellTexts.push(padCell(text, colW, align, cellPadding));
      }
      lines.push(
        `${border.vertical}${cellTexts.join(border.vertical)}${border.vertical}`
      );
    }

    // Header separator
    if (r === 0 && headerSeparator && allRows.length > 1) {
      lines.push(
        horizontalLine(columnWidths, {
          left: border.leftT,
          junction: border.cross,
          right: border.rightT,
          horizontal: hz,
        })
      );
    }
  }

  // Bottom border
  lines.push(
    horizontalLine(columnWidths, {
      left: border.bottomLeft,
      junction: border.bottomT,
      right: border.bottomRight,
      horizontal: hz,
    })
  );

  return `${lines.join("\n")}\n`;
}

/** Build a horizontal border line from column widths and junction characters. */
function horizontalLine(
  columnWidths: number[],
  chars: { left: string; junction: string; right: string; horizontal: string }
): string {
  const segments = columnWidths.map((w) => chars.horizontal.repeat(w));
  return `${chars.left}${segments.join(chars.junction)}${chars.right}`;
}
