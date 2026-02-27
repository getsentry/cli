/**
 * sentry cli upgrade
 *
 * Self-update the Sentry CLI to the latest or a specific version.
 * After upgrading, spawns the NEW binary with `cli setup` to update
 * completions, agent skills, and record installation metadata.
 *
 * Supports two release channels:
 * - stable (default): tracks the latest GitHub release
 * - nightly: tracks the rolling nightly prerelease built from main
 *
 * The channel can be set via --channel or by passing "nightly"/"stable"
 * as the version argument. The choice is persisted in the local database
 * so that subsequent bare `sentry cli upgrade` calls use the same channel.
 */

import { homedir } from "node:os";
import { dirname } from "node:path";
import type { SentryContext } from "../../context.js";
import { determineInstallDir, releaseLock } from "../../lib/binary.js";
import { buildCommand } from "../../lib/command.js";
import { CLI_VERSION } from "../../lib/constants.js";
import {
  getReleaseChannel,
  type ReleaseChannel,
  setReleaseChannel,
} from "../../lib/db/release-channel.js";
import { UpgradeError } from "../../lib/errors.js";
import {
  detectInstallationMethod,
  executeUpgrade,
  fetchLatestVersion,
  getCurlInstallPaths,
  type InstallationMethod,
  NIGHTLY_TAG,
  parseInstallationMethod,
  VERSION_PREFIX_REGEX,
  versionExists,
} from "../../lib/upgrade.js";

/** Special version strings that select a channel rather than a specific release. */
const CHANNEL_VERSIONS = new Set(["nightly", "stable"]);

type UpgradeFlags = {
  readonly check: boolean;
  readonly force: boolean;
  readonly method?: InstallationMethod;
};

/**
 * Resolve effective channel and version arg from the positional `version`
 * parameter. "nightly" and "stable" are treated as channel selectors, not
 * literal version strings.
 *
 * @returns `{ channel, versionArg }` where versionArg is undefined when the
 *   positional was a channel name (so we resolve to latest) or was omitted.
 */
function resolveChannelAndVersion(positional: string | undefined): {
  channel: ReleaseChannel;
  versionArg: string | undefined;
} {
  // "nightly" and "stable" as positional args select the channel rather than
  // installing a specific version. Match case-insensitively for convenience.
  const lower = positional?.toLowerCase();
  if (lower === "nightly" || lower === "stable") {
    return {
      channel: lower,
      versionArg: undefined,
    };
  }

  return {
    channel: getReleaseChannel(),
    versionArg: positional,
  };
}

type ResolveTargetOptions = {
  method: InstallationMethod;
  channel: ReleaseChannel;
  versionArg: string | undefined;
  channelChanged: boolean;
  flags: UpgradeFlags;
  stdout: { write: (s: string) => void };
};

/**
 * Resolve the target version and handle check-only mode.
 *
 * @returns The target version string, or null if no upgrade should proceed
 *          (check-only mode, already up to date without --force, or channel unchanged).
 */
async function resolveTargetVersion(
  opts: ResolveTargetOptions
): Promise<string | null> {
  const { method, channel, versionArg, channelChanged, flags, stdout } = opts;
  const latest = await fetchLatestVersion(method, channel);
  const target = versionArg?.replace(VERSION_PREFIX_REGEX, "") ?? latest;

  stdout.write(`Channel: ${channel}\n`);
  stdout.write(`Latest version: ${latest}\n`);
  if (versionArg) {
    stdout.write(`Target version: ${target}\n`);
  }

  if (flags.check) {
    return handleCheckMode(target, versionArg, stdout);
  }

  // Skip if already on target — unless forced or switching channels
  if (CLI_VERSION === target && !flags.force && !channelChanged) {
    stdout.write("\nAlready up to date.\n");
    return null;
  }

  // Validate that a specific pinned version actually exists.
  // Nightly builds are GitHub-only, so always use curl (GitHub) lookup for
  // nightly channel regardless of the current install method.
  if (versionArg && !CHANNEL_VERSIONS.has(versionArg)) {
    const lookupMethod = channel === "nightly" ? "curl" : method;
    const exists = await versionExists(lookupMethod, target);
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
 * Print check-only output and return null (no upgrade to perform).
 */
function handleCheckMode(
  target: string,
  versionArg: string | undefined,
  stdout: { write: (s: string) => void }
): null {
  if (CLI_VERSION === target) {
    stdout.write("\nYou are already on the target version.\n");
  } else {
    const cmd =
      versionArg && !CHANNEL_VERSIONS.has(versionArg)
        ? `sentry cli upgrade ${target}`
        : "sentry cli upgrade";
    stdout.write(`\nRun '${cmd}' to update.\n`);
  }
  return null;
}

/**
 * Spawn the new binary with `cli setup` to update completions, agent skills,
 * and record installation metadata.
 */
type SetupOptions = {
  binaryPath: string;
  method: InstallationMethod;
  channel: ReleaseChannel;
  /** Whether setup should handle binary placement (curl --install flow) */
  install: boolean;
  /** Pin the install directory (prevents relocation during upgrade) */
  installDir?: string;
};

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
 */
async function runSetupOnNewBinary(opts: SetupOptions): Promise<void> {
  const { binaryPath, method, channel, install, installDir } = opts;
  const args = [
    "cli",
    "setup",
    "--method",
    method,
    "--channel",
    channel,
    "--no-modify-path",
  ];
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

/**
 * Migrate from a package-manager or Homebrew install to a standalone binary
 * when the user switches to the nightly channel.
 *
 * Nightly builds are distributed as standalone binaries only (GitHub release
 * assets). When a user on brew/npm/pnpm/bun/yarn switches to nightly we:
 *   1. Download the nightly binary to a temp path
 *   2. Install it to `determineInstallDir()` (same logic as the curl installer)
 *   3. Run setup on the new binary to update completions, PATH, and metadata
 *   4. Warn about the old package-manager installation that may still be in PATH
 *
 * @param versionArg - Specific version requested by the user, or undefined for
 *   latest nightly. When a specific version is given, its release tag is used
 *   instead of the rolling "nightly" tag so the correct binary is downloaded.
 */
async function migrateToStandaloneForNightly(
  method: InstallationMethod,
  target: string,
  stdout: { write: (s: string) => void },
  versionArg: string | undefined
): Promise<void> {
  stdout.write("\nNightly builds are only available as standalone binaries.\n");
  stdout.write("Migrating to standalone installation...\n\n");

  // Use the rolling "nightly" tag for latest nightly; use the specific version
  // tag if the user requested a pinned version.
  const downloadTag = versionArg ? undefined : NIGHTLY_TAG;
  const downloadResult = await executeUpgrade("curl", target, downloadTag);
  if (!downloadResult) {
    throw new UpgradeError(
      "execution_failed",
      "Failed to download nightly binary"
    );
  }

  const installDir = determineInstallDir(homedir(), process.env);

  try {
    await runSetupOnNewBinary({
      binaryPath: downloadResult.tempBinaryPath,
      method: "curl",
      channel: "nightly",
      install: true,
      installDir,
    });
  } finally {
    releaseLock(downloadResult.lockPath);
  }

  // Warn about the potentially shadowing old installation
  // Note: install info is already recorded by the child `setup --install`
  // process, so no redundant setInstallInfo call is needed here.
  const uninstallHints: Record<string, string> = {
    npm: "npm uninstall -g sentry",
    pnpm: "pnpm remove -g sentry",
    bun: "bun remove -g sentry",
    yarn: "yarn global remove sentry",
    brew: "brew uninstall getsentry/tools/sentry",
  };
  const hint = uninstallHints[method];
  stdout.write(
    `\nNote: your ${method}-installed sentry may still appear earlier in PATH.\n`
  );
  if (hint) {
    stdout.write(`      Consider removing it: ${hint}\n`);
  }
}

export const upgradeCommand = buildCommand({
  docs: {
    brief: "Update the Sentry CLI to the latest version",
    fullDescription:
      "Check for updates and upgrade the Sentry CLI to the latest or a specific version.\n\n" +
      "By default, detects how the CLI was installed (npm, curl, etc.) and uses the same method to upgrade.\n\n" +
      "Two release channels are supported:\n" +
      "  stable  (default) Latest stable release\n" +
      "  nightly           Built from main, updated on every commit\n\n" +
      "The channel is persisted so that subsequent bare `sentry cli upgrade` calls\n" +
      "use the same channel.\n\n" +
      "Examples:\n" +
      "  sentry cli upgrade              # Update to latest (using persisted channel)\n" +
      "  sentry cli upgrade nightly      # Switch to nightly channel and update\n" +
      "  sentry cli upgrade stable       # Switch back to stable channel and update\n" +
      "  sentry cli upgrade 0.5.0        # Install a specific stable version\n" +
      "  sentry cli upgrade --check      # Check for updates without installing\n" +
      "  sentry cli upgrade --force      # Force re-download even if up to date\n" +
      "  sentry cli upgrade --method npm # Force using npm to upgrade",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief:
            'Specific version (e.g. 0.5.0), or "nightly"/"stable" to switch channel; omit to update within current channel',
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
      force: {
        kind: "boolean",
        brief: "Force upgrade even if already on the latest version",
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

    // Resolve effective channel and version from positional
    const { channel, versionArg } = resolveChannelAndVersion(version);

    // Track whether the user is deliberately switching channels
    const currentChannel = getReleaseChannel();
    const channelChanged = channel !== currentChannel;

    // Persist the channel so version-check and future upgrades respect it.
    // We do this upfront — even if the download is skipped (e.g. --check) —
    // so the preference is always recorded.
    if (channelChanged || CHANNEL_VERSIONS.has(version ?? "")) {
      setReleaseChannel(channel);
    }

    // Resolve installation method (detects or uses user-specified)
    const method = flags.method ?? (await detectInstallationMethod());

    if (method === "unknown") {
      throw new UpgradeError("unknown_method");
    }

    // Homebrew manages versioning through the formula — pinning a specific
    // stable version is not supported via this command.
    if (method === "brew" && versionArg && channel === "stable") {
      throw new UpgradeError(
        "unsupported_operation",
        "Homebrew does not support installing a specific version. Run 'brew upgrade getsentry/tools/sentry' to upgrade to the latest formula version."
      );
    }

    stdout.write(`Installation method: ${method}\n`);
    stdout.write(`Current version: ${CLI_VERSION}\n`);

    const target = await resolveTargetVersion({
      method,
      channel,
      versionArg,
      channelChanged,
      flags,
      stdout,
    });
    if (!target) {
      return;
    }

    stdout.write(`\nUpgrading to ${target}...\n`);

    // Nightly is GitHub-only. If the current install method is not curl,
    // migrate to a standalone binary first then return — the migration
    // handles setup internally.
    if (channel === "nightly" && method !== "curl") {
      await migrateToStandaloneForNightly(method, target, stdout, versionArg);
      stdout.write(`\nSuccessfully installed nightly ${target}.\n`);
      return;
    }

    // Standard upgrade path: download (curl) or package manager.
    // Use the rolling "nightly" tag only when upgrading to latest nightly
    // (no specific version was requested). A specific version arg always
    // uses its own tag so the correct release is downloaded.
    const downloadTag =
      channel === "nightly" && !versionArg ? NIGHTLY_TAG : undefined;
    const downloadResult = await executeUpgrade(method, target, downloadTag);

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
        await runSetupOnNewBinary({
          binaryPath: downloadResult.tempBinaryPath,
          method,
          channel,
          install: true,
          installDir: currentInstallDir,
        });
      } finally {
        releaseLock(downloadResult.lockPath);
      }
    } else if (method !== "brew") {
      // Package manager: binary already in place, just run setup.
      // Skip brew — Homebrew's post_install hook already runs setup.
      await runSetupOnNewBinary({
        binaryPath: this.process.execPath,
        method,
        channel,
        install: false,
      });
    }

    stdout.write(`\nSuccessfully upgraded to ${target}.\n`);
  },
});
