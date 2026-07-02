/**
 * Banner Formatting
 *
 * Standalone module for the Sentry ASCII banner.
 * Extracted to avoid circular imports (wizard-runner → help → app → init → wizard-runner).
 */

import chalk from "chalk";

/**
 * ASCII art banner rows for gradient coloring.
 *
 * The Sentry arch mark and SENTRY wordmark are transcribed from the Sentry logo
 * using quadrant block glyphs (U+2580–U+259F), which pack a 2×2 sub-cell grid per
 * character. This keeps the logo's proportions and legibility while staying narrow
 * enough (max 78 cols) to fit standard 80-column terminals.
 */
const BANNER_ROWS = [
  "         ▗▟▙             ▄███████████▌▐████▙▖ ████ ████████████ ▜█████▖ ▟████▛",
  "        ▗█▀▀█▖          ▟████████████▘▐██████▖████ ████████████  ▝█████▗████▛",
  "       ▟█▘  ▝█▄        ▝▜███▌   ▄▄▄▄▄▖▐███████████ ▀▀▜███▀▀▀▀▀▀   ▝▜███████▛",
  "       ▝▜█▖  ▝▜▙        ▝████▄  ███▛▀▘▐███████████   ▐███▌▐████████▄▛██████",
  "    ▗▟█▄ ▝▜▙▖  ▜▙▖       ▝████▙ ███▙▄ ▐████▝▜█████   ▐███▌▐███▀▀▜███ ▟████▘",
  "    █▌ ▀█▖ ▜█▖  ▜█▖   ███▖ ████▌███▛▀ ▝▀▀▀▀  ▀▀▀▀▀   ▐███▌▐███████▛▀ ▝████",
  "   ▄ ▜▙ ▝█▖ ▜▙   ▜█▖  █████████▘████████████████████▌▐███▌▐███▝███▌▖  ████",
  "  ▟█▄▄█▌ ▐█▄▟█▌ ▐██▛  ▝▜█████▛▘ ▜███████████████████▌▐███▖▐███▖▝███▙▄ ████",
];

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

/**
 * Format the banner with a vertical gradient effect.
 * Each row gets progressively darker purple.
 */
export function formatBanner(): string {
  return BANNER_ROWS.map((row, i) => {
    const color = BANNER_GRADIENT[i] ?? "#b4a4de";
    return chalk.hex(color)(row);
  }).join("\n");
}
