/**
 * sentry cli setup
 *
 * Configure shell integration: PATH, completions, and install metadata.
 * With --install, also handles binary placement (used by the install script
 * and the upgrade command for curl-based installs).
 */

import { unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { SentryContext } from "../../context.js";
import { installAgentSkills } from "../../lib/agent-skills.js";
import { determineInstallDir, installBinary } from "../../lib/binary.js";
import { buildCommand } from "../../lib/command.js";
import { installCompletions } from "../../lib/completions.js";
import { CLI_VERSION } from "../../lib/constants.js";
import { setInstallInfo } from "../../lib/db/install-info.js";
import {
  addToGitHubPath,
  addToPath,
  detectShell,
  getPathCommand,
  isBashAvailable,
  isInPath,
  type ShellInfo,
} from "../../lib/shell.js";
import {
  type InstallationMethod,
  parseInstallationMethod,
} from "../../lib/upgrade.js";

type SetupFlags = {
  readonly install: boolean;
  readonly method?: InstallationMethod;
  readonly "no-modify-path": boolean;
  readonly "no-completions": boolean;
  readonly "no-agent-skills": boolean;
  readonly quiet: boolean;
};

type Logger = (msg: string) => void;

/**
 * Handle binary installation from a temp location.
 *
 * Determines the target install directory, copies the running binary
 * (which is at a temp path) to the install location, then cleans up
 * the temp binary on Posix (safe because the running process's inode
 * stays alive until exit).
 *
 * On Windows, the temp binary cannot be deleted while running. It will
 * be cleaned up by the OS when the temp directory is purged.
 *
 * @returns The absolute path of the installed binary and its directory
 */
async function handleInstall(
  execPath: string,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  log: Logger
): Promise<{ binaryPath: string; binaryDir: string }> {
  const installDir = determineInstallDir(homeDir, env);
  const binaryPath = await installBinary(execPath, installDir);
  const binaryDir = dirname(binaryPath);

  log(`Binary: Installed to ${binaryPath}`);

  // Clean up temp binary (Posix only — the inode stays alive for the running process)
  if (process.platform !== "win32") {
    try {
      unlinkSync(execPath);
    } catch {
      // Ignore — temp file may already be gone or we lack permissions
    }
  }

  return { binaryPath, binaryDir };
}

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
 * Attempt to install bash completions as a fallback for unsupported shells.
 *
 * Many custom shells (xonsh, nushell, etc.) can load bash completions,
 * so this is a useful fallback when the user's shell isn't directly supported.
 *
 * @param pathEnv - The PATH to search for bash, forwarded from the process env.
 */
async function tryBashCompletionFallback(
  homeDir: string,
  xdgDataHome: string | undefined,
  pathEnv: string | undefined
): Promise<string | null> {
  if (!isBashAvailable(pathEnv)) {
    return null;
  }

  const fallback = await installCompletions("bash", homeDir, xdgDataHome);
  if (!fallback) {
    // Defensive: installCompletions returns null only if the shell type has no
    // completion script or path configured. "bash" is always supported, but
    // we guard here in case that changes in future.
    return null;
  }
  const action = fallback.created ? "Installed" : "Updated";
  return `      ${action} bash completions as a fallback: ${fallback.path}`;
}

/**
 * Handle shell completion installation.
 *
 * For unsupported shells (xonsh, nushell, etc.), falls back to installing
 * bash completions if bash is available on the system. Uses the provided
 * PATH env to check for bash so the call is testable without side effects.
 */
async function handleCompletions(
  shell: ShellInfo,
  homeDir: string,
  xdgDataHome: string | undefined,
  pathEnv: string | undefined
): Promise<string[]> {
  const location = await installCompletions(shell.type, homeDir, xdgDataHome);

  if (location) {
    const action = location.created ? "Installed to" : "Updated";
    const lines = [`Completions: ${action} ${location.path}`];

    // Zsh may need fpath hint
    if (shell.type === "zsh") {
      const completionDir = dirname(location.path);
      lines.push(
        `      You may need to add to .zshrc: fpath=(${completionDir} $fpath)`
      );
    }
    return lines;
  }

  // sh/ash are minimal POSIX shells — completions aren't expected
  if (shell.type === "sh" || shell.type === "ash") {
    return [];
  }

  const fallbackMsg = await tryBashCompletionFallback(
    homeDir,
    xdgDataHome,
    pathEnv
  );

  if (fallbackMsg) {
    return [
      `Completions: Your shell (${shell.type}) is not directly supported`,
      fallbackMsg,
    ];
  }

  return [`Completions: Not supported for ${shell.type} shell`];
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

/**
 * Print a rich welcome message after fresh install.
 */
function printWelcomeMessage(
  log: Logger,
  version: string,
  binaryPath: string
): void {
  log("");
  log(`Installed sentry v${version} to ${binaryPath}`);
  log("");
  log("Get started:");
  log("  sentry auth login  Authenticate with Sentry");
  log("  sentry --help      See all available commands");
  log("");
  log("https://cli.sentry.dev");
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
      "With --install, also handles binary placement from a temporary\n" +
      "download location (used by the install script and upgrade command).\n\n" +
      "This command is called automatically by the install script,\n" +
      "but can also be run manually after downloading the binary.\n\n" +
      "Examples:\n" +
      "  sentry cli setup                    # Auto-detect and configure\n" +
      "  sentry cli setup --method curl      # Record install method\n" +
      "  sentry cli setup --install          # Place binary and configure\n" +
      "  sentry cli setup --no-modify-path   # Skip PATH modification\n" +
      "  sentry cli setup --no-completions   # Skip shell completions\n" +
      "  sentry cli setup --no-agent-skills  # Skip agent skill installation",
  },
  parameters: {
    flags: {
      install: {
        kind: "boolean",
        brief: "Install the binary from a temp location to the system path",
        default: false,
      },
      method: {
        kind: "parsed",
        parse: parseInstallationMethod,
        brief: "Installation method (curl, npm, pnpm, bun, yarn)",
        placeholder: "method",
        optional: true,
      },
      "no-modify-path": {
        kind: "boolean",
        brief: "Skip PATH modification",
        default: false,
      },
      "no-completions": {
        kind: "boolean",
        brief: "Skip shell completion installation",
        default: false,
      },
      "no-agent-skills": {
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

    let binaryPath = process.execPath;
    let binaryDir = dirname(binaryPath);

    // 0. Install binary from temp location (when --install is set)
    if (flags.install) {
      const result = await handleInstall(
        process.execPath,
        homeDir,
        process.env,
        log
      );
      binaryPath = result.binaryPath;
      binaryDir = result.binaryDir;
    }

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
      if (!flags.install) {
        log(`Recorded installation method: ${flags.method}`);
      }
    }

    // 2. Handle PATH modification
    if (!flags["no-modify-path"]) {
      await handlePathModification(binaryDir, shell, process.env, log);
    }

    // 3. Install shell completions
    if (!flags["no-completions"]) {
      const completionLines = await handleCompletions(
        shell,
        homeDir,
        process.env.XDG_DATA_HOME,
        process.env.PATH
      );
      for (const line of completionLines) {
        log(line);
      }
    }

    // 4. Install agent skills (auto-detected, silent when no agent found)
    if (!flags["no-agent-skills"]) {
      await handleAgentSkills(homeDir, log);
    }

    // 5. Print welcome message (fresh install) or completion message
    if (!flags.quiet) {
      if (flags.install) {
        printWelcomeMessage(log, CLI_VERSION, binaryPath);
      } else {
        stdout.write("\nSetup complete!\n");
      }
    }
  },
});
