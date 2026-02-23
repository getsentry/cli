/**
 * Upgrade Module Tests
 *
 * Tests for upgrade detection and logic.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import {
  acquireLock,
  getBinaryDownloadUrl,
  isProcessRunning,
  releaseLock,
} from "../../src/lib/binary.js";
import { clearInstallInfo } from "../../src/lib/db/install-info.js";
import { UpgradeError } from "../../src/lib/errors.js";
import {
  executeUpgrade,
  fetchLatestFromGitHub,
  fetchLatestFromNpm,
  fetchLatestVersion,
  getCurlInstallPaths,
  parseInstallationMethod,
  startCleanupOldBinary,
  versionExists,
} from "../../src/lib/upgrade.js";

// Store original fetch for restoration
let originalFetch: typeof globalThis.fetch;

/** Helper to mock fetch without TypeScript errors about missing Bun-specific properties */
function mockFetch(
  fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseInstallationMethod", () => {
  test("parses valid methods", () => {
    expect(parseInstallationMethod("curl")).toBe("curl");
    expect(parseInstallationMethod("brew")).toBe("brew");
    expect(parseInstallationMethod("npm")).toBe("npm");
    expect(parseInstallationMethod("pnpm")).toBe("pnpm");
    expect(parseInstallationMethod("bun")).toBe("bun");
    expect(parseInstallationMethod("yarn")).toBe("yarn");
  });

  test("parses case-insensitively", () => {
    expect(parseInstallationMethod("NPM")).toBe("npm");
    expect(parseInstallationMethod("Curl")).toBe("curl");
    expect(parseInstallationMethod("YARN")).toBe("yarn");
  });

  test("throws on invalid method", () => {
    expect(() => parseInstallationMethod("pip")).toThrow("Invalid method: pip");
    expect(() => parseInstallationMethod("apt")).toThrow("Invalid method: apt");
    expect(() => parseInstallationMethod("")).toThrow("Invalid method: ");
  });
});

describe("fetchLatestFromGitHub", () => {
  test("returns version from GitHub API", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: "v1.2.3",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const version = await fetchLatestFromGitHub();
    expect(version).toBe("1.2.3");
  });

  test("strips v prefix from version", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: "v0.5.0",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const version = await fetchLatestFromGitHub();
    expect(version).toBe("0.5.0");
  });

  test("handles version without v prefix", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: "1.0.0",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const version = await fetchLatestFromGitHub();
    expect(version).toBe("1.0.0");
  });

  test("throws on HTTP error", async () => {
    mockFetch(
      async () =>
        new Response("Not Found", {
          status: 404,
        })
    );

    await expect(fetchLatestFromGitHub()).rejects.toThrow(UpgradeError);
    await expect(fetchLatestFromGitHub()).rejects.toThrow(
      "Failed to fetch from GitHub: 404"
    );
  });

  test("throws on network failure (DNS, timeout, etc.)", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(fetchLatestFromGitHub()).rejects.toThrow(UpgradeError);
    await expect(fetchLatestFromGitHub()).rejects.toThrow(
      "Failed to connect to GitHub: fetch failed"
    );
  });

  test("throws when no tag_name in response", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    await expect(fetchLatestFromGitHub()).rejects.toThrow(
      "No version found in GitHub release"
    );
  });
});

describe("fetchLatestFromNpm", () => {
  test("returns version from npm registry", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            version: "1.2.3",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const version = await fetchLatestFromNpm();
    expect(version).toBe("1.2.3");
  });

  test("throws on HTTP error", async () => {
    mockFetch(
      async () =>
        new Response("Server Error", {
          status: 500,
        })
    );

    await expect(fetchLatestFromNpm()).rejects.toThrow(UpgradeError);
    await expect(fetchLatestFromNpm()).rejects.toThrow(
      "Failed to fetch from npm: 500"
    );
  });

  test("throws on network failure (DNS, timeout, etc.)", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(fetchLatestFromNpm()).rejects.toThrow(UpgradeError);
    await expect(fetchLatestFromNpm()).rejects.toThrow(
      "Failed to connect to npm registry: fetch failed"
    );
  });

  test("throws when no version in response", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    await expect(fetchLatestFromNpm()).rejects.toThrow(
      "No version found in npm registry"
    );
  });
});

describe("UpgradeError", () => {
  test("creates error with default message for unknown_method", () => {
    const error = new UpgradeError("unknown_method");
    expect(error.reason).toBe("unknown_method");
    expect(error.message).toBe(
      "Could not detect installation method. Use --method to specify."
    );
  });

  test("creates error with default message for network_error", () => {
    const error = new UpgradeError("network_error");
    expect(error.reason).toBe("network_error");
    expect(error.message).toBe("Failed to fetch version information.");
  });

  test("creates error with default message for execution_failed", () => {
    const error = new UpgradeError("execution_failed");
    expect(error.reason).toBe("execution_failed");
    expect(error.message).toBe("Upgrade command failed.");
  });

  test("creates error with default message for version_not_found", () => {
    const error = new UpgradeError("version_not_found");
    expect(error.reason).toBe("version_not_found");
    expect(error.message).toBe("The specified version was not found.");
  });

  test("allows custom message", () => {
    const error = new UpgradeError("network_error", "Custom error message");
    expect(error.reason).toBe("network_error");
    expect(error.message).toBe("Custom error message");
  });
});

describe("fetchLatestVersion", () => {
  test("uses GitHub for curl method", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ tag_name: "v2.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const version = await fetchLatestVersion("curl");
    expect(version).toBe("2.0.0");
  });

  test("uses npm for npm method", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ version: "2.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const version = await fetchLatestVersion("npm");
    expect(version).toBe("2.0.0");
  });

  test("uses npm for pnpm method", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ version: "2.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const version = await fetchLatestVersion("pnpm");
    expect(version).toBe("2.0.0");
  });

  test("uses npm for bun method", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ version: "2.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const version = await fetchLatestVersion("bun");
    expect(version).toBe("2.0.0");
  });

  test("uses npm for yarn method", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ version: "2.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const version = await fetchLatestVersion("yarn");
    expect(version).toBe("2.0.0");
  });

  test("uses npm for unknown method", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ version: "2.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const version = await fetchLatestVersion("unknown");
    expect(version).toBe("2.0.0");
  });
});

describe("versionExists", () => {
  test("checks GitHub for curl method - version exists", async () => {
    mockFetch(async () => new Response(null, { status: 200 }));

    const exists = await versionExists("curl", "1.0.0");
    expect(exists).toBe(true);
  });

  test("checks GitHub for curl method - version does not exist", async () => {
    mockFetch(async () => new Response(null, { status: 404 }));

    const exists = await versionExists("curl", "99.99.99");
    expect(exists).toBe(false);
  });

  test("checks npm for npm method - version exists", async () => {
    mockFetch(async () => new Response(null, { status: 200 }));

    const exists = await versionExists("npm", "1.0.0");
    expect(exists).toBe(true);
  });

  test("checks npm for npm method - version does not exist", async () => {
    mockFetch(async () => new Response(null, { status: 404 }));

    const exists = await versionExists("npm", "99.99.99");
    expect(exists).toBe(false);
  });

  test("checks npm for pnpm method", async () => {
    mockFetch(async () => new Response(null, { status: 200 }));

    const exists = await versionExists("pnpm", "1.0.0");
    expect(exists).toBe(true);
  });

  test("checks npm for bun method", async () => {
    mockFetch(async () => new Response(null, { status: 200 }));

    const exists = await versionExists("bun", "1.0.0");
    expect(exists).toBe(true);
  });

  test("checks npm for yarn method", async () => {
    mockFetch(async () => new Response(null, { status: 200 }));

    const exists = await versionExists("yarn", "1.0.0");
    expect(exists).toBe(true);
  });

  test("throws on network failure", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(versionExists("curl", "1.0.0")).rejects.toThrow(UpgradeError);
    await expect(versionExists("curl", "1.0.0")).rejects.toThrow(
      "Failed to connect to GitHub"
    );
  });

  test("throws on network failure for npm", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(versionExists("npm", "1.0.0")).rejects.toThrow(UpgradeError);
    await expect(versionExists("npm", "1.0.0")).rejects.toThrow(
      "Failed to connect to npm registry"
    );
  });
});

describe("executeUpgrade", () => {
  test("throws UpgradeError for unknown installation method", async () => {
    await expect(executeUpgrade("unknown", "1.0.0")).rejects.toThrow(
      UpgradeError
    );
    await expect(executeUpgrade("unknown", "1.0.0")).rejects.toThrow(
      "Could not detect installation method"
    );
  });

  test("throws UpgradeError with unknown_method reason", async () => {
    try {
      await executeUpgrade("unknown", "1.0.0");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeError);
      expect((error as UpgradeError).reason).toBe("unknown_method");
    }
  });
});

describe("getBinaryDownloadUrl", () => {
  test("builds correct URL for current platform", () => {
    const url = getBinaryDownloadUrl("1.0.0");

    // URL should contain the version without 'v' prefix (this repo's tag format)
    expect(url).toContain("/1.0.0/");
    expect(url).toStartWith(
      "https://github.com/getsentry/cli/releases/download/"
    );
    expect(url).toContain("sentry-");

    // Should include architecture
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    expect(url).toContain(arch);
  });
});

describe("getCurlInstallPaths", () => {
  test("returns all required paths", () => {
    const paths = getCurlInstallPaths();

    expect(paths.installPath).toBeDefined();
    expect(paths.tempPath).toBeDefined();
    expect(paths.oldPath).toBeDefined();
    expect(paths.lockPath).toBeDefined();

    // Temp path should be installPath + .download
    expect(paths.tempPath).toBe(`${paths.installPath}.download`);
    // Old path should be installPath + .old
    expect(paths.oldPath).toBe(`${paths.installPath}.old`);
    // Lock path should be installPath + .lock
    expect(paths.lockPath).toBe(`${paths.installPath}.lock`);
  });

  test("includes .exe suffix on Windows", () => {
    const paths = getCurlInstallPaths();
    const suffix = process.platform === "win32" ? ".exe" : "";

    expect(paths.installPath).toEndWith(`sentry${suffix}`);
  });
});

describe("isProcessRunning", () => {
  test("returns true for current process", () => {
    // Our own PID should be running
    expect(isProcessRunning(process.pid)).toBe(true);
  });

  test("returns false for non-existent PID", () => {
    // Use a very high PID that's unlikely to exist
    // PID 4194304 is above typical max PID on most systems
    expect(isProcessRunning(4_194_304)).toBe(false);
  });

  test("returns true on EPERM (process exists but owned by different user)", () => {
    // Mock process.kill to throw EPERM
    const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });
    const spy = spyOn(process, "kill").mockImplementation(() => {
      throw epermError;
    });

    try {
      // EPERM means the process exists, we just can't signal it
      expect(isProcessRunning(12_345)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("returns false on ESRCH (process does not exist)", () => {
    // Mock process.kill to throw ESRCH
    const esrchError = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    const spy = spyOn(process, "kill").mockImplementation(() => {
      throw esrchError;
    });

    try {
      // ESRCH means the process does not exist
      expect(isProcessRunning(12_345)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("acquireLock", () => {
  const binDir = join(homedir(), ".sentry", "bin");
  const testLockPath = join(binDir, "test-upgrade.lock");

  beforeEach(() => {
    // Ensure directory exists
    mkdirSync(binDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test lock file
    try {
      releaseLock(testLockPath);
    } catch {
      // Ignore
    }
  });

  test("creates lock file with current PID", () => {
    // Ensure lock doesn't exist
    releaseLock(testLockPath);

    // Acquire lock
    acquireLock(testLockPath);

    // Verify lock file exists and contains our PID
    const content = readFileSync(testLockPath, "utf-8").trim();
    expect(content).toBe(String(process.pid));
  });

  test("throws when lock is held by running process", () => {
    // Create lock with our own PID (simulates another upgrade in progress)
    writeFileSync(testLockPath, String(process.pid));

    // Trying to acquire should fail
    expect(() => acquireLock(testLockPath)).toThrow(UpgradeError);
    expect(() => acquireLock(testLockPath)).toThrow(
      "Another upgrade is already in progress"
    );
  });

  test("cleans up stale lock from dead process", () => {
    // Create lock with non-existent PID (simulates crashed process)
    writeFileSync(testLockPath, "4194304"); // Very high PID unlikely to exist

    // Acquiring should succeed after cleaning up stale lock
    acquireLock(testLockPath);

    // Lock should now contain our PID
    const content = readFileSync(testLockPath, "utf-8").trim();
    expect(content).toBe(String(process.pid));
  });

  test("handles lock file with invalid content", () => {
    // Create lock with invalid PID
    writeFileSync(testLockPath, "not-a-number");

    // Should treat as stale and acquire successfully
    acquireLock(testLockPath);

    // Lock should now contain our PID
    const content = readFileSync(testLockPath, "utf-8").trim();
    expect(content).toBe(String(process.pid));
  });

  test("throws on permission error instead of infinite recursion", () => {
    // Skip on Windows - chmod doesn't work the same way
    if (platform() === "win32") {
      return;
    }

    // Create a lock file with a stale PID
    writeFileSync(testLockPath, "4194304"); // High PID unlikely to exist

    // Make file unreadable
    chmodSync(testLockPath, 0o000);

    try {
      // Should throw a permission error, not recurse infinitely
      expect(() => acquireLock(testLockPath)).toThrow();
    } finally {
      // Restore permissions so cleanup can work
      chmodSync(testLockPath, 0o644);
    }
  });
});

describe("releaseLock", () => {
  const testLockPath = join(homedir(), ".sentry", "bin", "test-release.lock");

  test("removes lock file", async () => {
    // Create a lock file
    mkdirSync(join(homedir(), ".sentry", "bin"), { recursive: true });
    writeFileSync(testLockPath, String(process.pid));

    // Verify it exists
    expect(Bun.file(testLockPath).size).toBeGreaterThan(0);

    // Release lock
    releaseLock(testLockPath);

    // File should be gone
    expect(await Bun.file(testLockPath).exists()).toBe(false);
  });

  test("does not throw if lock file does not exist", () => {
    // Should not throw
    expect(() => releaseLock(testLockPath)).not.toThrow();
  });
});

describe("executeUpgrade with curl method", () => {
  const binDir = join(homedir(), ".sentry", "bin");

  // Compute paths fresh for each test to avoid stale database state issues
  function getTestPaths() {
    return getCurlInstallPaths();
  }

  beforeEach(() => {
    // Clear any stored install info to ensure we use default paths
    clearInstallInfo();
    // Ensure directory exists
    mkdirSync(binDir, { recursive: true });
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    // Clean up test files - get fresh paths in case DB changed
    const paths = getTestPaths();
    for (const path of [
      paths.installPath,
      paths.tempPath,
      paths.oldPath,
      paths.lockPath,
    ]) {
      try {
        await unlink(path);
      } catch {
        // Ignore
      }
    }
  });

  test("downloads and decompresses gzip binary when .gz URL succeeds", async () => {
    const mockBinaryContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // ELF magic bytes

    // Compress the mock content with gzip
    const gzipped = Bun.gzipSync(mockBinaryContent);

    // Mock fetch: first call returns gzipped content (.gz URL)
    mockFetch(async () => new Response(gzipped, { status: 200 }));

    const result = await executeUpgrade("curl", "1.0.0");

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("tempBinaryPath");
    expect(result).toHaveProperty("lockPath");

    // Verify the decompressed binary matches the original content
    const paths = getTestPaths();
    expect(result!.tempBinaryPath).toBe(paths.tempPath);
    expect(result!.lockPath).toBe(paths.lockPath);
    expect(await Bun.file(result!.tempBinaryPath).exists()).toBe(true);
    const content = await Bun.file(result!.tempBinaryPath).arrayBuffer();
    expect(new Uint8Array(content)).toEqual(mockBinaryContent);
  });

  test("falls back to raw binary when .gz URL returns 404", async () => {
    const mockBinaryContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // ELF magic bytes
    let callCount = 0;

    // Mock fetch: first call (for .gz) returns 404, second returns raw binary
    mockFetch(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(mockBinaryContent, { status: 200 });
    });

    const result = await executeUpgrade("curl", "1.0.0");

    expect(result).not.toBeNull();
    expect(callCount).toBe(2); // Both .gz and raw URL were tried

    // Verify the binary was downloaded
    expect(await Bun.file(result!.tempBinaryPath).exists()).toBe(true);
    const content = await Bun.file(result!.tempBinaryPath).arrayBuffer();
    expect(new Uint8Array(content)).toEqual(mockBinaryContent);
  });

  test("falls back to raw binary when .gz fetch throws network error", async () => {
    const mockBinaryContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    let callCount = 0;

    // Mock fetch: first call throws, second returns raw binary
    mockFetch(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response(mockBinaryContent, { status: 200 });
    });

    const result = await executeUpgrade("curl", "1.0.0");

    expect(result).not.toBeNull();
    expect(callCount).toBe(2);

    const content = await Bun.file(result!.tempBinaryPath).arrayBuffer();
    expect(new Uint8Array(content)).toEqual(mockBinaryContent);
  });

  test("throws on HTTP error when both .gz and raw URLs fail", async () => {
    // Both .gz and raw return errors
    mockFetch(async () => new Response("Not Found", { status: 404 }));

    await expect(executeUpgrade("curl", "99.99.99")).rejects.toThrow(
      UpgradeError
    );
    await expect(executeUpgrade("curl", "99.99.99")).rejects.toThrow(
      "Failed to download binary: HTTP 404"
    );
  });

  test("throws on network failure when both .gz and raw URLs fail", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(executeUpgrade("curl", "1.0.0")).rejects.toThrow(UpgradeError);
    await expect(executeUpgrade("curl", "1.0.0")).rejects.toThrow(
      "Failed to connect to GitHub"
    );
  });

  test("releases lock on failure", async () => {
    mockFetch(async () => new Response("Server Error", { status: 500 }));

    try {
      await executeUpgrade("curl", "1.0.0");
    } catch {
      // Expected to fail
    }

    // Lock should be released even on failure
    const paths = getTestPaths();
    expect(await Bun.file(paths.lockPath).exists()).toBe(false);
  });
});

describe("startCleanupOldBinary", () => {
  // Get paths fresh to match what startCleanupOldBinary() uses
  function getOldPath() {
    return getCurlInstallPaths().oldPath;
  }

  beforeEach(() => {
    // Clear any stored install info to ensure we use default paths
    clearInstallInfo();
  });

  test("removes .old file if it exists", async () => {
    const oldPath = getOldPath();
    // Create the directory and file
    mkdirSync(join(oldPath, ".."), { recursive: true });
    writeFileSync(oldPath, "test content");

    // Verify file exists
    expect(await Bun.file(oldPath).exists()).toBe(true);

    // Clean up is fire-and-forget async, so we need to wait a bit
    startCleanupOldBinary();
    await Bun.sleep(50);

    // File should be gone
    expect(await Bun.file(oldPath).exists()).toBe(false);
  });

  // Note: cleanupOldBinary intentionally does NOT clean up .download files
  // because an upgrade may be in progress in another process. The .download
  // cleanup is handled inside the upgrade flow under the exclusive lock.

  test("does not throw if files do not exist", () => {
    // Ensure files don't exist by attempting cleanup first
    startCleanupOldBinary();

    // Should not throw when called again
    expect(() => startCleanupOldBinary()).not.toThrow();
  });
});
