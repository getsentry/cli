/**
 * Upgrade Module
 *
 * Detects how the CLI was installed and provides self-upgrade functionality.
 * Binary management helpers (download URLs, locking, replacement) live in
 * binary.ts and are shared with the setup --install flow.
 */

import { spawn } from "node:child_process";
import { chmodSync, realpathSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import {
  acquireLock,
  cleanupOldBinary,
  fetchWithUpgradeError,
  getBinaryDownloadUrl,
  getBinaryFilename,
  getBinaryPaths,
  getGitHubHeaders,
  KNOWN_CURL_DIRS,
  releaseLock,
} from "./binary.js";
import { CLI_VERSION } from "./constants.js";
import { getInstallInfo, setInstallInfo } from "./db/install-info.js";
import { UpgradeError } from "./errors.js";
import {
  downloadNightlyBlob,
  fetchNightlyManifest,
  findLayerByFilename,
  getAnonymousToken,
  getNightlyVersion,
} from "./ghcr.js";

// Types

export type InstallationMethod =
  | "curl"
  | "brew"
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

/** Regex to strip 'v' prefix from version strings */
export const VERSION_PREFIX_REGEX = /^v/;

// Curl Binary Helpers

/**
 * Known directories where the curl installer may place the binary.
 * Resolved at runtime against the user's home directory.
 * Used for legacy detection (when no install info is stored).
 * Trailing separator ensures startsWith matches a directory boundary
 * (e.g. ~/.local/bin/ won't match ~/.local/binaries/).
 */
const KNOWN_CURL_PATHS = KNOWN_CURL_DIRS.map(
  (dir) => join(homedir(), dir) + sep
);

/**
 * Get file paths for curl-installed binary.
 *
 * Priority for determining install path:
 * 1. Stored install path from DB (if method is curl)
 * 2. process.execPath if it's in a known curl install location
 * 3. Default to ~/.sentry/bin/sentry (fallback for fresh installs)
 *
 * @returns Object with install, temp, old, and lock file paths
 */
export function getCurlInstallPaths(): {
  installPath: string;
  tempPath: string;
  oldPath: string;
  lockPath: string;
} {
  // Check stored install path
  const stored = getInstallInfo();
  if (stored?.path && stored.method === "curl") {
    return getBinaryPaths(stored.path);
  }

  // Check if we're running from a known curl install location
  for (const dir of KNOWN_CURL_PATHS) {
    if (process.execPath.startsWith(dir)) {
      return getBinaryPaths(process.execPath);
    }
  }

  // Fallback to default path (for fresh installs or non-curl runs like tests)
  const defaultPath = join(homedir(), ".sentry", "bin", getBinaryFilename());
  return getBinaryPaths(defaultPath);
}

/**
 * Start cleanup of the .old binary for this install.
 * Called on CLI startup. Fire-and-forget, non-blocking.
 */
export function startCleanupOldBinary(): void {
  const { oldPath } = getCurlInstallPaths();
  cleanupOldBinary(oldPath);
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
 * Detect if the CLI binary is running from a Homebrew Cellar.
 *
 * Homebrew places the real binary deep in the Cellar
 * (e.g. `/opt/homebrew/Cellar/sentry/1.2.3/bin/sentry`) and exposes it
 * via a symlink at the prefix bin dir (e.g. `/opt/homebrew/bin/sentry`).
 * `process.execPath` typically reflects the symlink, not the realpath, so
 * we resolve symlinks first before checking for `/Cellar/`. Falls back to
 * the unresolved path if `realpathSync` throws (e.g. binary was deleted).
 */
function isHomebrewInstall(): boolean {
  let execPath = process.execPath;
  try {
    execPath = realpathSync(execPath);
  } catch {
    // Binary may have been deleted or moved; use the original path
  }
  return execPath.includes("/Cellar/");
}

/**
 * Legacy detection for existing installs that don't have stored install info.
 * Checks known curl install paths and package managers.
 *
 * @returns Detected installation method, or "unknown" if unable to determine
 */
async function detectLegacyInstallationMethod(): Promise<InstallationMethod> {
  // Check known curl install paths
  for (const dir of KNOWN_CURL_PATHS) {
    if (process.execPath.startsWith(dir)) {
      return "curl";
    }
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

/**
 * Detect how the CLI was installed.
 *
 * Priority:
 * 1. Check stored install info in DB (fast path)
 * 2. Fall back to legacy detection for existing installs
 * 3. Auto-save detected method for future runs
 *
 * @returns Detected installation method, or "unknown" if unable to determine
 */
export async function detectInstallationMethod(): Promise<InstallationMethod> {
  // Always check for Homebrew first — the stored install info may be stale
  // (e.g. user previously had a curl install recorded, then switched to
  // Homebrew). The realpath check is cheap and authoritative.
  if (isHomebrewInstall()) {
    return "brew";
  }

  // 1. Check stored info (fast path for non-Homebrew installs)
  const stored = getInstallInfo();
  if (stored?.method) {
    return stored.method;
  }

  // 2. Legacy detection for existing installs (pre-setup command)
  const legacyMethod = await detectLegacyInstallationMethod();

  // 3. Auto-save detected method for future runs
  if (legacyMethod !== "unknown") {
    setInstallInfo({
      method: legacyMethod,
      path: process.execPath,
      version: CLI_VERSION,
    });
  }

  return legacyMethod;
}

// Version Fetching

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
 * Fetch the latest nightly version from GHCR.
 *
 * Performs an anonymous token exchange then fetches the OCI manifest for the
 * `:nightly` tag. The version is extracted from the manifest annotation —
 * only 2 HTTP requests total (token + manifest), no blob download needed.
 *
 * @param signal - Optional AbortSignal to cancel the requests
 * @returns Latest nightly version string (e.g., "0.0.0-nightly.1740000000")
 * @throws {UpgradeError} When fetch fails or the version annotation is missing
 */
export async function fetchLatestNightlyVersion(
  signal?: AbortSignal
): Promise<string> {
  // AbortSignal is not threaded through ghcr helpers, but checking it before
  // each network call ensures we bail out promptly when the process exits.
  if (signal?.aborted) {
    throw Object.assign(new Error("AbortError"), { name: "AbortError" });
  }

  const token = await getAnonymousToken();

  if (signal?.aborted) {
    throw Object.assign(new Error("AbortError"), { name: "AbortError" });
  }

  const manifest = await fetchNightlyManifest(token);
  return getNightlyVersion(manifest);
}

/**
 * Detect if the given version string represents a nightly build.
 *
 * Nightly versions follow the pattern `0.0.0-nightly.<timestamp>`.
 *
 * @param version - Version string to check
 * @returns true if the version is a nightly build
 */
export function isNightlyVersion(version: string): boolean {
  return version.includes("-nightly.");
}

/**
 * Fetch the latest available version based on installation method.
 * curl and brew installations check GitHub releases; package managers check npm.
 *
 * @param method - How the CLI was installed
 * @returns Latest version string (without 'v' prefix)
 * @throws {UpgradeError} When version fetch fails
 */
export function fetchLatestVersion(
  method: InstallationMethod
): Promise<string> {
  return method === "curl" || method === "brew"
    ? fetchLatestFromGitHub()
    : fetchLatestFromNpm();
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
  if (method === "curl" || method === "brew") {
    const response = await fetchWithUpgradeError(
      `${GITHUB_RELEASES_URL}/tags/${version}`,
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

/** Result from downloadBinaryToTemp — includes both the binary path and lock path */
export type DownloadResult = {
  /** Path to the downloaded temporary binary */
  tempBinaryPath: string;
  /** Path to the lock file held during download (caller must release after child exits) */
  lockPath: string;
};

/**
 * Stream a response body through a decompression transform and write to disk.
 *
 * Uses a manual `for await` loop with `Bun.file().writer()` instead of
 * `Bun.write(path, Response)` to work around a Bun event-loop bug where
 * streaming response bodies get GC'd before completing.
 * See: https://github.com/oven-sh/bun/issues/13237
 *
 * @param body - Readable stream from a fetch response
 * @param destPath - File path to write the decompressed output
 */
async function streamDecompressToFile(
  body: ReadableStream<Uint8Array>,
  destPath: string
): Promise<void> {
  const stream = body.pipeThrough(new DecompressionStream("gzip"));
  const writer = Bun.file(destPath).writer();
  try {
    for await (const chunk of stream) {
      writer.write(chunk);
    }
  } finally {
    await writer.end();
  }
}

/**
 * Build the gzip filename for the current platform binary.
 *
 * Nightly builds are stored in GHCR as `sentry-<os>-<arch>.gz` (or
 * `sentry-windows-x64.exe.gz` on Windows). This filename is the
 * `org.opencontainers.image.title` annotation on the matching OCI layer.
 *
 * @returns Filename of the gzip-compressed binary for this platform
 */
function getNightlyGzFilename(): string {
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
  return `sentry-${os}-${arch}${suffix}.gz`;
}

/**
 * Download a nightly binary from GHCR and decompress it to `destPath`.
 *
 * Fetches an anonymous token, retrieves the OCI manifest, finds the layer
 * matching this platform's `.gz` filename, then downloads and decompresses
 * the blob in-stream.
 *
 * @param destPath - File path to write the decompressed binary
 * @throws {UpgradeError} When GHCR fetch or blob download fails
 */
async function downloadNightlyToPath(destPath: string): Promise<void> {
  const token = await getAnonymousToken();
  const manifest = await fetchNightlyManifest(token);
  const filename = getNightlyGzFilename();
  const layer = findLayerByFilename(manifest, filename);
  const response = await downloadNightlyBlob(token, layer.digest);

  if (!response.body) {
    throw new UpgradeError(
      "execution_failed",
      "GHCR blob response had no body"
    );
  }
  await streamDecompressToFile(response.body, destPath);
}

/**
 * Download a stable binary from GitHub Releases and write it to `destPath`.
 *
 * Tries the gzip-compressed URL first (`{url}.gz`, ~37 MB vs ~99 MB),
 * falling back to the raw binary URL on any failure. The compressed
 * download is streamed through DecompressionStream for minimal memory usage.
 *
 * @param version - Stable version string (without 'v' prefix)
 * @param destPath - File path to write the binary (decompressed if gzip)
 * @throws {UpgradeError} When both download attempts fail
 */
async function downloadStableToPath(
  version: string,
  destPath: string
): Promise<void> {
  const url = getBinaryDownloadUrl(version);
  const headers = getGitHubHeaders();

  // Try gzip-compressed download first (~60% smaller)
  try {
    const gzResponse = await fetchWithUpgradeError(
      `${url}.gz`,
      { headers },
      "GitHub"
    );
    if (gzResponse.ok && gzResponse.body) {
      await streamDecompressToFile(gzResponse.body, destPath);
      return;
    }
  } catch {
    // Fall through to raw download
  }

  // Fall back to raw (uncompressed) binary
  const response = await fetchWithUpgradeError(url, { headers }, "GitHub");

  if (!response.ok) {
    throw new UpgradeError(
      "execution_failed",
      `Failed to download binary: HTTP ${response.status}`
    );
  }

  // Fully consume the response body before writing to disk.
  // Bun.write(path, Response) with a large streaming body can exit the
  // process before the download completes (Bun event-loop bug).
  // See: https://github.com/oven-sh/bun/issues/13237
  const body = await response.arrayBuffer();
  await Bun.write(destPath, body);
}

/**
 * Download the new binary to a temporary path and return its location.
 * Used by the upgrade command to download before spawning setup --install.
 *
 * For **nightly** versions (detected via {@link isNightlyVersion}), downloads
 * from GHCR using the OCI blob download protocol via {@link downloadNightlyToPath}.
 *
 * For **stable** versions, downloads from GitHub Releases via
 * {@link downloadStableToPath}.
 *
 * The lock is held on success so concurrent upgrades are blocked during the
 * download→spawn→install pipeline. The caller MUST release the lock after the
 * child process exits (the child may use a different install directory and
 * therefore a different lock file, so it cannot reliably release this one).
 *
 * If the child resolves to the same install path, it takes over the lock via
 * process.ppid recognition in acquireLock — the parent's subsequent release
 * is then a harmless no-op.
 *
 * @param version - Target version to download
 * @returns The downloaded binary path and lock path to release
 * @throws {UpgradeError} When download fails
 */
export async function downloadBinaryToTemp(
  version: string
): Promise<DownloadResult> {
  const { tempPath, lockPath } = getCurlInstallPaths();

  acquireLock(lockPath);

  try {
    // Clean up any leftover temp file from interrupted download
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore if doesn't exist
    }

    if (isNightlyVersion(version)) {
      await downloadNightlyToPath(tempPath);
    } else {
      await downloadStableToPath(version, tempPath);
    }

    // Set executable permission (Unix only)
    if (process.platform !== "win32") {
      chmodSync(tempPath, 0o755);
    }

    return { tempBinaryPath: tempPath, lockPath };
  } catch (error) {
    releaseLock(lockPath);
    throw error;
  }
}

/**
 * Execute upgrade via Homebrew.
 *
 * Runs `brew upgrade getsentry/tools/sentry` which fetches the latest
 * formula from the tap and installs the new version. The version argument
 * is intentionally ignored: Homebrew manages versioning through the formula
 * file in the tap and does not support pinning to an arbitrary release.
 *
 * @throws {UpgradeError} When brew upgrade fails
 */
function executeUpgradeHomebrew(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("brew", ["upgrade", "getsentry/tools/sentry"], {
      stdio: "inherit",
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new UpgradeError(
            "execution_failed",
            `brew upgrade failed with exit code ${code}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(
        new UpgradeError("execution_failed", `brew failed: ${err.message}`)
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
 * For curl installs, downloads the new binary to a temp path and returns a
 * DownloadResult with the binary path and lock path. The caller should spawn
 * `setup --install` on the new binary, then release the lock.
 *
 * For package manager installs, runs the package manager's global install
 * command (which replaces the binary in-place). The caller should then
 * spawn `setup` on the new binary for completions/agent skills.
 *
 * @param method - How the CLI was installed
 * @param version - Target version to install
 * @returns Download result with paths (curl), or null (package manager)
 * @throws {UpgradeError} When method is unknown or installation fails
 */
export async function executeUpgrade(
  method: InstallationMethod,
  version: string
): Promise<DownloadResult | null> {
  switch (method) {
    case "curl":
      return downloadBinaryToTemp(version);
    case "brew":
      await executeUpgradeHomebrew();
      return null;
    case "npm":
    case "pnpm":
    case "bun":
    case "yarn":
      await executeUpgradePackageManager(method, version);
      return null;
    default:
      throw new UpgradeError("unknown_method");
  }
}

/** Valid methods that can be specified via --method flag */
const VALID_METHODS: InstallationMethod[] = [
  "curl",
  "brew",
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
