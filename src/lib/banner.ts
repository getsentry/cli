/**
 * Banner Formatting
 *
 * Standalone module for the Sentry ASCII banner.
 * Extracted to avoid circular imports (wizard-runner → help → app → init → wizard-runner).
 *
 * The banner is responsive: it renders the widest variant that fits the terminal
 * so it never wraps (which looks broken on narrow/split-pane terminals).
 */

import chalk from "chalk";

/**
 * Full banner: Sentry arch mark + SENTRY wordmark, transcribed from the Sentry
 * logo using quadrant block glyphs (U+2580–U+259F). Max width 78 cols.
 */
const BANNER_ROWS_FULL = [
  "         ▗▟▙             ▄███████████▌▐█████▖ ███▌█████████████▝▜█████▖▗▄████▛",
  "        ▗█▀▀█▖          ▐████████████ ▐██████ ███▌█████████████ ▐██████▐█████",
  "       ▟█▘  ▝█▄        ▐████▌   ▄▄▄▄▄▄▐██████████▌ ▀▀▜███▀▀▀▀▀▀   ▝████████▛",
  "       ▝▜█▖  ▝▜▙        ▝████▄  ███▀▀▀▐███▛▜█████▌   ▐███ ▐████████▙▀▜████▛",
  "    ▗▟█▄ ▝▜▙▖  ▜▙▖        ████▌ █████ ▐███▌ █████▌   ▐███ ▐███  ▐███▌▐████",
  "    █▌ ▀█▖ ▜█▖  ▜█▖   ███▌ ████ ███▀▀ ▝▀▀▀▘  ▀▀▀▀▘   ▐███ ▐████████▀ ▐████",
  "   ▄ ▜▙ ▝█▖ ▜▙   ▜█▖  ▜████████ ████████████████████▌▐███ ▐███▌▜██▙▖  ████▖",
  "  ▟█▄▄█▌ ▐█▄▟█▌ ▐██▛  ▝▜██████▀ ████████████████████▌▐███ ▐███▌▝███▙▖ ████▌",
];

/**
 * Fallback banner for narrower terminals: the SENTRY wordmark without the arch
 * mark. Max width 58 cols.
 */
const BANNER_ROWS_WORDMARK = [
  "     ▄███████████▌▐█████▖ ███▌█████████████▝▜█████▖▗▄████▛",
  "    ▐████████████ ▐██████ ███▌█████████████ ▐██████▐█████",
  "   ▐████▌   ▄▄▄▄▄▄▐██████████▌ ▀▀▜███▀▀▀▀▀▀   ▝████████▛",
  "    ▝████▄  ███▀▀▀▐███▛▜█████▌   ▐███ ▐████████▙▀▜████▛",
  "      ████▌ █████ ▐███▌ █████▌   ▐███ ▐███  ▐███▌▐████",
  "  ███▌ ████ ███▀▀ ▝▀▀▀▘  ▀▀▀▀▘   ▐███ ▐████████▀ ▐████",
  "  ▜████████ ████████████████████▌▐███ ▐███▌▜██▙▖  ████▖",
  "  ▝▜██████▀ ████████████████████▌▐███ ▐███▌▝███▙▖ ████▌",
];

/** One-line text mark for terminals too narrow for any block art. */
const BANNER_TEXT = "sentry";

/** Minimum columns required to render each variant without wrapping. */
const FULL_WIDTH = 78;
const WORDMARK_WIDTH = 58;

/** Purple gradient colors from bright to dark (Sentry brand-inspired) */
const BANNER_GRADIENT = [
  "#b4a4de",
  "#a493d2",
  "#9481c6",
  "#8470ba",
  "#735fae",
  "#634ea2",
  "#533c96",
  "#432b8a",
];

/** A single banner row paired with its gradient color. */
export type BannerLine = { content: string; color: string };

/**
 * Pair each art row with its gradient color. Rows beyond the gradient length
 * reuse the first (brightest) color; the gradient always matches the 8-row art.
 */
function colorize(rows: readonly string[]): BannerLine[] {
  return rows.map((content, i) => ({
    content,
    color: BANNER_GRADIENT[i] ?? BANNER_GRADIENT[0] ?? "#b4a4de",
  }));
}

/**
 * Widest display width (in code points) among a set of banner lines.
 * Used to decide whether a pre-built banner fits the current terminal.
 */
export function bannerLinesWidth(lines: readonly BannerLine[]): number {
  let max = 0;
  for (const { content } of lines) {
    const width = [...content].length;
    if (width > max) {
      max = width;
    }
  }
  return max;
}

/**
 * Select the widest banner variant that fits within `columns`:
 * - `>= 78` cols → full arch mark + wordmark
 * - `>= 58` cols → wordmark only
 * - `>= 6` cols → compact "sentry" text mark
 * - otherwise → no banner (empty)
 *
 * This guarantees the banner never exceeds the terminal width, so it never
 * wraps into a broken layout on narrow or split-pane terminals.
 */
export function bannerLinesForWidth(columns: number): BannerLine[] {
  if (columns >= FULL_WIDTH) {
    return colorize(BANNER_ROWS_FULL);
  }
  if (columns >= WORDMARK_WIDTH) {
    return colorize(BANNER_ROWS_WORDMARK);
  }
  if (columns >= BANNER_TEXT.length) {
    return [{ content: BANNER_TEXT, color: BANNER_GRADIENT[0] ?? "#b4a4de" }];
  }
  return [];
}

/**
 * Format the banner with a vertical gradient effect, sized to fit `columns`
 * (defaults to the current terminal width) so it never wraps. Returns an empty
 * string when the terminal is too narrow for even the text mark.
 */
export function formatBanner(
  columns: number = process.stdout.columns ?? 80
): string {
  return bannerLinesForWidth(columns)
    .map(({ content, color }) => chalk.hex(color)(content))
    .join("\n");
}
