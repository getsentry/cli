/**
 * Shell detection and configuration utilities.
 *
 * Provides functions for detecting the current shell, finding config files,
 * and modifying PATH in shell configuration.
 */

import { existsSync } from "node:fs";
import { basename, delimiter, join } from "node:path";

/** Supported shell types */
export type ShellType = "bash" | "zsh" | "fish" | "sh" | "ash" | "unknown";

/** Result of shell detection */
export type ShellInfo = {
  /** Detected shell type */
  type: ShellType;
  /** Path to shell config file, if found */
  configFile: string | null;
  /** All candidate config files for this shell */
  configCandidates: string[];
};

/** Result of PATH modification */
export type PathModificationResult = {
  /** Whether modification was performed */
  modified: boolean;
  /** The config file that was modified, if any */
  configFile: string | null;
  /** Message describing what happened */
  message: string;
  /** Command to add manually if auto-modification failed */
  manualCommand: string | null;
};

/**
 * Detect the current shell from SHELL environment variable.
 */
export function detectShellType(shellPath: string | undefined): ShellType {
  if (!shellPath) {
    return "unknown";
  }

  const shellName = basename(shellPath).toLowerCase();

  switch (shellName) {
    case "bash":
      return "bash";
    case "zsh":
      return "zsh";
    case "fish":
      return "fish";
    case "sh":
      return "sh";
    case "ash":
      return "ash";
    default:
      return "unknown";
  }
}

/**
 * Get candidate config files for a shell type.
 *
 * @param shellType - The shell type
 * @param homeDir - User's home directory
 * @param xdgConfigHome - XDG_CONFIG_HOME or default
 */
export function getConfigCandidates(
  shellType: ShellType,
  homeDir: string,
  xdgConfigHome?: string
): string[] {
  const xdg = xdgConfigHome || join(homeDir, ".config");

  switch (shellType) {
    case "fish":
      return [join(xdg, "fish", "config.fish")];

    case "zsh":
      return [
        join(homeDir, ".zshrc"),
        join(homeDir, ".zshenv"),
        join(xdg, "zsh", ".zshrc"),
        join(xdg, "zsh", ".zshenv"),
      ];

    case "bash":
      return [
        join(homeDir, ".bashrc"),
        join(homeDir, ".bash_profile"),
        join(homeDir, ".profile"),
        join(xdg, "bash", ".bashrc"),
        join(xdg, "bash", ".bash_profile"),
      ];

    case "sh":
    case "ash":
      return [join(homeDir, ".profile")];

    default:
      // Fall back to common files for unknown shells
      return [
        join(homeDir, ".bashrc"),
        join(homeDir, ".bash_profile"),
        join(homeDir, ".profile"),
      ];
  }
}

/**
 * Find the first existing config file from candidates.
 */
export function findExistingConfigFile(candidates: string[]): string | null {
  for (const file of candidates) {
    if (existsSync(file)) {
      return file;
    }
  }
  return null;
}

/**
 * Detect shell and find config file.
 */
export function detectShell(
  shellPath: string | undefined,
  homeDir: string,
  xdgConfigHome?: string
): ShellInfo {
  const type = detectShellType(shellPath);
  const configCandidates = getConfigCandidates(type, homeDir, xdgConfigHome);
  const configFile = findExistingConfigFile(configCandidates);

  return {
    type,
    configFile,
    configCandidates,
  };
}

/**
 * Generate the PATH export command for a shell.
 */
export function getPathCommand(
  shellType: ShellType,
  directory: string
): string {
  if (shellType === "fish") {
    return `fish_add_path "${directory}"`;
  }
  return `export PATH="${directory}:$PATH"`;
}

/**
 * Check if a directory is in PATH.
 */
export function isInPath(
  directory: string,
  pathEnv: string | undefined
): boolean {
  if (!pathEnv) {
    return false;
  }
  const paths = pathEnv.split(delimiter);
  return paths.includes(directory);
}

/**
 * Add a directory to PATH in a shell config file.
 *
 * @param configFile - Path to the config file
 * @param directory - Directory to add to PATH
 * @param shellType - The shell type (for correct syntax)
 * @returns Result of the modification attempt
 */
export async function addToPath(
  configFile: string,
  directory: string,
  shellType: ShellType
): Promise<PathModificationResult> {
  const pathCommand = getPathCommand(shellType, directory);

  // Read current content
  const file = Bun.file(configFile);
  const exists = await file.exists();

  if (!exists) {
    // Create the file with the PATH command
    try {
      await Bun.write(configFile, `# sentry\n${pathCommand}\n`);
      return {
        modified: true,
        configFile,
        message: `Created ${configFile} with PATH configuration`,
        manualCommand: null,
      };
    } catch {
      return {
        modified: false,
        configFile: null,
        message: `Could not create ${configFile}`,
        manualCommand: pathCommand,
      };
    }
  }

  const content = await file.text();

  // Check if already configured
  if (content.includes(pathCommand) || content.includes(`"${directory}"`)) {
    return {
      modified: false,
      configFile,
      message: `PATH already configured in ${configFile}`,
      manualCommand: null,
    };
  }

  // Append to file
  try {
    const newContent = content.endsWith("\n")
      ? `${content}\n# sentry\n${pathCommand}\n`
      : `${content}\n\n# sentry\n${pathCommand}\n`;

    await Bun.write(configFile, newContent);
    return {
      modified: true,
      configFile,
      message: `Added sentry to PATH in ${configFile}`,
      manualCommand: null,
    };
  } catch {
    return {
      modified: false,
      configFile: null,
      message: `Could not write to ${configFile}`,
      manualCommand: pathCommand,
    };
  }
}

/**
 * Add to GitHub Actions PATH if running in CI.
 */
export async function addToGitHubPath(
  directory: string,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  if (env.GITHUB_ACTIONS !== "true" || !env.GITHUB_PATH) {
    return false;
  }

  try {
    const file = Bun.file(env.GITHUB_PATH);
    const content = (await file.exists()) ? await file.text() : "";

    if (!content.includes(directory)) {
      const newContent = content.endsWith("\n")
        ? `${content}${directory}\n`
        : `${content}\n${directory}\n`;
      await Bun.write(env.GITHUB_PATH, newContent);
    }
    return true;
  } catch {
    return false;
  }
}
