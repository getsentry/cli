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
import {
  determineInstallDir,
  isDowngrade,
  releaseLock,
} from "../../lib/binary.js";
import { buildCommand } from "../../lib/command.js";
import { CLI_VERSION } from "../../lib/constants.js";
import {
  getReleaseChannel,
  type ReleaseChannel,
  setReleaseChannel,
} from "../../lib/db/release-channel.js";
import { getVersionCheckInfo } from "../../lib/db/version-check.js";
import { UpgradeError } from "../../lib/errors.js";
import { formatUpgradeResult } from "../../lib/formatters/human.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import { withProgress } from "../../lib/polling.js";
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

const log = logger.withTag("cli.upgrade");

/** Special version strings that select a channel rather than a specific release. */
const CHANNEL_VERSIONS = new Set(["nightly", "stable"]);

/**
 * Structured result of the upgrade command.
 *
 * Returned as `{ data: UpgradeResult }` and rendered via the output config.
 * In JSON mode the object is serialized as-is; in human mode it's passed to
 * {@link formatUpgradeResult}.
 */
export type UpgradeResult = {
  /** What action was taken */
  action: "upgraded" | "downgraded" | "up-to-date" | "checked";
  /** Current CLI version before upgrade */
  currentVersion: string;
  /** Target version (the version we upgraded/downgraded to, or the latest available) */
  targetVersion: string;
  /** Release channel */
  channel: "stable" | "nightly";
  /** Installation method used */
  method: string;
  /** Whether the user forced the upgrade */
  forced: boolean;
  /** Whether the upgrade was performed offline (from cache) */
  offline?: boolean;
  /** Warnings to display (e.g., PATH shadowing from old package manager install) */
  warnings?: string[];
};

type UpgradeFlags = {
  readonly check: boolean;
  readonly force: boolean;
  readonly offline: boolean;
  readonly method?: InstallationMethod;
  /** Injected by buildCommand output wrapper — suppresses spinners */
  readonly json?: boolean;
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

/**
 * Resolve the target version from the local cache (SQLite) instead of
 * fetching from the network. Used by `--offline` and as automatic
 * fallback when `fetchLatestVersion()` hits a network error.
 *
 * @param versionArg - Explicit version from the user, bypasses the cache lookup
 * @returns The target version string
 * @throws {UpgradeError} When no cached version is available
 */
function resolveOfflineTarget(versionArg: string | undefined): string {
  if (versionArg) {
    return versionArg.replace(VERSION_PREFIX_REGEX, "");
  }
  const { latestVersion } = getVersionCheckInfo();
  if (!latestVersion) {
    throw new UpgradeError(
      "network_error",
      "No cached version available. Run any command to trigger a background version check, then retry."
    );
  }
  return latestVersion;
}

/**
 * Resolve the target version, trying the network first and falling back to
 * the local cache when offline or when the network is unavailable.
 *
 * @returns `{ target, offline }` — the resolved version and whether the
 *   resolution used the offline path (explicit or automatic fallback).
 *   Returns `null` when `resolveTargetVersion` returns a "done" result
 *   (check-only or already up-to-date); the caller should yield that result.
 */
async function resolveTargetWithFallback(opts: {
  resolveOpts: ResolveTargetOptions;
  versionArg: string | undefined;
  offline: boolean;
  /** Only curl-installed binaries support offline fallback */
  method: InstallationMethod;
  /** Persist the channel after offline target resolution (deferred to avoid
   *  clearing the version cache before the offline path can read it). */
  persistChannelFn: () => void;
}): Promise<
  | { kind: "target"; target: string; offline: boolean }
  | { kind: "done"; result: UpgradeResult }
> {
  const { resolveOpts, versionArg, offline, method, persistChannelFn } = opts;

  if (offline) {
    // Channel switching with --offline is not supported: the cached version
    // belongs to the old channel and would install the wrong binary type.
    if (resolveOpts.channelChanged && !versionArg) {
      throw new UpgradeError(
        "unsupported_operation",
        "Cannot switch channels in offline mode — the cached version belongs to the current channel. " +
          "Run 'sentry cli upgrade' with network access to switch channels."
      );
    }
    // Read the cached version BEFORE persisting the channel — setReleaseChannel
    // clears the version cache on channel changes.
    const target = resolveOfflineTarget(versionArg);
    persistChannelFn();
    log.info(`Offline mode: using cached target ${target}`);
    return { kind: "target", target, offline: true };
  }

  // Non-offline: persist channel upfront (no cache dependency)
  persistChannelFn();

  try {
    const resolved = await resolveTargetVersion(resolveOpts);
    if (resolved.kind === "done") {
      return resolved;
    }
    return { kind: "target", target: resolved.target, offline: false };
  } catch (error) {
    // Automatic offline fallback: only for curl-installed binaries (package
    // managers need the network for the actual install, not just version
    // discovery), and only for network errors (not version_not_found etc.)
    if (
      method !== "curl" ||
      !(error instanceof UpgradeError && error.reason === "network_error")
    ) {
      throw error;
    }
    try {
      const target = resolveOfflineTarget(versionArg);
      log.warn("Network unavailable, falling back to cached upgrade target");
      log.info(`Using cached target: ${target}`);
      return { kind: "target", target, offline: true };
    } catch {
      // No cached version either — re-throw original network error
      throw error;
    }
  }
}

/**
 * Validate the installation method against the requested flags and channel.
 * Throws on unsupported combinations.
 */
function validateMethod(
  method: InstallationMethod,
  versionArg: string | undefined,
  channel: ReleaseChannel,
  offline: boolean
): void {
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
  // Offline mode is only supported for curl-installed binaries — package
  // managers always need network to fetch and install packages.
  if (offline && method !== "curl") {
    throw new UpgradeError(
      "unsupported_operation",
      "Offline upgrade is only supported for curl-installed binaries."
    );
  }
}

type ResolveTargetOptions = {
  method: InstallationMethod;
  channel: ReleaseChannel;
  versionArg: string | undefined;
  channelChanged: boolean;
  flags: UpgradeFlags;
};

/**
 * Result of resolving the target version.
 *
 * - `target`: the version string to upgrade/downgrade to (proceed with upgrade)
 * - `UpgradeResult`: structured result when no upgrade should proceed
 *   (check-only mode, or already up to date)
 */
type ResolveResult =
  | { kind: "target"; target: string }
  | { kind: "done"; result: UpgradeResult };

/**
 * Resolve the target version and handle check-only mode.
 *
 * @returns A `ResolveResult` indicating whether to proceed with the upgrade
 *   or return a completed result immediately.
 */
async function resolveTargetVersion(
  opts: ResolveTargetOptions
): Promise<ResolveResult> {
  const { method, channel, versionArg, channelChanged, flags } = opts;
  const latest = await fetchLatestVersion(method, channel);
  const target = versionArg?.replace(VERSION_PREFIX_REGEX, "") ?? latest;

  log.debug(`Channel: ${channel}`);
  log.debug(`Latest version: ${latest}`);
  if (versionArg) {
    log.debug(`Target version: ${target}`);
  }

  if (flags.check) {
    return {
      kind: "done",
      result: buildCheckResult({ target, versionArg, method, channel, flags }),
    };
  }

  // Skip if already on target — unless forced or switching channels
  if (CLI_VERSION === target && !flags.force && !channelChanged) {
    return {
      kind: "done",
      result: {
        action: "up-to-date",
        currentVersion: CLI_VERSION,
        targetVersion: target,
        channel,
        method,
        forced: false,
      },
    };
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

  return { kind: "target", target };
}

/**
 * Build the structured result for check-only mode.
 */
function buildCheckResult(opts: {
  target: string;
  versionArg: string | undefined;
  method: InstallationMethod;
  channel: ReleaseChannel;
  flags: UpgradeFlags;
}): UpgradeResult {
  const { target, versionArg, method, channel, flags } = opts;
  const result: UpgradeResult = {
    action: "checked",
    currentVersion: CLI_VERSION,
    targetVersion: target,
    channel,
    method,
    forced: flags.force,
  };

  // When already on target, no update hint needed
  if (CLI_VERSION !== target) {
    const cmd =
      versionArg && !CHANNEL_VERSIONS.has(versionArg)
        ? `sentry cli upgrade ${target}`
        : "sentry cli upgrade";
    result.warnings = [`Run '${cmd}' to update.`];
  }

  return result;
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
    "--quiet",
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
 * Execute the standard upgrade path: download via curl or package manager,
 * then run setup on the new binary.
 */
async function executeStandardUpgrade(opts: {
  method: InstallationMethod;
  channel: ReleaseChannel;
  versionArg: string | undefined;
  target: string;
  execPath: string;
  offline?: boolean;
  json?: boolean;
}): Promise<void> {
  const { method, channel, versionArg, target, execPath, offline, json } = opts;

  // Use the rolling "nightly" tag only when upgrading to latest nightly
  // (no specific version was requested). A specific version arg always
  // uses its own tag so the correct release is downloaded.
  const downloadTag =
    channel === "nightly" && !versionArg ? NIGHTLY_TAG : undefined;
  const downloadResult = await withProgress(
    { message: `Downloading ${target}...`, json },
    async () => executeUpgrade(method, target, downloadTag, offline)
  );

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
      binaryPath: execPath,
      method,
      channel,
      install: false,
    });
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
 *   4. Return warnings about the old package-manager installation that may still be in PATH
 *
 * @param versionArg - Specific version requested by the user, or undefined for
 *   latest nightly. When a specific version is given, its release tag is used
 *   instead of the rolling "nightly" tag so the correct binary is downloaded.
 * @returns Warnings about the old installation that may shadow the new one
 */
async function migrateToStandaloneForNightly(
  method: InstallationMethod,
  target: string,
  versionArg: string | undefined,
  json?: boolean
): Promise<string[]> {
  log.info("Nightly builds are only available as standalone binaries.");
  log.info("Migrating to standalone installation...");

  // Use the rolling "nightly" tag for latest nightly; use the specific version
  // tag if the user requested a pinned version.
  const downloadTag = versionArg ? undefined : NIGHTLY_TAG;
  const downloadResult = await withProgress(
    { message: `Downloading ${target}...`, json },
    async () => executeUpgrade("curl", target, downloadTag)
  );
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

  // Build warnings about the potentially shadowing old installation.
  // Note: install info is already recorded by the child `setup --install`
  // process, so no redundant setInstallInfo call is needed here.
  const uninstallHints: Record<string, string> = {
    npm: "npm uninstall -g sentry",
    pnpm: "pnpm remove -g sentry",
    bun: "bun remove -g sentry",
    yarn: "yarn global remove sentry",
    brew: "brew uninstall getsentry/tools/sentry",
  };
  const warnings: string[] = [];
  warnings.push(
    `Your ${method}-installed sentry may still appear earlier in PATH.`
  );
  const hint = uninstallHints[method];
  if (hint) {
    warnings.push(`Consider removing it: ${hint}`);
  }
  return warnings;
}

/**
 * Resolve the channel, version arg, method, and channel-changed flag from
 * the positional version argument and flags. Extracted to keep `func()`
 * complexity under the biome limit.
 */
async function resolveContext(
  version: string | undefined,
  flags: UpgradeFlags
): Promise<{
  channel: ReleaseChannel;
  versionArg: string | undefined;
  channelChanged: boolean;
  method: InstallationMethod;
}> {
  const { channel, versionArg } = resolveChannelAndVersion(version);
  const currentChannel = getReleaseChannel();
  const channelChanged = channel !== currentChannel;

  const method = flags.method ?? (await detectInstallationMethod());
  validateMethod(method, versionArg, channel, flags.offline);
  return { channel, versionArg, channelChanged, method };
}

/**
 * Persist the release channel preference. Must be called **after** offline
 * target resolution since `setReleaseChannel()` clears the version check
 * cache on channel changes, which would prevent `resolveOfflineTarget()`
 * from reading the cached version.
 */
function persistChannel(
  channel: ReleaseChannel,
  channelChanged: boolean,
  version: string | undefined
): void {
  if (channelChanged || CHANNEL_VERSIONS.has(version ?? "")) {
    setReleaseChannel(channel);
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
      "  sentry cli upgrade --method npm # Force using npm to upgrade\n" +
      "  sentry cli upgrade --offline    # Upgrade from cached patches (no network)",
  },
  output: { human: formatUpgradeResult },
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
      offline: {
        kind: "boolean",
        brief:
          "Upgrade using only cached version info and patches (no network)",
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
  async *func(this: SentryContext, flags: UpgradeFlags, version?: string) {
    const { channel, versionArg, channelChanged, method } =
      await resolveContext(version, flags);

    log.debug(`Installation method: ${method}`);
    log.debug(`Current version: ${CLI_VERSION}`);

    const resolved = await withProgress(
      { message: "Checking for updates...", json: flags.json },
      async () =>
        resolveTargetWithFallback({
          resolveOpts: { method, channel, versionArg, channelChanged, flags },
          versionArg,
          offline: flags.offline,
          method,
          persistChannelFn: () =>
            persistChannel(channel, channelChanged, version),
        })
    );
    if (resolved.kind === "done") {
      return yield new CommandOutput(resolved.result);
    }

    const { target, offline } = resolved;

    // --check with offline just reports the cached version
    if (flags.check) {
      const checkResult = buildCheckResult({
        target,
        versionArg,
        method,
        channel,
        flags,
      });
      if (offline) {
        checkResult.offline = true;
      }
      return yield new CommandOutput(checkResult);
    }

    // Skip if already on target — unless forced or switching channels
    if (CLI_VERSION === target && !flags.force && !channelChanged) {
      return yield new CommandOutput({
        action: "up-to-date",
        currentVersion: CLI_VERSION,
        targetVersion: target,
        channel,
        method,
        forced: false,
        offline: offline || undefined,
      } satisfies UpgradeResult);
    }
    const downgrade = isDowngrade(CLI_VERSION, target);
    log.debug(`${downgrade ? "Downgrading" : "Upgrading"} to ${target}`);

    // Nightly is GitHub-only. If the current install method is not curl,
    // migrate to a standalone binary first then return — the migration
    // handles setup internally.
    if (channel === "nightly" && method !== "curl") {
      const warnings = await migrateToStandaloneForNightly(
        method,
        target,
        versionArg,
        flags.json
      );
      yield new CommandOutput({
        action: downgrade ? "downgraded" : "upgraded",
        currentVersion: CLI_VERSION,
        targetVersion: target,
        channel,
        method,
        forced: flags.force,
        warnings,
      } satisfies UpgradeResult);
      return;
    }

    await executeStandardUpgrade({
      method,
      channel,
      versionArg,
      target,
      execPath: this.process.execPath,
      offline,
      json: flags.json,
    });

    yield new CommandOutput({
      action: downgrade ? "downgraded" : "upgraded",
      currentVersion: CLI_VERSION,
      targetVersion: target,
      channel,
      method,
      forced: flags.force,
      offline: offline || undefined,
    } satisfies UpgradeResult);
    return;
  },
});
