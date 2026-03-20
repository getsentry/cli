/**
 * Custom Help Output
 *
 * Provides a branded, styled help output for the CLI.
 * Shows custom formatting when running `sentry` with no arguments.
 * Commands are auto-generated from Stricli's route structure.
 */

import { routes } from "../app.js";
import { formatBanner } from "./banner.js";
import { isAuthenticated } from "./db/auth.js";
import { cyan, magenta, muted } from "./formatters/colors.js";
import {
  type CommandInfo,
  extractAllRoutes,
  getPositionalString,
  isCommand,
  isRouteMap,
  type RouteInfo,
  type RouteMap,
  type RouteMapEntry,
  resolveCommandPath,
} from "./introspect.js";

const TAGLINE = "The command-line interface for Sentry";

type HelpCommand = {
  usage: string;
  description: string;
};

/**
 * Generate the commands list dynamically from Stricli's route structure.
 * This ensures help text stays in sync with actual registered commands.
 */
function generateCommands(): HelpCommand[] {
  // Cast to our introspection types — Stricli's generic types are compatible
  const routeMap = routes as unknown as RouteMap;
  const entries = routeMap.getAllEntries();

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
      if (isCommand(entry.target)) {
        const placeholder = getPositionalString(
          entry.target.parameters.positional
        );
        const usageSuffix = placeholder ? ` ${placeholder}` : "";
        return {
          usage: `sentry ${routeName}${usageSuffix}`,
          description: brief,
        };
      }

      return {
        usage: `sentry ${routeName}`,
        description: brief,
      };
    });
}

const EXAMPLE_LOGGED_OUT = "sentry auth login";
const EXAMPLE_LOGGED_IN = "sentry issue list";
const DOCS_URL = "https://cli.sentry.dev/getting-started/";

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
 * Build the custom branded help output string.
 * Shows a contextual example based on authentication status.
 */
export async function printCustomHelp(): Promise<string> {
  const loggedIn = await isAuthenticated();
  const example = loggedIn ? EXAMPLE_LOGGED_IN : EXAMPLE_LOGGED_OUT;

  const lines: string[] = [];

  // Banner with gradient (only in interactive terminals)
  if (process.stdout.isTTY) {
    lines.push("");
    lines.push(formatBanner());
    lines.push("");
  }

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

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Introspection (for `sentry help --json` and human rendering)
// ---------------------------------------------------------------------------

/**
 * Result of introspecting the CLI.
 * Yielded as CommandOutput — JSON mode serializes directly, human mode
 * passes through {@link formatHelpHuman}.
 *
 * `_banner` is an internal field for human display of the full tree;
 * it's stripped from JSON output via `jsonExclude`.
 */
export type HelpJsonResult =
  | ({ routes: RouteInfo[] } & { _banner?: string })
  | CommandInfo
  | RouteInfo
  | { error: string };

/**
 * Introspect the full command tree.
 * Returns all visible routes with all flags included.
 */
export function introspectAllCommands(): { routes: RouteInfo[] } {
  const routeMap = routes as unknown as RouteMap;
  return { routes: extractAllRoutes(routeMap) };
}

/**
 * Introspect a specific command or group.
 * Returns the resolved command/group info, or an error object
 * if the path doesn't resolve.
 */
export function introspectCommand(
  commandPath: string[]
): CommandInfo | RouteInfo | { error: string } {
  const routeMap = routes as unknown as RouteMap;
  const resolved = resolveCommandPath(routeMap, commandPath);
  if (!resolved) {
    return { error: `Command not found: ${commandPath.join(" ")}` };
  }
  return resolved.info;
}

// ---------------------------------------------------------------------------
// Human Rendering of Introspection Data
// ---------------------------------------------------------------------------

/**
 * Format a single flag for human display.
 *
 * @param flag - The flag info to format
 * @param aliases - Command alias map for short flag lookup
 * @returns Formatted flag string like "-l, --limit <value> - Max items"
 */
function formatFlagHuman(
  flag: import("./introspect.js").FlagInfo,
  aliases: Record<string, string>
): string {
  const alias = Object.entries(aliases).find(([, v]) => v === flag.name)?.[0];
  let syntax = `--${flag.name}`;
  if (alias) {
    syntax = `-${alias}, ${syntax}`;
  }
  if ((flag.kind === "parsed" || flag.kind === "enum") && !flag.variadic) {
    syntax += " <value>";
  } else if (flag.variadic) {
    syntax += " <value>...";
  }
  const parts = [syntax];
  if (flag.brief) {
    parts.push(flag.brief);
  }
  if (flag.default !== undefined && flag.kind !== "boolean") {
    parts.push(`(default: ${JSON.stringify(flag.default)})`);
  }
  return parts.join(" — ");
}

/**
 * Format a CommandInfo as human-readable text.
 */
function formatCommandHuman(cmd: CommandInfo): string {
  const lines: string[] = [];
  const signature = cmd.positional ? `${cmd.path} ${cmd.positional}` : cmd.path;
  lines.push(signature);
  lines.push("");
  lines.push(`  ${cmd.brief}`);

  const visibleFlags = cmd.flags.filter((f) => !f.hidden);
  if (visibleFlags.length > 0) {
    lines.push("");
    lines.push("  Flags:");
    for (const flag of visibleFlags) {
      lines.push(`    ${formatFlagHuman(flag, cmd.aliases)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a RouteInfo group as human-readable text.
 */
function formatGroupHuman(group: RouteInfo): string {
  const lines: string[] = [];
  lines.push(`sentry ${group.name}`);
  lines.push("");
  lines.push(`  ${group.brief}`);
  lines.push("");
  lines.push("  Commands:");

  if (group.commands.length === 0) {
    lines.push("    (no commands)");
    return lines.join("\n");
  }

  const maxName = Math.max(
    ...group.commands.map((c) => (c.path.split(" ").at(-1) ?? "").length)
  );
  for (const cmd of group.commands) {
    const name = cmd.path.split(" ").at(-1) ?? "";
    lines.push(`    ${name.padEnd(maxName + 2)}${cmd.brief}`);
  }

  return lines.join("\n");
}

/**
 * Human renderer for help introspection data.
 *
 * Formats structured introspection objects as readable CLI output:
 * - Full tree with `_banner`: renders the branded banner
 * - Route group: lists subcommands with descriptions
 * - Single command: shows signature, description, and flags
 * - Error: shows the error message
 */
export function formatHelpHuman(data: HelpJsonResult): string {
  // Full tree with pre-rendered banner
  if ("_banner" in data && typeof data._banner === "string") {
    return data._banner.trimEnd();
  }

  // Route group
  if ("commands" in data && "name" in data) {
    return formatGroupHuman(data as RouteInfo);
  }

  // Single command
  if ("path" in data) {
    return formatCommandHuman(data as CommandInfo);
  }

  // Error
  if ("error" in data) {
    return `Error: ${data.error}`;
  }

  // Full tree without banner (shouldn't happen in practice)
  if ("routes" in data) {
    return data.routes.map(formatGroupHuman).join("\n\n");
  }

  return "";
}
