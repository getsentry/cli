/**
 * sentry cli upgrade
 *
 * Self-update the Sentry CLI to the latest or a specific version.
 * After upgrading, spawns the NEW binary with `cli setup` to update
 * completions, agent skills, and record installation metadata.
 */

import { dirname } from "node:path";
import type { SentryContext } from "../../context.js";
import { releaseLock } from "../../lib/binary.js";
import { buildCommand } from "../../lib/command.js";
import { CLI_VERSION } from "../../lib/constants.js";
import { UpgradeError } from "../../lib/errors.js";
import {
  detectInstallationMethod,
  executeUpgrade,
  fetchLatestNightlyVersion,
  fetchLatestVersion,
  getCurlInstallPaths,
  type InstallationMethod,
  isNightlyVersion,
  parseInstallationMethod,
  VERSION_PREFIX_REGEX,
  versionExists,
} from "../../lib/upgrade.js";

type UpgradeFlags = {
  readonly check: boolean;
  readonly method?: InstallationMethod;
};

/**
 * Fetch the latest available version for the given channel.
 *
 * Uses GHCR (nightly channel) when the current CLI is a nightly build or
 * the user explicitly requested a nightly version. Otherwise uses the stable
 * channel (GitHub Releases for curl/brew, npm registry for others).
 *
 * @param method - Installation method (determines registry for stable)
 * @param targetIsNightly - true when the user-specified target is a nightly version
 * @returns Latest version string
 */
function fetchLatestForChannel(
  method: InstallationMethod,
  targetIsNightly: boolean
): Promise<string> {
  if (isNightlyVersion(CLI_VERSION) || targetIsNightly) {
    return fetchLatestNightlyVersion();
  }
  return fetchLatestVersion(method);
}

/**
 * Resolve the target version and handle check-only mode.
 *
 * @returns The target version string, or null if no upgrade should proceed
 *          (check-only mode or already up to date).
 */
async function resolveTargetVersion(
  method: InstallationMethod,
  version: string | undefined,
  stdout: { write: (s: string) => void },
  check: boolean
): Promise<string | null> {
  const strippedVersion = version?.replace(VERSION_PREFIX_REGEX, "");
  const targetIsNightly =
    strippedVersion !== undefined && isNightlyVersion(strippedVersion);
  const latest = await fetchLatestForChannel(method, targetIsNightly);
  const target = strippedVersion ?? latest;

  stdout.write(`Latest version: ${latest}\n`);
  if (version) {
    stdout.write(`Target version: ${target}\n`);
  }

  if (check) {
    if (CLI_VERSION === target) {
      stdout.write("\nYou are already on the target version.\n");
    } else {
      const cmd = version
        ? `sentry cli upgrade ${target}`
        : "sentry cli upgrade";
      stdout.write(`\nRun '${cmd}' to update.\n`);
    }
    return null;
  }

  if (CLI_VERSION === target) {
    stdout.write("\nAlready up to date.\n");
    return null;
  }

  if (version) {
    const exists = await versionExists(method, target);
    if (!exists) {
      throw new UpgradeError(
        "version_not_found",
        `Version ${target} not found`
      );
    }
  }

  return target;
}

/**
 * Spawn the new binary with `cli setup` to update completions, agent skills,
 * and record installation metadata.
 *
 * For curl upgrades with --install: the new binary places itself at the install
 * path, then runs setup steps. SENTRY_INSTALL_DIR is set in the child's
 * environment to pin the install directory, preventing `determineInstallDir()`
 * from relocating the binary to a different directory.
 *
 * For package manager upgrades: the binary is already in place, so setup only
 * updates completions, agent skills, and records metadata.
 *
 * @param binaryPath - Path to the new binary to spawn
 * @param method - Installation method to pass through to setup
 * @param install - Whether setup should handle binary placement (curl only)
 * @param installDir - Pin the install directory (prevents relocation during upgrade)
 */
async function runSetupOnNewBinary(
  binaryPath: string,
  method: InstallationMethod,
  install: boolean,
  installDir?: string
): Promise<void> {
  const args = ["cli", "setup", "--method", method, "--no-modify-path"];
  if (install) {
    args.push("--install");
  }

  const env = installDir
    ? { ...process.env, SENTRY_INSTALL_DIR: installDir }
    : undefined;

  const proc = Bun.spawn([binaryPath, ...args], {
    stdout: "inherit",
    stderr: "inherit",
    env,
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new UpgradeError(
      "execution_failed",
      `Setup failed with exit code ${exitCode}`
    );
  }
}

export const upgradeCommand = buildCommand({
  docs: {
    brief: "Update the Sentry CLI to the latest version",
    fullDescription:
      "Check for updates and upgrade the Sentry CLI to the latest or a specific version.\n\n" +
      "By default, detects how the CLI was installed (npm, curl, etc.) and uses the same method to upgrade.\n\n" +
      "Examples:\n" +
      "  sentry cli upgrade              # Update to latest version\n" +
      "  sentry cli upgrade 0.5.0        # Update to specific version\n" +
      "  sentry cli upgrade --check      # Check for updates without installing\n" +
      "  sentry cli upgrade --method npm # Force using npm to upgrade",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Target version to install (defaults to latest)",
          parse: String,
          placeholder: "version",
          optional: true,
        },
      ],
    },
    flags: {
      check: {
        kind: "boolean",
        brief: "Check for updates without installing",
        default: false,
      },
      method: {
        kind: "parsed",
        parse: parseInstallationMethod,
        brief: "Installation method to use (curl, brew, npm, pnpm, bun, yarn)",
        optional: true,
        placeholder: "method",
      },
    },
  },
  async func(
    this: SentryContext,
    flags: UpgradeFlags,
    version?: string
  ): Promise<void> {
    const { stdout } = this;

    // Resolve installation method (detects or uses user-specified)
    const method = flags.method ?? (await detectInstallationMethod());

    if (method === "unknown") {
      throw new UpgradeError("unknown_method");
    }

    // Homebrew manages versioning through the formula in the tap — the installed
    // version is always whatever the formula specifies, not an arbitrary release.
    if (method === "brew" && version) {
      throw new UpgradeError(
        "unsupported_operation",
        "Homebrew does not support installing a specific version. Run 'brew upgrade getsentry/tools/sentry' to upgrade to the latest formula version."
      );
    }

    stdout.write(`Installation method: ${method}\n`);
    stdout.write(`Current version: ${CLI_VERSION}\n`);

    const target = await resolveTargetVersion(
      method,
      version,
      stdout,
      flags.check
    );
    if (!target) {
      return;
    }

    // Execute upgrade: downloads new binary (curl) or installs via package manager
    stdout.write(`\nUpgrading to ${target}...\n`);
    const downloadResult = await executeUpgrade(method, target);

    // Run setup on the new binary to update completions, agent skills,
    // and record installation metadata.
    if (downloadResult) {
      // Curl: new binary is at temp path, setup --install will place it.
      // Pin the install directory via SENTRY_INSTALL_DIR so the child's
      // determineInstallDir() doesn't relocate to a different directory.
      // Release the download lock after the child exits — if the child used
      // the same lock path (ppid takeover), this is a harmless no-op.
      const currentInstallDir = dirname(getCurlInstallPaths().installPath);
      try {
        await runSetupOnNewBinary(
          downloadResult.tempBinaryPath,
          method,
          true,
          currentInstallDir
        );
      } finally {
        releaseLock(downloadResult.lockPath);
      }
    } else if (method !== "brew") {
      // Package manager: binary already in place, just run setup.
      // Skip brew — Homebrew's post_install hook already runs setup.
      await runSetupOnNewBinary(this.process.execPath, method, false);
    }

    stdout.write(`\nSuccessfully upgraded to ${target}.\n`);
  },
});
