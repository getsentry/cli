/**
 * Banner Formatting
 *
 * Standalone module for the Sentry ASCII banner.
 * Extracted to avoid circular imports (wizard-runner → help → app → init → wizard-runner).
 */

import chalk from "chalk";

/** ASCII art banner rows for gradient coloring */
const BANNER_ROWS = [
  "       ███████████████  ██████   █████ ████████████████ ████████   ███████",
  "      ████████████████  ███████  █████ ████████████████  ███████   ██████",
  "     ████████████████   ████████ █████ ████████████████   ███████ ███████",
  "    ██████              ██████████████ ████████████████    █████████████",
  "     █████     ███████  ██████████████     ████              ██████████",
  "     ██████    ███████  ██████████████     ████  ███████████ █████████",
  "       ██████  ████     █████ ████████     ████  ████████████  ███████",
  "       ██████  ██████   █████  ███████     ████  ████    ████  ██████",
  "  ████   █████ ██████   █████   ██████     ████  ████████████  ██████",
  "  █████  █████ ████                        ████  ██████████     █████",
  "  ████████████ ██████████████████████████  ████  ████  ████     █████",
  "   ██████████  ██████████████████████████  ████  ████  ██████   █████",
  "    ████████   ██████████████████████████  ████  █████  ██████  █████",
];

/** Purple gradient colors from bright to dark (Sentry brand-inspired) */
const BANNER_GRADIENT = [
  "#b4a4de",
  "#ab9ad7",
  "#a190d0",
  "#9886c9",
  "#8e7cc2",
  "#8572bb",
  "#7c68b4",
  "#725dad",
  "#6953a6",
  "#5f499f",
  "#563f98",
  "#4c3591",
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
