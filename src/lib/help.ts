/**
 * Custom Help Output
 *
 * Provides a branded, styled help output for the CLI.
 * Shows custom formatting when running `sentry` with no arguments.
 * Commands are auto-generated from Stricli's route structure.
 */

import chalk from "chalk";
import { routes } from "../app.js";
import type { Writer } from "../types/index.js";
import { isAuthenticated } from "./config.js";
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
  return BANNER_ROWS.map((row, i) => {
    const color = BANNER_GRADIENT[i] ?? "#B4A4DE";
    return chalk.hex(color)(row);
  }).join("\n");
}

const TAGLINE = "The command-line interface for Sentry";

type HelpCommand = {
  usage: string;
  description: string;
};

/**
 * Type guard to check if a routing target is a RouteMap (has subcommands).
 * RouteMap has getAllEntries(), Command does not.
 */
function isRouteMap(
  target: unknown
): target is { getAllEntries: () => RouteMapEntry[]; brief: string } {
  return (
    typeof target === "object" &&
    target !== null &&
    "getAllEntries" in target &&
    typeof (target as { getAllEntries: unknown }).getAllEntries === "function"
  );
}

/** Minimal type for route map entries returned by getAllEntries() */
type RouteMapEntry = {
  name: { original: string };
  target: { brief: string };
  hidden: boolean;
};

/** Minimal type for positional parameter with optional placeholder */
type PositionalParam = { placeholder?: string };

/** Stricli positional parameters structure */
type PositionalParams =
  | { kind: "tuple"; parameters: PositionalParam[] }
  | { kind: "array"; parameter: PositionalParam };

/**
 * Type guard to check if a target is a Command (has parameters).
 */
function isCommand(target: unknown): target is {
  brief: string;
  parameters: { positional?: PositionalParams };
} {
  return (
    typeof target === "object" &&
    target !== null &&
    "parameters" in target &&
    !("getAllEntries" in target)
  );
}

/**
 * Extract placeholder text from a command's positional parameters.
 * Returns placeholders like "<endpoint>" or defaults to "<...>".
 */
function getPositionalPlaceholder(target: unknown): string {
  if (!isCommand(target)) {
    return "<...>";
  }

  const positional = target.parameters.positional;
  if (!positional) {
    return "";
  }

  if (positional.kind === "tuple" && positional.parameters.length > 0) {
    // Get placeholders from tuple parameters, default to "arg" if not specified
    const placeholders = positional.parameters.map(
      (p, i) => `<${p.placeholder ?? `arg${i}`}>`
    );
    return placeholders.join(" ");
  }

  if (positional.kind === "array") {
    const placeholder = positional.parameter.placeholder ?? "args";
    return `<${placeholder}...>`;
  }

  return "<...>";
}

/**
 * Generate the commands list dynamically from Stricli's route structure.
 * This ensures help text stays in sync with actual registered commands.
 */
function generateCommands(): HelpCommand[] {
  const entries = routes.getAllEntries();

  return entries
    .filter((entry: RouteMapEntry) => !entry.hidden)
    .map((entry: RouteMapEntry) => {
      const routeName = entry.name.original;
      const brief = entry.target.brief;

      if (isRouteMap(entry.target)) {
        // Get visible subcommand names and join with pipes
        const subEntries = entry.target
          .getAllEntries()
          .filter((sub: RouteMapEntry) => !sub.hidden);
        const subNames = subEntries
          .map((sub: RouteMapEntry) => sub.name.original)
          .join(" | ");
        return {
          usage: `sentry ${routeName} ${subNames}`,
          description: brief,
        };
      }

      // Direct command - extract placeholder from positional parameters
      const placeholder = getPositionalPlaceholder(entry.target);
      const usageSuffix = placeholder ? ` ${placeholder}` : "";
      return {
        usage: `sentry ${routeName}${usageSuffix}`,
        description: brief,
      };
    });
}

const EXAMPLE_LOGGED_OUT = "sentry auth login";
const EXAMPLE_LOGGED_IN = "sentry issue list";
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
 * Shows a contextual example based on authentication status.
 *
 * @param stdout - Writer to output help text
 */
export async function printCustomHelp(stdout: Writer): Promise<void> {
  const loggedIn = await isAuthenticated();
  const example = loggedIn ? EXAMPLE_LOGGED_IN : EXAMPLE_LOGGED_OUT;

  const lines: string[] = [];

  // Banner with gradient
  lines.push("");
  lines.push(formatBanner());
  lines.push("");

  // Tagline
  lines.push(`  ${TAGLINE}`);
  lines.push("");

  // Commands (auto-generated from Stricli routes)
  lines.push(formatCommands(generateCommands()));
  lines.push("");

  // Example
  lines.push(`  ${muted("try:")} ${magenta(example)}`);
  lines.push("");

  // Footer
  lines.push(`  ${muted(`Learn more at ${DOCS_URL}`)}`);
  lines.push("");
  lines.push("");

  stdout.write(lines.join("\n"));
}
