/**
 * Binary Management Tests
 *
 * Tests for shared binary helpers: install directory selection, paths,
 * download URLs, locking, and binary installation.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  determineInstallDir,
  getBinaryDownloadUrl,
  getBinaryFilename,
  getBinaryPaths,
  installBinary,
} from "../../src/lib/binary.js";

describe("getBinaryDownloadUrl", () => {
  test("builds correct URL for current platform", () => {
    const url = getBinaryDownloadUrl("1.0.0");

    expect(url).toContain("/v1.0.0/");
    expect(url).toStartWith(
      "https://github.com/getsentry/cli/releases/download/v"
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
});
