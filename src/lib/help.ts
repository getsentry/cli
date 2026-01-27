/**
 * Custom Help Output
 *
 * Provides a branded, styled help output for the CLI.
 * Intercepts --help/-h before Stricli to display custom formatting.
 */

import chalk from "chalk";
import type { Writer } from "../types/index.js";
import { cyan, magenta, muted } from "./formatters/colors.js";

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
function formatBanner(): string {
  return BANNER_ROWS.map((row, i) => chalk.hex(BANNER_GRADIENT[i])(row)).join(
    "\n"
  );
}

const TAGLINE = "The command-line interface for Sentry";

type HelpCommand = {
  usage: string;
  description: string;
};

/** Available commands with their usage patterns and descriptions */
const COMMANDS: HelpCommand[] = [
  {
    usage: "sentry auth login|logout|status",
    description: "Authenticate with Sentry",
  },
  { usage: "sentry org list|view", description: "Work with organizations" },
  { usage: "sentry project list|view", description: "Work with projects" },
  {
    usage: "sentry issue list|view|explain|plan",
    description: "Manage Sentry issues",
  },
  { usage: "sentry event view", description: "View Sentry events" },
  { usage: "sentry api <endpoint>", description: "Make API requests" },
];

const EXAMPLE = "sentry auth login";
const DOCS_URL = "https://docs.sentry.io/cli/";

/**
 * Format the command list with aligned descriptions.
 *
 * @param commands - Array of commands to format
 * @returns Formatted string with aligned columns
 */
function formatCommands(commands: HelpCommand[]): string {
  const maxUsageLength = Math.max(...commands.map((cmd) => cmd.usage.length));
  const padding = 4;

  return commands
    .map((cmd) => {
      const usagePadded = cmd.usage.padEnd(maxUsageLength + padding);
      return `    $ ${cyan(usagePadded)}${muted(cmd.description)}`;
    })
    .join("\n");
}

/**
 * Print the custom branded help output.
 *
 * @param stdout - Writer to output help text
 */
export function printCustomHelp(stdout: Writer): void {
  const lines: string[] = [];

  // Banner with gradient
  lines.push("");
  lines.push(formatBanner());

  // Tagline
  lines.push(`  ${TAGLINE}`);
  lines.push("");

  // Commands
  lines.push(formatCommands(COMMANDS));
  lines.push("");

  // Example
  lines.push(`  ${muted("try:")} ${magenta(EXAMPLE)}`);
  lines.push("");

  // Footer
  lines.push(`  ${muted(`Learn more at ${DOCS_URL}`)}`);
  lines.push("");

  stdout.write(lines.join("\n"));
}
