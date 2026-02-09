/**
 * Binary Management
 *
 * Shared utilities for installing, replacing, and managing the CLI binary.
 * Used by both `setup --install` (fresh installs) and `upgrade` (self-updates).
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { unlink } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { getUserAgent } from "./constants.js";
import { UpgradeError } from "./errors.js";

/** Known directories where the curl installer may place the binary */
export const KNOWN_CURL_DIRS = [".local/bin", "bin", ".sentry/bin"];

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
 * Get the binary filename for the current platform.
 *
 * @returns "sentry.exe" on Windows, "sentry" elsewhere
 */
export function getBinaryFilename(): string {
  return process.platform === "win32" ? "sentry.exe" : "sentry";
}

/**
 * Build paths object from an install path.
 * Returns the install path and derived sibling paths used during
 * download, replacement, and locking.
 *
 * @param installPath - Absolute path to the binary
 * @returns Object with install, temp (.download), old (.old), and lock (.lock) paths
 */
export function getBinaryPaths(installPath: string): {
  installPath: string;
  tempPath: string;
  oldPath: string;
  lockPath: string;
} {
  return {
    installPath,
    tempPath: `${installPath}.download`,
    oldPath: `${installPath}.old`,
    lockPath: `${installPath}.lock`,
  };
}

/**
 * Determine the install directory for a curl-installed binary.
 *
 * Priority:
 * 1. $SENTRY_INSTALL_DIR environment variable (if set and writable)
 * 2. ~/.local/bin (if exists AND in $PATH)
 * 3. ~/bin (if exists AND in $PATH)
 * 4. ~/.sentry/bin (fallback; setup will handle PATH modification)
 *
 * @param homeDir - User's home directory
 * @param env - Process environment variables
 * @returns Absolute path to the install directory
 */
export function determineInstallDir(
  homeDir: string,
  env: NodeJS.ProcessEnv
): string {
  const pathDirs = (env.PATH ?? "").split(delimiter);

  // 1. Explicit override via environment variable
  if (env.SENTRY_INSTALL_DIR) {
    return env.SENTRY_INSTALL_DIR;
  }

  // 2-3. Check well-known directories that are already in PATH
  const candidates = [join(homeDir, ".local", "bin"), join(homeDir, "bin")];

  for (const dir of candidates) {
    if (existsSync(dir) && pathDirs.includes(dir)) {
      return dir;
    }
  }

  // 4. Fallback — setup will handle adding this to PATH
  return join(homeDir, ".sentry", "bin");
}

/**
 * Build headers for GitHub API requests.
 */
export function getGitHubHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": getUserAgent(),
  };
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
export async function fetchWithUpgradeError(
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
    const msg = error instanceof Error ? error.message : String(error);
    throw new UpgradeError(
      "network_error",
      `Failed to connect to ${serviceName}: ${msg}`
    );
  }
}

/**
 * Replace the binary at the install path, handling platform differences.
 *
 * - Unix: Atomic rename overwrites the target (safe even if the old binary is running)
 * - Windows: Rename old binary to .old first (Windows allows renaming running exes
 *   but not deleting/overwriting them), then rename the temp file into place.
 *   The .old file is cleaned up on next CLI startup via cleanupOldBinary().
 *
 * @param tempPath - Path to the new binary (temp download location)
 * @param installPath - Target path to install the binary to
 */
export function replaceBinary(tempPath: string, installPath: string): void {
  if (process.platform === "win32") {
    const oldPath = `${installPath}.old`;
    // Windows: Can't overwrite running exe, but CAN rename it
    try {
      renameSync(installPath, oldPath);
    } catch {
      // Current binary might not exist (fresh install) or .old already exists
      try {
        unlinkSync(oldPath);
        renameSync(installPath, oldPath);
      } catch {
        // If still failing, current binary doesn't exist — that's fine
      }
    }
    renameSync(tempPath, installPath);
  } else {
    // Unix: Atomic rename overwrites target
    renameSync(tempPath, installPath);
  }
}

/**
 * Clean up leftover .old files from previous upgrades.
 * Called on CLI startup to remove .old files left over from Windows upgrades
 * (where the running binary is renamed to .old before replacement).
 *
 * Note: We intentionally do NOT clean up .download files here because an
 * upgrade may be in progress in another process. The .download cleanup is
 * handled inside the upgrade flow under the exclusive lock.
 *
 * @param oldPath - Path to the .old file to clean up
 */
export function cleanupOldBinary(oldPath: string): void {
  // Fire-and-forget: don't await, just let cleanup run in background
  unlink(oldPath).catch(() => {
    // Intentionally ignore errors — file may not exist
  });
}

// Lock Management

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
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      return true;
    }
    // ESRCH or other errors mean process is not running
    return false;
  }
}

/**
 * Acquire an exclusive lock for binary installation/upgrade.
 * Uses atomic file creation with 'wx' flag to prevent race conditions.
 * If lock exists, checks if owning process is still alive (stale lock detection).
 *
 * @param lockPath - Path to the lock file
 * @throws {UpgradeError} If another upgrade/install is already in progress
 */
export function acquireLock(lockPath: string): void {
  try {
    // Try atomic exclusive creation — fails if file exists
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch (error) {
    // If error is not "file exists", re-throw
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    // File exists — check if it's a stale lock
    handleExistingLock(lockPath);
  }
}

/**
 * Handle an existing lock file by checking if it's stale.
 * If stale, removes it and retries acquisition. If active, throws.
 */
function handleExistingLock(lockPath: string): void {
  let content: string;
  try {
    content = readFileSync(lockPath, "utf-8").trim();
  } catch (error) {
    // Only retry if file disappeared (ENOENT) — race condition with another process
    // For other errors (EACCES, etc.), re-throw to avoid infinite recursion
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      acquireLock(lockPath);
      return;
    }
    throw error;
  }

  const existingPid = Number.parseInt(content, 10);

  if (!Number.isNaN(existingPid) && isProcessRunning(existingPid)) {
    // If the lock holder is our parent process (upgrade command spawned
    // setup --install), take over the lock instead of failing. This allows
    // the download→install pipeline to stay locked against concurrent upgrades
    // while handing off from parent to child.
    if (existingPid === process.ppid) {
      writeFileSync(lockPath, String(process.pid));
      return;
    }
    throw new UpgradeError(
      "execution_failed",
      "Another upgrade is already in progress"
    );
  }

  // Stale lock from dead process — remove and retry
  try {
    unlinkSync(lockPath);
  } catch (error) {
    // Only proceed if file already gone (ENOENT)
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  // Retry acquisition (recursive call handles race with other processes)
  acquireLock(lockPath);
}

/**
 * Release the binary lock.
 *
 * @param lockPath - Path to the lock file
 */
export function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore errors — file might already be gone
  }
}

/**
 * Install a binary to the target directory.
 *
 * Copies the source binary to the install directory, handling platform
 * differences (Windows .old rename, Unix atomic replace) and concurrency
 * (PID-based lock file).
 *
 * @param sourcePath - Path to the source binary (e.g., temp download)
 * @param installDir - Target directory to install into
 * @returns Absolute path to the installed binary
 */
export async function installBinary(
  sourcePath: string,
  installDir: string
): Promise<string> {
  mkdirSync(installDir, { recursive: true, mode: 0o755 });

  const installPath = join(installDir, getBinaryFilename());
  const { tempPath, lockPath } = getBinaryPaths(installPath);

  acquireLock(lockPath);

  try {
    // When upgrade spawns setup --install, the child's execPath IS the
    // .download file (sourcePath === tempPath). In that case skip the
    // unlink+copy — the file is already where we need it.
    if (resolve(sourcePath) !== resolve(tempPath)) {
      // Clean up any leftover temp file from interrupted operation
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore if doesn't exist
      }

      // Copy source binary to temp path next to install location
      await Bun.write(tempPath, Bun.file(sourcePath));

      // Set executable permission (Unix only)
      if (process.platform !== "win32") {
        chmodSync(tempPath, 0o755);
      }
    }

    // Atomically replace (handles Windows .old rename)
    replaceBinary(tempPath, installPath);
  } finally {
    releaseLock(lockPath);
  }

  return installPath;
}
