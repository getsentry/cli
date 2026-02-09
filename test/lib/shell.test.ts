/**
 * Shell Utilities Tests
 *
 * Unit tests for I/O-dependent shell operations (file creation, writing,
 * GitHub Actions). Pure function tests are in shell.property.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addToGitHubPath,
  addToPath,
  detectShell,
  findExistingConfigFile,
  getConfigCandidates,
} from "../../src/lib/shell.js";

describe("shell utilities", () => {
  describe("getConfigCandidates", () => {
    test("returns fallback candidates for unknown shell", () => {
      const candidates = getConfigCandidates(
        "unknown",
        "/home/user",
        "/home/user/.config"
      );
      expect(candidates).toContain("/home/user/.bashrc");
      expect(candidates).toContain("/home/user/.bash_profile");
      expect(candidates).toContain("/home/user/.profile");
    });
  });

  describe("findExistingConfigFile", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(
        "/tmp",
        `shell-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("returns first existing file", () => {
      const file1 = join(testDir, ".bashrc");
      const file2 = join(testDir, ".bash_profile");
      writeFileSync(file2, "# bash profile");

      const result = findExistingConfigFile([file1, file2]);
      expect(result).toBe(file2);
    });

    test("returns null when no files exist", () => {
      const result = findExistingConfigFile([
        join(testDir, ".nonexistent1"),
        join(testDir, ".nonexistent2"),
      ]);
      expect(result).toBeNull();
    });
  });

  describe("detectShell", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(
        "/tmp",
        `shell-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("detects shell type and finds config file", () => {
      const zshrc = join(testDir, ".zshrc");
      writeFileSync(zshrc, "# zshrc");

      const result = detectShell("/bin/zsh", testDir);
      expect(result.type).toBe("zsh");
      expect(result.configFile).toBe(zshrc);
    });

    test("returns null configFile when none exist", () => {
      const result = detectShell("/bin/zsh", testDir);
      expect(result.type).toBe("zsh");
      expect(result.configFile).toBeNull();
    });
  });

  describe("addToPath", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(
        "/tmp",
        `shell-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("creates config file if it doesn't exist", async () => {
      const configFile = join(testDir, ".bashrc");
      const result = await addToPath(
        configFile,
        "/home/user/.sentry/bin",
        "bash"
      );

      expect(result.modified).toBe(true);
      expect(result.configFile).toBe(configFile);

      const content = await Bun.file(configFile).text();
      expect(content).toContain('export PATH="/home/user/.sentry/bin:$PATH"');
    });

    test("appends to existing config file", async () => {
      const configFile = join(testDir, ".bashrc");
      writeFileSync(configFile, "# existing content\n");

      const result = await addToPath(
        configFile,
        "/home/user/.sentry/bin",
        "bash"
      );

      expect(result.modified).toBe(true);

      const content = await Bun.file(configFile).text();
      expect(content).toContain("# existing content");
      expect(content).toContain("# sentry");
      expect(content).toContain('export PATH="/home/user/.sentry/bin:$PATH"');
    });

    test("skips if already configured", async () => {
      const configFile = join(testDir, ".bashrc");
      writeFileSync(
        configFile,
        '# sentry\nexport PATH="/home/user/.sentry/bin:$PATH"\n'
      );

      const result = await addToPath(
        configFile,
        "/home/user/.sentry/bin",
        "bash"
      );

      expect(result.modified).toBe(false);
      expect(result.message).toContain("already configured");
    });

    test("appends newline separator when file doesn't end with newline", async () => {
      const configFile = join(testDir, ".bashrc");
      writeFileSync(configFile, "# existing content without newline");

      const result = await addToPath(
        configFile,
        "/home/user/.sentry/bin",
        "bash"
      );

      expect(result.modified).toBe(true);

      const content = await Bun.file(configFile).text();
      expect(content).toContain(
        "# existing content without newline\n\n# sentry\n"
      );
    });

    test("returns manualCommand when config file cannot be created", async () => {
      const configFile = "/dev/null/impossible/path/.bashrc";
      const result = await addToPath(
        configFile,
        "/home/user/.sentry/bin",
        "bash"
      );

      expect(result.modified).toBe(false);
      expect(result.manualCommand).toBe(
        'export PATH="/home/user/.sentry/bin:$PATH"'
      );
    });
  });

  describe("addToGitHubPath", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(
        "/tmp",
        `shell-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("returns false when not in GitHub Actions", async () => {
      const result = await addToGitHubPath("/usr/local/bin", {});
      expect(result).toBe(false);
    });

    test("returns false when GITHUB_PATH is not set", async () => {
      const result = await addToGitHubPath("/usr/local/bin", {
        GITHUB_ACTIONS: "true",
      });
      expect(result).toBe(false);
    });

    test("writes directory to GITHUB_PATH file", async () => {
      const pathFile = join(testDir, "github_path");
      writeFileSync(pathFile, "");

      const result = await addToGitHubPath("/usr/local/bin", {
        GITHUB_ACTIONS: "true",
        GITHUB_PATH: pathFile,
      });

      expect(result).toBe(true);
      const content = await Bun.file(pathFile).text();
      expect(content).toContain("/usr/local/bin");
    });

    test("does not duplicate existing directory", async () => {
      const pathFile = join(testDir, "github_path");
      writeFileSync(pathFile, "/usr/local/bin\n");

      const result = await addToGitHubPath("/usr/local/bin", {
        GITHUB_ACTIONS: "true",
        GITHUB_PATH: pathFile,
      });

      expect(result).toBe(true);
      const content = await Bun.file(pathFile).text();
      expect(content).toBe("/usr/local/bin\n");
    });

    test("returns false when GITHUB_PATH file is not writable", async () => {
      const result = await addToGitHubPath("/usr/local/bin", {
        GITHUB_ACTIONS: "true",
        GITHUB_PATH: "/dev/null/impossible",
      });

      expect(result).toBe(false);
    });
  });
});
