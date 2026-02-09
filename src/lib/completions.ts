/**
 * Shell completion script generation.
 *
 * Dynamically generates completion scripts from the Stricli route map.
 * When commands are added or removed, completions update automatically.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { routes } from "../app.js";
import type { ShellType } from "./shell.js";

/** Where completions are installed */
export type CompletionLocation = {
  /** Path where the completion file was installed */
  path: string;
  /** Whether the file was created or already existed */
  created: boolean;
};

/** A command with its description */
type CommandEntry = { name: string; brief: string };

/** A command group (route map) containing subcommands */
type CommandGroup = {
  name: string;
  brief: string;
  subcommands: CommandEntry[];
};

/** Extracted command tree from the Stricli route map */
type CommandTree = {
  /** Command groups with subcommands (auth, issue, org, etc.) */
  groups: CommandGroup[];
  /** Standalone top-level commands (api, help, version, etc.) */
  standalone: CommandEntry[];
};

/**
 * Check if a routing target is a route map (has subcommands).
 *
 * Stricli route maps have an `getAllEntries()` method while commands don't.
 */
function isRouteMap(target: unknown): target is {
  getAllEntries: () => readonly {
    name: Record<string, string>;
    target: { brief: string };
    hidden: boolean;
  }[];
} & {
  brief: string;
} {
  return (
    typeof target === "object" &&
    target !== null &&
    typeof (target as Record<string, unknown>).getAllEntries === "function"
  );
}

/**
 * Extract the command tree from the Stricli route map.
 *
 * Walks the route map recursively to build a structured command tree
 * that can be used to generate completion scripts for any shell.
 */
export function extractCommandTree(): CommandTree {
  const groups: CommandGroup[] = [];
  const standalone: CommandEntry[] = [];

  for (const entry of routes.getAllEntries()) {
    const name = entry.name.original;
    if (entry.hidden) {
      continue;
    }

    if (isRouteMap(entry.target)) {
      const subcommands: CommandEntry[] = [];
      for (const sub of entry.target.getAllEntries()) {
        if (!sub.hidden) {
          subcommands.push({
            name: sub.name.original,
            brief: sub.target.brief,
          });
        }
      }
      groups.push({ name, brief: entry.target.brief, subcommands });
    } else {
      standalone.push({ name, brief: entry.target.brief });
    }
  }

  return { groups, standalone };
}

/**
 * Generate bash completion script.
 */
export function generateBashCompletion(binaryName: string): string {
  const { groups, standalone } = extractCommandTree();

  const allTopLevel = [
    ...groups.map((g) => g.name),
    ...standalone.map((s) => s.name),
  ];

  // Build subcommand variables
  const subVars = groups
    .map((g) => {
      const subs = g.subcommands.map((s) => s.name).join(" ");
      return `  local ${g.name}_commands="${subs}"`;
    })
    .join("\n");

  // Build case branches for subcommand completion
  const caseBranches = groups
    .map(
      (g) =>
        `        ${g.name})\n          COMPREPLY=($(compgen -W "\${${g.name}_commands}" -- "\${cur}"))\n          ;;`
    )
    .join("\n");

  return `# bash completion for ${binaryName}
# Auto-generated from command definitions
_${binaryName}_completions() {
  local cur prev words cword
  _init_completion || return

  local commands="${allTopLevel.join(" ")}"
${subVars}

  case "\${COMP_CWORD}" in
    1)
      COMPREPLY=($(compgen -W "\${commands}" -- "\${cur}"))
      ;;
    2)
      case "\${prev}" in
${caseBranches}
      esac
      ;;
  esac
}

complete -F _${binaryName}_completions ${binaryName}
`;
}

/**
 * Generate zsh completion script.
 */
export function generateZshCompletion(binaryName: string): string {
  const { groups, standalone } = extractCommandTree();

  // Build top-level commands array
  const topLevelItems = [
    ...groups.map((g) => `    '${g.name}:${g.brief}'`),
    ...standalone.map((s) => `    '${s.name}:${s.brief}'`),
  ].join("\n");

  // Build subcommand arrays
  const subArrays = groups
    .map((g) => {
      const items = g.subcommands
        .map((s) => `    '${s.name}:${s.brief}'`)
        .join("\n");
      return `  local -a ${g.name}_commands\n  ${g.name}_commands=(\n${items}\n  )`;
    })
    .join("\n\n");

  // Build case branches
  const caseBranches = groups
    .map(
      (g) =>
        `        ${g.name})\n          _describe -t commands '${g.name} command' ${g.name}_commands\n          ;;`
    )
    .join("\n");

  return `#compdef ${binaryName}
# zsh completion for ${binaryName}
# Auto-generated from command definitions

_${binaryName}() {
  local -a commands
  commands=(
${topLevelItems}
  )

${subArrays}

  _arguments -C \\
    '1: :->command' \\
    '2: :->subcommand' \\
    '*::arg:->args'

  case "$state" in
    command)
      _describe -t commands 'command' commands
      ;;
    subcommand)
      case "$words[1]" in
${caseBranches}
      esac
      ;;
  esac
}

_${binaryName}
`;
}

/**
 * Generate fish completion script.
 */
export function generateFishCompletion(binaryName: string): string {
  const { groups, standalone } = extractCommandTree();

  // Top-level command completions
  const topLevelLines = [
    ...groups.map(
      (g) =>
        `complete -c ${binaryName} -n "__fish_use_subcommand" -a "${g.name}" -d "${g.brief}"`
    ),
    ...standalone.map(
      (s) =>
        `complete -c ${binaryName} -n "__fish_use_subcommand" -a "${s.name}" -d "${s.brief}"`
    ),
  ].join("\n");

  // Subcommand completions
  const subLines = groups
    .map((g) => {
      const lines = g.subcommands
        .map(
          (s) =>
            `complete -c ${binaryName} -n "__fish_seen_subcommand_from ${g.name}" -a "${s.name}" -d "${s.brief}"`
        )
        .join("\n");
      return `\n# ${g.name} subcommands\n${lines}`;
    })
    .join("\n");

  return `# fish completion for ${binaryName}
# Auto-generated from command definitions

# Disable file completion by default
complete -c ${binaryName} -f

# Top-level commands
${topLevelLines}
${subLines}
`;
}

/**
 * Get the completion script for a shell type.
 */
export function getCompletionScript(
  shellType: ShellType,
  binaryName = "sentry"
): string | null {
  switch (shellType) {
    case "bash":
      return generateBashCompletion(binaryName);
    case "zsh":
      return generateZshCompletion(binaryName);
    case "fish":
      return generateFishCompletion(binaryName);
    default:
      return null;
  }
}

/**
 * Get the default completion file path for a shell type.
 *
 * @param shellType - The shell type
 * @param homeDir - User's home directory
 * @param xdgDataHome - XDG_DATA_HOME or undefined for default
 */
export function getCompletionPath(
  shellType: ShellType,
  homeDir: string,
  xdgDataHome?: string
): string | null {
  const dataHome = xdgDataHome || join(homeDir, ".local", "share");

  switch (shellType) {
    case "bash":
      // bash-completion user directory
      return join(dataHome, "bash-completion", "completions", "sentry");

    case "zsh":
      // Site-functions in user's local share
      return join(dataHome, "zsh", "site-functions", "_sentry");

    case "fish":
      // Fish completions directory
      return join(homeDir, ".config", "fish", "completions", "sentry.fish");

    default:
      return null;
  }
}

/**
 * Install completion script for a shell type.
 *
 * @param shellType - The shell type
 * @param homeDir - User's home directory
 * @param xdgDataHome - XDG_DATA_HOME or undefined for default
 * @returns Location info if installed, null if shell not supported
 */
export async function installCompletions(
  shellType: ShellType,
  homeDir: string,
  xdgDataHome?: string
): Promise<CompletionLocation | null> {
  const script = getCompletionScript(shellType);
  if (!script) {
    return null;
  }

  const path = getCompletionPath(shellType, homeDir, xdgDataHome);
  if (!path) {
    return null;
  }

  // Create directory if needed
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o755 });
  }

  const alreadyExists = existsSync(path);
  await Bun.write(path, script);

  return {
    path,
    created: !alreadyExists,
  };
}
