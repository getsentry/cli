/**
 * Upgrade Module
 *
 * Detects how the CLI was installed and provides self-upgrade functionality.
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getUserAgent } from "./constants.js";
import { UpgradeError } from "./errors.js";

// Types

export type InstallationMethod =
  | "curl"
  | "npm"
  | "pnpm"
  | "bun"
  | "yarn"
  | "unknown";

/** Package managers that can be used for global installs */
type PackageManager = "npm" | "pnpm" | "bun" | "yarn";

// Constants

/** GitHub API base URL for releases */
const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/getsentry/cli/releases";

/** npm registry base URL */
const NPM_REGISTRY_URL = "https://registry.npmjs.org/sentry";

/** Build headers for GitHub API requests */
function getGitHubHeaders() {
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": getUserAgent(),
  };
}

/** Regex to strip 'v' prefix from version strings */
export const VERSION_PREFIX_REGEX = /^v/;

// Curl Binary Helpers

/**
 * Build the download URL for a platform-specific binary from GitHub releases.
 *
 * @param version - Version to download (without 'v' prefix)
 * @returns Download URL for the binary
 */
export function getBinaryDownloadUrl(version: string): string {
  let os: string;
  if (process.platform === "darwin") {
    os = "darwin";
  } else if (process.platform === "win32") {
    os = "windows";
  } else {
    os = "linux";
  }

  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const suffix = process.platform === "win32" ? ".exe" : "";

  return `https://github.com/getsentry/cli/releases/download/v${version}/sentry-${os}-${arch}${suffix}`;
}

/**
 * Get file paths for curl-installed binary.
 *
 * @returns Object with install, temp, old, and lock file paths
 */
export function getCurlInstallPaths(): {
  installPath: string;
  tempPath: string;
  oldPath: string;
  lockPath: string;
} {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const installPath = join(homedir(), ".sentry", "bin", `sentry${suffix}`);
  return {
    installPath,
    tempPath: `${installPath}.download`,
    oldPath: `${installPath}.old`,
    lockPath: `${installPath}.lock`,
  };
}

/**
 * Clean up leftover .old files from previous upgrades.
 * Called on CLI startup to remove .old files left over from Windows upgrades
 * (where the running binary is renamed to .old before replacement).
 *
 * Note: We intentionally do NOT clean up .download files here because an
 * upgrade may be in progress in another process. The .download cleanup is
 * handled inside executeUpgradeCurl() under the exclusive lock.
 *
 * Fire-and-forget, non-blocking.
 */
export function cleanupOldBinary(): void {
  const { oldPath } = getCurlInstallPaths();
  // Fire-and-forget: don't await, just let cleanup run in background
  unlink(oldPath).catch(() => {
    // Intentionally ignore errors - file may not exist
  });
}

/**
 * Check if a process with the given PID is still running.
 *
 * On Unix, process.kill(pid, 0) throws:
 * - ESRCH: Process does not exist (not running)
 * - EPERM: Process exists but we lack permission to signal it (IS running)
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 just checks if process exists
    return true;
  } catch (error) {
    // EPERM means process exists but we can't signal it (different user)
    // This is still a running process, so return true
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      return true;
    }
    // ESRCH or other errors mean process is not running
    return false;
  }
}

/**
 * Acquire an exclusive lock for the upgrade process.
 * Uses atomic file creation with 'wx' flag to prevent race conditions.
 * If lock exists, checks if owning process is still alive (stale lock detection).
 *
 * @param lockPath - Path to the lock file
 * @throws {UpgradeError} If another upgrade is already in progress
 */
export function acquireUpgradeLock(lockPath: string): void {
  try {
    // Try atomic exclusive creation - fails if file exists
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    // Lock acquired successfully
  } catch (error) {
    // If error is not "file exists", re-throw
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    // File exists - check if it's a stale lock
    handleExistingLock(lockPath);
  }
}

/**
 * Handle an existing lock file by checking if it's stale.
 * If stale, removes it and retries acquisition. If active, throws.
 */
function handleExistingLock(lockPath: string): void {
  // Lock file exists - read and check if owner process is still alive
  let content: string;
  try {
    content = readFileSync(lockPath, "utf-8").trim();
  } catch (error) {
    // Only retry if file disappeared (ENOENT) - race condition with another process
    // For other errors (EACCES, etc.), re-throw to avoid infinite recursion
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      acquireUpgradeLock(lockPath);
      return;
    }
    throw error;
  }

  const existingPid = Number.parseInt(content, 10);

  if (!Number.isNaN(existingPid) && isProcessRunning(existingPid)) {
    throw new UpgradeError(
      "execution_failed",
      "Another upgrade is already in progress"
    );
  }

  // Stale lock from dead process - remove and retry
  try {
    unlinkSync(lockPath);
  } catch (error) {
    // Only proceed if file already gone (ENOENT) - someone else removed it
    // For other errors (EACCES, etc.), re-throw to avoid infinite recursion
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  // Retry acquisition (recursive call handles race with other processes)
  acquireUpgradeLock(lockPath);
}

/**
 * Release the upgrade lock.
 *
 * @param lockPath - Path to the lock file
 */
export function releaseUpgradeLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore errors - file might already be gone
  }
}

// Detection

/**
 * Run a shell command and capture stdout.
 *
 * @param command - Command to execute
 * @param args - Command arguments
 * @returns stdout content and exit code
 */
function runCommand(
  command: string,
  args: string[]
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    // Drain stderr to prevent blocking (content is intentionally discarded)
    proc.stderr.resume();

    proc.on("close", (code) => {
      resolve({ stdout: stdout.trim(), exitCode: code ?? 1 });
    });

    proc.on("error", reject);
  });
}

/**
 * Check if a package is installed globally with a specific package manager.
 *
 * @param pm - Package manager to check
 * @returns true if sentry is installed globally via this package manager
 */
async function isInstalledWith(pm: PackageManager): Promise<boolean> {
  try {
    const args =
      pm === "yarn"
        ? ["global", "list", "--depth=0"]
        : ["list", "-g", "sentry"];

    const { stdout, exitCode } = await runCommand(pm, args);

    return exitCode === 0 && stdout.includes("sentry@");
  } catch {
    return false;
  }
}

/**
 * Detect how the CLI was installed by checking executable path and package managers.
 *
 * @returns Detected installation method, or "unknown" if unable to determine
 */
export async function detectInstallationMethod(): Promise<InstallationMethod> {
  const sentryBinPath = join(homedir(), ".sentry", "bin");

  // curl installer places binary in ~/.sentry/bin
  if (process.execPath.startsWith(sentryBinPath)) {
    return "curl";
  }

  // Check package managers in order of popularity
  const packageManagers: PackageManager[] = ["npm", "pnpm", "bun", "yarn"];

  for (const pm of packageManagers) {
    if (await isInstalledWith(pm)) {
      return pm;
    }
  }

  return "unknown";
}

// Version Fetching

/** Extract error message from unknown caught value */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch wrapper that converts network errors to UpgradeError.
 * Handles DNS failures, timeouts, and other connection issues.
 *
 * @param url - URL to fetch
 * @param init - Fetch options
 * @param serviceName - Service name for error messages (e.g., "GitHub")
 * @returns Response object
 * @throws {UpgradeError} On network failure
 * @throws {Error} AbortError if signal is aborted (re-thrown as-is)
 */
async function fetchWithUpgradeError(
  url: string,
  init: RequestInit,
  serviceName: string
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    // Re-throw AbortError as-is so callers can handle it specifically
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new UpgradeError(
      "network_error",
      `Failed to connect to ${serviceName}: ${getErrorMessage(error)}`
    );
  }
}

/**
 * Fetch the latest version from GitHub releases.
 *
 * @param signal - Optional AbortSignal to cancel the request
 * @returns Latest version string (without 'v' prefix)
 * @throws {UpgradeError} When fetch fails or response is invalid
 * @throws {Error} AbortError if signal is aborted
 */
export async function fetchLatestFromGitHub(
  signal?: AbortSignal
): Promise<string> {
  const response = await fetchWithUpgradeError(
    `${GITHUB_RELEASES_URL}/latest`,
    { headers: getGitHubHeaders(), signal },
    "GitHub"
  );

  if (!response.ok) {
    throw new UpgradeError(
      "network_error",
      `Failed to fetch from GitHub: ${response.status}`
    );
  }

  const data = (await response.json()) as { tag_name?: string };

  if (!data.tag_name) {
    throw new UpgradeError(
      "network_error",
      "No version found in GitHub release"
    );
  }

  return data.tag_name.replace(VERSION_PREFIX_REGEX, "");
}

/**
 * Fetch the latest version from npm registry.
 *
 * @returns Latest version string
 * @throws {UpgradeError} When fetch fails or response is invalid
 */
export async function fetchLatestFromNpm(): Promise<string> {
  const response = await fetchWithUpgradeError(
    `${NPM_REGISTRY_URL}/latest`,
    { headers: { Accept: "application/json" } },
    "npm registry"
  );

  if (!response.ok) {
    throw new UpgradeError(
      "network_error",
      `Failed to fetch from npm: ${response.status}`
    );
  }

  const data = (await response.json()) as { version?: string };

  if (!data.version) {
    throw new UpgradeError("network_error", "No version found in npm registry");
  }

  return data.version;
}

/**
 * Fetch the latest available version based on installation method.
 * curl installations check GitHub releases; package managers check npm.
 *
 * @param method - How the CLI was installed
 * @returns Latest version string (without 'v' prefix)
 * @throws {UpgradeError} When version fetch fails
 */
export function fetchLatestVersion(
  method: InstallationMethod
): Promise<string> {
  return method === "curl" ? fetchLatestFromGitHub() : fetchLatestFromNpm();
}

/**
 * Check if a specific version exists in the appropriate registry.
 * curl installations check GitHub releases; package managers check npm.
 *
 * @param method - How the CLI was installed
 * @param version - Version to check (without 'v' prefix)
 * @returns true if the version exists
 * @throws {UpgradeError} When unable to connect to registry
 */
export async function versionExists(
  method: InstallationMethod,
  version: string
): Promise<boolean> {
  if (method === "curl") {
    const response = await fetchWithUpgradeError(
      `${GITHUB_RELEASES_URL}/tags/v${version}`,
      { method: "HEAD", headers: getGitHubHeaders() },
      "GitHub"
    );
    return response.ok;
  }

  const response = await fetchWithUpgradeError(
    `${NPM_REGISTRY_URL}/${version}`,
    { method: "HEAD" },
    "npm registry"
  );
  return response.ok;
}

// Upgrade Execution

/**
 * Execute upgrade by downloading binary directly from GitHub releases.
 * Downloads the platform-specific binary and replaces the current installation.
 *
 * Uses a PID-based lock file to prevent concurrent upgrades.
 *
 * On Windows, the running executable cannot be overwritten directly, so we:
 * 1. Rename the current binary to .old
 * 2. Write the new binary to the original path
 * 3. The .old file is cleaned up on next CLI startup via cleanupOldBinary()
 *
 * @param version - Target version to install
 * @throws {UpgradeError} When download or installation fails, or if another upgrade is running
 */
async function executeUpgradeCurl(version: string): Promise<void> {
  const url = getBinaryDownloadUrl(version);
  const { installPath, tempPath, oldPath, lockPath } = getCurlInstallPaths();
  const isWindows = process.platform === "win32";

  // Acquire exclusive lock to prevent concurrent upgrades
  acquireUpgradeLock(lockPath);

  try {
    // Clean up any leftover temp file from interrupted download
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore if doesn't exist
    }

    // Download binary
    const response = await fetchWithUpgradeError(
      url,
      { headers: getGitHubHeaders() },
      "GitHub"
    );

    if (!response.ok) {
      throw new UpgradeError(
        "execution_failed",
        `Failed to download binary: HTTP ${response.status}`
      );
    }

    // Write to temp file
    await Bun.write(tempPath, response);

    // Set executable permission (Unix only)
    if (!isWindows) {
      chmodSync(tempPath, 0o755);
    }

    // Replace the binary
    if (isWindows) {
      // Windows: Can't overwrite running exe, but CAN rename it
      // Rename current -> .old, then rename temp -> current
      try {
        renameSync(installPath, oldPath);
      } catch {
        // Current binary might not exist (fresh install) or .old already exists
        // Try to remove .old first, then retry
        try {
          unlinkSync(oldPath);
          renameSync(installPath, oldPath);
        } catch {
          // If still failing, current binary doesn't exist - that's fine
        }
      }
      renameSync(tempPath, installPath);
    } else {
      // Unix: Atomic rename overwrites target
      renameSync(tempPath, installPath);
    }
  } finally {
    releaseUpgradeLock(lockPath);
  }
}

/**
 * Execute upgrade via package manager global install.
 *
 * @param pm - Package manager to use
 * @param version - Target version to install
 * @throws {UpgradeError} When installation fails
 */
function executeUpgradePackageManager(
  pm: PackageManager,
  version: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args =
      pm === "yarn"
        ? ["global", "add", `sentry@${version}`]
        : ["install", "-g", `sentry@${version}`];

    const proc = spawn(pm, args, { stdio: "inherit" });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new UpgradeError(
            "execution_failed",
            `${pm} install failed with exit code ${code}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(
        new UpgradeError("execution_failed", `${pm} failed: ${err.message}`)
      );
    });
  });
}

/**
 * Execute the upgrade using the appropriate method.
 *
 * @param method - How the CLI was installed
 * @param version - Target version to install
 * @throws {UpgradeError} When method is unknown or installation fails
 */
export function executeUpgrade(
  method: InstallationMethod,
  version: string
): Promise<void> {
  switch (method) {
    case "curl":
      return executeUpgradeCurl(version);
    case "npm":
    case "pnpm":
    case "bun":
    case "yarn":
      return executeUpgradePackageManager(method, version);
    default:
      throw new UpgradeError("unknown_method");
  }
}

/** Valid methods that can be specified via --method flag */
const VALID_METHODS: InstallationMethod[] = [
  "curl",
  "npm",
  "pnpm",
  "bun",
  "yarn",
];

/**
 * Parse and validate an installation method from user input.
 *
 * @param value - Method string from --method flag
 * @returns Validated installation method
 * @throws {Error} When method is not recognized
 */
export function parseInstallationMethod(value: string): InstallationMethod {
  const normalized = value.toLowerCase() as InstallationMethod;

  if (!VALID_METHODS.includes(normalized)) {
    throw new Error(
      `Invalid method: ${value}. Must be one of: ${VALID_METHODS.join(", ")}`
    );
  }

  return normalized;
}
