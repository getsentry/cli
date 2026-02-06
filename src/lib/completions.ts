/**
 * Shell completion script generation.
 *
 * Generates completion scripts for bash, zsh, and fish shells.
 * These scripts enable tab-completion for sentry CLI commands.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ShellType } from "./shell.js";

/** Where completions are installed */
export type CompletionLocation = {
  /** Path where the completion file was installed */
  path: string;
  /** Whether the file was created or already existed */
  created: boolean;
};

/**
 * Generate bash completion script.
 */
export function generateBashCompletion(binaryName: string): string {
  return `# bash completion for ${binaryName}
# Install: ${binaryName} cli setup
_${binaryName}_completions() {
  local cur prev words cword
  _init_completion || return

  local commands="auth api event issue org project cli help version"
  local auth_commands="login logout status refresh"
  local cli_commands="feedback fix setup upgrade"
  local event_commands="view"
  local issue_commands="list view explain plan"
  local org_commands="list view"
  local project_commands="list view"

  case "\${COMP_CWORD}" in
    1)
      COMPREPLY=($(compgen -W "\${commands}" -- "\${cur}"))
      ;;
    2)
      case "\${prev}" in
        auth)
          COMPREPLY=($(compgen -W "\${auth_commands}" -- "\${cur}"))
          ;;
        cli)
          COMPREPLY=($(compgen -W "\${cli_commands}" -- "\${cur}"))
          ;;
        event)
          COMPREPLY=($(compgen -W "\${event_commands}" -- "\${cur}"))
          ;;
        issue)
          COMPREPLY=($(compgen -W "\${issue_commands}" -- "\${cur}"))
          ;;
        org)
          COMPREPLY=($(compgen -W "\${org_commands}" -- "\${cur}"))
          ;;
        project)
          COMPREPLY=($(compgen -W "\${project_commands}" -- "\${cur}"))
          ;;
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
  return `#compdef ${binaryName}
# zsh completion for ${binaryName}
# Install: ${binaryName} cli setup

_${binaryName}() {
  local -a commands
  commands=(
    'auth:Authentication commands'
    'api:Make authenticated API requests'
    'event:Event-related commands'
    'issue:Issue-related commands'
    'org:Organization commands'
    'project:Project commands'
    'cli:CLI management commands'
    'help:Show help'
    'version:Show version'
  )

  local -a auth_commands
  auth_commands=(
    'login:Authenticate with Sentry'
    'logout:Clear stored credentials'
    'status:Check authentication status'
    'refresh:Refresh access token'
  )

  local -a cli_commands
  cli_commands=(
    'feedback:Send feedback'
    'fix:Repair local database'
    'setup:Configure shell integration'
    'upgrade:Upgrade to latest version'
  )

  local -a issue_commands
  issue_commands=(
    'list:List issues'
    'view:View issue details'
    'explain:AI explanation of issue'
    'plan:AI fix plan for issue'
  )

  local -a org_commands
  org_commands=(
    'list:List organizations'
    'view:View organization details'
  )

  local -a project_commands
  project_commands=(
    'list:List projects'
    'view:View project details'
  )

  local -a event_commands
  event_commands=(
    'view:View event details'
  )

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
        auth)
          _describe -t commands 'auth command' auth_commands
          ;;
        cli)
          _describe -t commands 'cli command' cli_commands
          ;;
        event)
          _describe -t commands 'event command' event_commands
          ;;
        issue)
          _describe -t commands 'issue command' issue_commands
          ;;
        org)
          _describe -t commands 'org command' org_commands
          ;;
        project)
          _describe -t commands 'project command' project_commands
          ;;
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
  return `# fish completion for ${binaryName}
# Install: ${binaryName} cli setup

# Disable file completion by default
complete -c ${binaryName} -f

# Top-level commands
complete -c ${binaryName} -n "__fish_use_subcommand" -a "auth" -d "Authentication commands"
complete -c ${binaryName} -n "__fish_use_subcommand" -a "api" -d "Make authenticated API requests"
complete -c ${binaryName} -n "__fish_use_subcommand" -a "event" -d "Event-related commands"
complete -c ${binaryName} -n "__fish_use_subcommand" -a "issue" -d "Issue-related commands"
complete -c ${binaryName} -n "__fish_use_subcommand" -a "org" -d "Organization commands"
complete -c ${binaryName} -n "__fish_use_subcommand" -a "project" -d "Project commands"
complete -c ${binaryName} -n "__fish_use_subcommand" -a "cli" -d "CLI management commands"
complete -c ${binaryName} -n "__fish_use_subcommand" -a "help" -d "Show help"
complete -c ${binaryName} -n "__fish_use_subcommand" -a "version" -d "Show version"

# auth subcommands
complete -c ${binaryName} -n "__fish_seen_subcommand_from auth" -a "login" -d "Authenticate with Sentry"
complete -c ${binaryName} -n "__fish_seen_subcommand_from auth" -a "logout" -d "Clear stored credentials"
complete -c ${binaryName} -n "__fish_seen_subcommand_from auth" -a "status" -d "Check authentication status"
complete -c ${binaryName} -n "__fish_seen_subcommand_from auth" -a "refresh" -d "Refresh access token"

# cli subcommands
complete -c ${binaryName} -n "__fish_seen_subcommand_from cli" -a "feedback" -d "Send feedback"
complete -c ${binaryName} -n "__fish_seen_subcommand_from cli" -a "fix" -d "Repair local database"
complete -c ${binaryName} -n "__fish_seen_subcommand_from cli" -a "setup" -d "Configure shell integration"
complete -c ${binaryName} -n "__fish_seen_subcommand_from cli" -a "upgrade" -d "Upgrade to latest version"

# event subcommands
complete -c ${binaryName} -n "__fish_seen_subcommand_from event" -a "view" -d "View event details"

# issue subcommands
complete -c ${binaryName} -n "__fish_seen_subcommand_from issue" -a "list" -d "List issues"
complete -c ${binaryName} -n "__fish_seen_subcommand_from issue" -a "view" -d "View issue details"
complete -c ${binaryName} -n "__fish_seen_subcommand_from issue" -a "explain" -d "AI explanation of issue"
complete -c ${binaryName} -n "__fish_seen_subcommand_from issue" -a "plan" -d "AI fix plan for issue"

# org subcommands
complete -c ${binaryName} -n "__fish_seen_subcommand_from org" -a "list" -d "List organizations"
complete -c ${binaryName} -n "__fish_seen_subcommand_from org" -a "view" -d "View organization details"

# project subcommands
complete -c ${binaryName} -n "__fish_seen_subcommand_from project" -a "list" -d "List projects"
complete -c ${binaryName} -n "__fish_seen_subcommand_from project" -a "view" -d "View project details"
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
