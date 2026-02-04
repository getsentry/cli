/**
 * Upgrade Module
 *
 * Detects how the CLI was installed and provides self-upgrade functionality.
 */

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
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

/** Sentry CLI install script URL */
const INSTALL_SCRIPT_URL = "https://cli.sentry.dev/install";

/** Standard headers for GitHub API requests */
const GITHUB_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "sentry-cli",
} as const;

/** Regex to strip 'v' prefix from version strings */
export const VERSION_PREFIX_REGEX = /^v/;

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
    { headers: GITHUB_HEADERS, signal },
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
      { method: "HEAD", headers: GITHUB_HEADERS },
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
 * Execute upgrade via curl installer script.
 * Downloads and runs the install script with the specified version.
 *
 * @param version - Target version to install
 * @throws {UpgradeError} When installation fails
 */
function executeUpgradeCurl(version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let curlFailed = false;

    const curl = spawn("curl", ["-fsSL", INSTALL_SCRIPT_URL], {
      stdio: ["ignore", "pipe", "inherit"],
    });

    const bash = spawn("bash", ["-s", "--", "--version", version], {
      stdio: [curl.stdout, "inherit", "inherit"],
    });

    curl.on("close", (code) => {
      if (code !== 0) {
        curlFailed = true;
        bash.kill();
        reject(
          new UpgradeError(
            "execution_failed",
            `curl failed with exit code ${code}`
          )
        );
      }
    });

    bash.on("close", (code) => {
      if (curlFailed) {
        return; // Already rejected by curl handler
      }
      if (code === 0) {
        resolve();
      } else {
        reject(
          new UpgradeError(
            "execution_failed",
            `Upgrade failed with exit code ${code}`
          )
        );
      }
    });

    bash.on("error", (err) => {
      reject(new UpgradeError("execution_failed", err.message));
    });

    curl.on("error", (err) => {
      curlFailed = true;
      reject(
        new UpgradeError("execution_failed", `curl failed: ${err.message}`)
      );
    });
  });
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
