/**
 * sentry cli setup
 *
 * Configure shell integration: PATH, completions, and install metadata.
 * This command is called by the install script and can also be run manually.
 */

import { dirname } from "node:path";
import type { SentryContext } from "../../context.js";
import { installAgentSkills } from "../../lib/agent-skills.js";
import { buildCommand } from "../../lib/command.js";
import { installCompletions } from "../../lib/completions.js";
import { CLI_VERSION } from "../../lib/constants.js";
import { setInstallInfo } from "../../lib/db/install-info.js";
import {
  addToGitHubPath,
  addToPath,
  detectShell,
  getPathCommand,
  isInPath,
  type ShellInfo,
} from "../../lib/shell.js";
import {
  type InstallationMethod,
  parseInstallationMethod,
} from "../../lib/upgrade.js";

type SetupFlags = {
  readonly method?: InstallationMethod;
  readonly noModifyPath: boolean;
  readonly noCompletions: boolean;
  readonly noAgentSkills: boolean;
  readonly quiet: boolean;
};

type Logger = (msg: string) => void;

/**
 * Handle PATH modification for a directory.
 */
async function handlePathModification(
  binaryDir: string,
  shell: ShellInfo,
  env: NodeJS.ProcessEnv,
  log: Logger
): Promise<void> {
  const alreadyInPath = isInPath(binaryDir, env.PATH);

  if (alreadyInPath) {
    log(`PATH: ${binaryDir} is already in PATH`);
    return;
  }

  if (shell.configFile) {
    const result = await addToPath(shell.configFile, binaryDir, shell.type);

    if (result.modified) {
      log(`PATH: ${result.message}`);
      log(`      Restart your shell or run: source ${shell.configFile}`);
    } else if (result.manualCommand) {
      log(`PATH: ${result.message}`);
      log(`      Add manually: ${result.manualCommand}`);
    } else {
      log(`PATH: ${result.message}`);
    }
  } else {
    const cmd = getPathCommand(shell.type, binaryDir);
    log("PATH: No shell config file found");
    log(`      Add manually to your shell config: ${cmd}`);
  }

  // Handle GitHub Actions
  const addedToGitHub = await addToGitHubPath(binaryDir, env);
  if (addedToGitHub) {
    log("PATH: Added to $GITHUB_PATH");
  }
}

/**
 * Handle shell completion installation.
 */
async function handleCompletions(
  shell: ShellInfo,
  homeDir: string,
  xdgDataHome: string | undefined,
  log: Logger
): Promise<void> {
  const location = await installCompletions(shell.type, homeDir, xdgDataHome);

  if (location) {
    const action = location.created ? "Installed to" : "Updated";
    log(`Completions: ${action} ${location.path}`);

    // Zsh may need fpath hint
    if (shell.type === "zsh") {
      const completionDir = dirname(location.path);
      log(
        `      You may need to add to .zshrc: fpath=(${completionDir} $fpath)`
      );
    }
  } else if (shell.type !== "sh" && shell.type !== "ash") {
    log(`Completions: Not supported for ${shell.type} shell`);
  }
}

/**
 * Handle agent skill installation for AI coding assistants.
 *
 * Detects supported agents (currently Claude Code) and installs the
 * version-pinned skill file. Silent when no agent is detected.
 */
async function handleAgentSkills(homeDir: string, log: Logger): Promise<void> {
  const location = await installAgentSkills(homeDir, CLI_VERSION);

  if (location) {
    const action = location.created ? "Installed to" : "Updated";
    log(`Agent skills: ${action} ${location.path}`);
  }
}

export const setupCommand = buildCommand({
  docs: {
    brief: "Configure shell integration",
    fullDescription:
      "Sets up shell integration for the Sentry CLI:\n\n" +
      "- Adds binary directory to PATH (if not already in PATH)\n" +
      "- Installs shell completions (bash, zsh, fish)\n" +
      "- Installs agent skills for AI coding assistants (e.g., Claude Code)\n" +
      "- Records installation metadata for upgrades\n\n" +
      "This command is called automatically by the install script,\n" +
      "but can also be run manually after downloading the binary.\n\n" +
      "Examples:\n" +
      "  sentry cli setup                    # Auto-detect and configure\n" +
      "  sentry cli setup --method curl      # Record install method\n" +
      "  sentry cli setup --no-modify-path   # Skip PATH modification\n" +
      "  sentry cli setup --no-completions   # Skip shell completions\n" +
      "  sentry cli setup --no-agent-skills  # Skip agent skill installation",
  },
  parameters: {
    flags: {
      method: {
        kind: "parsed",
        parse: parseInstallationMethod,
        brief: "Installation method (curl, npm, pnpm, bun, yarn)",
        placeholder: "method",
        optional: true,
      },
      noModifyPath: {
        kind: "boolean",
        brief: "Skip PATH modification",
        default: false,
      },
      noCompletions: {
        kind: "boolean",
        brief: "Skip shell completion installation",
        default: false,
      },
      noAgentSkills: {
        kind: "boolean",
        brief: "Skip agent skill installation for AI coding assistants",
        default: false,
      },
      quiet: {
        kind: "boolean",
        brief: "Suppress output (for scripted usage)",
        default: false,
      },
    },
  },
  async func(this: SentryContext, flags: SetupFlags): Promise<void> {
    const { process, homeDir } = this;
    const { stdout } = process;

    const log: Logger = (msg: string) => {
      if (!flags.quiet) {
        stdout.write(`${msg}\n`);
      }
    };

    const binaryPath = process.execPath;
    const binaryDir = dirname(binaryPath);
    const shell = detectShell(
      process.env.SHELL,
      homeDir,
      process.env.XDG_CONFIG_HOME
    );

    // 1. Record installation info
    if (flags.method) {
      setInstallInfo({
        method: flags.method,
        path: binaryPath,
        version: CLI_VERSION,
      });
      log(`Recorded installation method: ${flags.method}`);
    }

    // 2. Handle PATH modification
    if (!flags.noModifyPath) {
      await handlePathModification(binaryDir, shell, process.env, log);
    }

    // 3. Install shell completions
    if (!flags.noCompletions) {
      await handleCompletions(shell, homeDir, process.env.XDG_DATA_HOME, log);
    }

    // 4. Install agent skills (auto-detected, silent when no agent found)
    if (!flags.noAgentSkills) {
      await handleAgentSkills(homeDir, log);
    }

    if (!flags.quiet) {
      stdout.write("\nSetup complete!\n");
    }
  },
});
