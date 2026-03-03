/**
 * Banner Formatting
 *
 * Standalone module for the Sentry ASCII banner.
 * Extracted to avoid circular imports (wizard-runner → help → app → init → wizard-runner).
 */

import chalk from "chalk";

/** ASCII art banner rows for gradient coloring */
const BANNER_ROWS = [
  "  ███████╗███████╗███╗   ██╗████████╗██████╗ ██╗   ██╗",
  "  ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗╚██╗ ██╔╝",
  "  ███████╗█████╗  ██╔██╗ ██║   ██║   ██████╔╝ ╚████╔╝ ",
  "  ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██╔══██╗  ╚██╔╝  ",
  "  ███████║███████╗██║ ╚████║   ██║   ██║  ██║   ██║   ",
  "  ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ",
];

/** Purple gradient colors from bright to dark (Sentry brand-inspired) */
const BANNER_GRADIENT = [
  "#B4A4DE",
  "#9C84D4",
  "#8468C8",
  "#6C4EBA",
  "#5538A8",
  "#432B8A",
];

/**
 * Format the banner with a vertical gradient effect.
 * Each row gets progressively darker purple.
 */
export function formatBanner(): string {
  return BANNER_ROWS.map((row, i) => {
    const color = BANNER_GRADIENT[i] ?? "#B4A4DE";
    return chalk.hex(color)(row);
  }).join("\n");
}
