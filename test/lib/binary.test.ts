/**
 * Binary Management Tests
 *
 * Tests for shared binary helpers: install directory selection, paths,
 * download URLs, locking, and binary installation.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  acquireLock,
  determineInstallDir,
  fetchWithUpgradeError,
  getBinaryDownloadUrl,
  getBinaryFilename,
  getBinaryPaths,
  installBinary,
  releaseLock,
  replaceBinarySync,
} from "../../src/lib/binary.js";
import { UpgradeError } from "../../src/lib/errors.js";

describe("getBinaryDownloadUrl", () => {
  test("builds correct URL for current platform", () => {
    const url = getBinaryDownloadUrl("1.0.0");

    expect(url).toContain("/1.0.0/");
    expect(url).toStartWith(
      "https://github.com/getsentry/cli/releases/download/"
    );
    expect(url).toContain("sentry-");

    const arch = process.arch === "arm64" ? "arm64" : "x64";
    expect(url).toContain(arch);
  });

  test("includes .exe suffix on Windows", () => {
    // Can only truly test this on Windows, but we verify the format
    const url = getBinaryDownloadUrl("2.0.0");
    if (process.platform === "win32") {
      expect(url).toEndWith(".exe");
    } else {
      expect(url).not.toEndWith(".exe");
    }
  });
});

describe("getBinaryFilename", () => {
  test("returns sentry on non-Windows", () => {
    if (process.platform !== "win32") {
      expect(getBinaryFilename()).toBe("sentry");
    }
  });
});

describe("getBinaryPaths", () => {
  test("returns all derived paths from install path", () => {
    const paths = getBinaryPaths("/usr/local/bin/sentry");

    expect(paths.installPath).toBe("/usr/local/bin/sentry");
    expect(paths.tempPath).toBe("/usr/local/bin/sentry.download");
    expect(paths.oldPath).toBe("/usr/local/bin/sentry.old");
    expect(paths.lockPath).toBe("/usr/local/bin/sentry.lock");
  });
});

describe("determineInstallDir", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `binary-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("uses SENTRY_INSTALL_DIR when set", () => {
    const customDir = join(testDir, "custom");
    mkdirSync(customDir, { recursive: true });

    const result = determineInstallDir(testDir, {
      SENTRY_INSTALL_DIR: customDir,
      PATH: "/usr/bin",
    });

    expect(result).toBe(customDir);
  });

  test("prefers ~/.local/bin when it exists and is in PATH", () => {
    const localBin = join(testDir, ".local", "bin");
    mkdirSync(localBin, { recursive: true });

    const result = determineInstallDir(testDir, {
      PATH: `/usr/bin:${localBin}`,
    });

    expect(result).toBe(localBin);
  });

  test("uses ~/bin when it exists and is in PATH but ~/.local/bin is not", () => {
    const homeBin = join(testDir, "bin");
    mkdirSync(homeBin, { recursive: true });

    const result = determineInstallDir(testDir, {
      PATH: `/usr/bin:${homeBin}`,
    });

    expect(result).toBe(homeBin);
  });

  test("falls back to ~/.sentry/bin when no candidates are in PATH", () => {
    const result = determineInstallDir(testDir, {
      PATH: "/usr/bin:/bin",
    });

    expect(result).toBe(join(testDir, ".sentry", "bin"));
  });

  test("skips ~/.local/bin when it exists but is not in PATH", () => {
    const localBin = join(testDir, ".local", "bin");
    mkdirSync(localBin, { recursive: true });

    const result = determineInstallDir(testDir, {
      PATH: "/usr/bin:/bin",
    });

    // Should fall back to ~/.sentry/bin, not use ~/.local/bin
    expect(result).toBe(join(testDir, ".sentry", "bin"));
  });

  test("handles empty PATH", () => {
    const result = determineInstallDir(testDir, {
      PATH: "",
    });

    expect(result).toBe(join(testDir, ".sentry", "bin"));
  });

  test("handles undefined PATH", () => {
    const result = determineInstallDir(testDir, {});

    expect(result).toBe(join(testDir, ".sentry", "bin"));
  });

  test("SENTRY_INSTALL_DIR takes priority over ~/.local/bin", () => {
    const localBin = join(testDir, ".local", "bin");
    mkdirSync(localBin, { recursive: true });
    const customDir = join(testDir, "custom");
    mkdirSync(customDir, { recursive: true });

    const result = determineInstallDir(testDir, {
      SENTRY_INSTALL_DIR: customDir,
      PATH: `/usr/bin:${localBin}`,
    });

    expect(result).toBe(customDir);
  });
});

describe("fetchWithUpgradeError", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns response on success", async () => {
    globalThis.fetch = (async () =>
      new Response("ok", { status: 200 })) as typeof globalThis.fetch;

    const response = await fetchWithUpgradeError(
      "https://example.com",
      {},
      "Test"
    );
    expect(response.status).toBe(200);
  });

  test("re-throws AbortError as-is", async () => {
    globalThis.fetch = (async () => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }) as typeof globalThis.fetch;

    try {
      await fetchWithUpgradeError("https://example.com", {}, "Test");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("AbortError");
      expect(error).not.toBeInstanceOf(UpgradeError);
    }
  });

  test("wraps network errors as UpgradeError", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof globalThis.fetch;

    try {
      await fetchWithUpgradeError("https://example.com", {}, "GitHub");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeError);
      expect((error as UpgradeError).message).toContain("GitHub");
      expect((error as UpgradeError).message).toContain("ECONNREFUSED");
    }
  });

  test("wraps non-Error thrown values as UpgradeError", async () => {
    globalThis.fetch = (async () => {
      // biome-ignore lint/style/useThrowOnlyError: intentionally testing non-Error throw
      throw { toString: () => "custom thrown value" };
    }) as typeof globalThis.fetch;

    try {
      await fetchWithUpgradeError("https://example.com", {}, "Service");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeError);
      expect((error as UpgradeError).message).toContain("custom thrown value");
    }
  });
});

describe("replaceBinarySync", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `replace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("replaces existing binary atomically on Unix", async () => {
    if (process.platform === "win32") return;

    const installPath = join(testDir, "sentry");
    const tempPath = join(testDir, "sentry.download");

    // Write existing binary
    await Bun.write(installPath, "old binary");
    // Write new binary to temp location
    await Bun.write(tempPath, "new binary");

    replaceBinarySync(tempPath, installPath);

    // New content should be at install path
    const content = await Bun.file(installPath).text();
    expect(content).toBe("new binary");

    // Temp file should no longer exist (it was renamed)
    expect(await Bun.file(tempPath).exists()).toBe(false);
  });

  test("works when no existing binary (fresh install)", async () => {
    if (process.platform === "win32") return;

    const installPath = join(testDir, "sentry");
    const tempPath = join(testDir, "sentry.download");

    // Only write temp, no existing binary
    await Bun.write(tempPath, "fresh binary");

    replaceBinarySync(tempPath, installPath);

    const content = await Bun.file(installPath).text();
    expect(content).toBe("fresh binary");
  });
});

describe("installBinary", () => {
  let testDir: string;
  let sourceDir: string;
  let installDir: string;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `binary-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    sourceDir = join(testDir, "source");
    installDir = join(testDir, "install");
    mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("copies binary to install directory", async () => {
    const sourcePath = join(sourceDir, "sentry-temp");
    const content = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // ELF magic
    await Bun.write(sourcePath, content);
    chmodSync(sourcePath, 0o755);

    const result = await installBinary(sourcePath, installDir);

    expect(result).toBe(join(installDir, getBinaryFilename()));
    expect(await Bun.file(result).exists()).toBe(true);

    const installed = await Bun.file(result).arrayBuffer();
    expect(new Uint8Array(installed)).toEqual(content);
  });

  test("creates install directory if it does not exist", async () => {
    const sourcePath = join(sourceDir, "sentry-temp");
    await Bun.write(sourcePath, "binary content");
    chmodSync(sourcePath, 0o755);

    const nestedDir = join(installDir, "deep", "nested");
    const result = await installBinary(sourcePath, nestedDir);

    expect(result).toBe(join(nestedDir, getBinaryFilename()));
    expect(await Bun.file(result).exists()).toBe(true);
  });

  test("cleans up lock file after installation", async () => {
    const sourcePath = join(sourceDir, "sentry-temp");
    await Bun.write(sourcePath, "binary content");
    chmodSync(sourcePath, 0o755);

    const installPath = await installBinary(sourcePath, installDir);
    const lockPath = `${installPath}.lock`;

    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test("cleans up temp .download file after installation", async () => {
    const sourcePath = join(sourceDir, "sentry-temp");
    await Bun.write(sourcePath, "binary content");
    chmodSync(sourcePath, 0o755);

    const installPath = await installBinary(sourcePath, installDir);
    const tempPath = `${installPath}.download`;

    expect(await Bun.file(tempPath).exists()).toBe(false);
  });

  test("overwrites existing binary", async () => {
    // Install initial binary
    mkdirSync(installDir, { recursive: true });
    const existingPath = join(installDir, getBinaryFilename());
    await Bun.write(existingPath, "old content");

    // Install new binary over it
    const sourcePath = join(sourceDir, "sentry-temp");
    await Bun.write(sourcePath, "new content");
    chmodSync(sourcePath, 0o755);

    await installBinary(sourcePath, installDir);

    const content = await Bun.file(existingPath).text();
    expect(content).toBe("new content");
  });

  test("handles sourcePath === tempPath (upgrade spawn case)", async () => {
    if (process.platform === "win32") return;

    // Simulate the upgrade flow: the source binary IS already the .download file
    // (this happens when upgrade downloads to installPath.download, then spawns
    // setup --install where execPath is that .download file)
    mkdirSync(installDir, { recursive: true });
    const tempPath = join(installDir, `${getBinaryFilename()}.download`);
    await Bun.write(tempPath, "upgraded binary");
    chmodSync(tempPath, 0o755);

    const result = await installBinary(tempPath, installDir);

    expect(result).toBe(join(installDir, getBinaryFilename()));
    const content = await Bun.file(result).text();
    expect(content).toBe("upgraded binary");
  });
});

describe("acquireLock", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("creates lock file with current PID", () => {
    const lockPath = join(testDir, "test.lock");
    acquireLock(lockPath);

    const content = readFileSync(lockPath, "utf-8").trim();
    expect(content).toBe(String(process.pid));

    releaseLock(lockPath);
  });

  test("throws when lock held by another running process", () => {
    const lockPath = join(testDir, "test.lock");
    // PID 1 (init/systemd) is always running
    writeFileSync(lockPath, "1");

    expect(() => acquireLock(lockPath)).toThrow(
      "Another upgrade is already in progress"
    );
  });

  test("takes over stale lock from dead process", () => {
    const lockPath = join(testDir, "test.lock");
    // Use an absurdly high PID that won't exist
    writeFileSync(lockPath, "999999999");

    acquireLock(lockPath);

    const content = readFileSync(lockPath, "utf-8").trim();
    expect(content).toBe(String(process.pid));

    releaseLock(lockPath);
  });

  test("allows child process to take over parent lock via process.ppid", () => {
    const lockPath = join(testDir, "test.lock");
    // Write the current process's parent PID — simulates the upgrade command
    // holding the lock when the child (setup --install) tries to acquire it
    writeFileSync(lockPath, String(process.ppid));

    // Should NOT throw — recognizes parent PID and takes over
    acquireLock(lockPath);

    const content = readFileSync(lockPath, "utf-8").trim();
    expect(content).toBe(String(process.pid));

    releaseLock(lockPath);
  });
});
