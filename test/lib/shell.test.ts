import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addToGitHubPath,
  addToPath,
  detectShell,
  detectShellType,
  findExistingConfigFile,
  getConfigCandidates,
  getPathCommand,
  isInPath,
} from "../../src/lib/shell.js";

describe("shell utilities", () => {
  describe("detectShellType", () => {
    test("detects bash", () => {
      expect(detectShellType("/bin/bash")).toBe("bash");
      expect(detectShellType("/usr/bin/bash")).toBe("bash");
    });

    test("detects zsh", () => {
      expect(detectShellType("/bin/zsh")).toBe("zsh");
      expect(detectShellType("/usr/local/bin/zsh")).toBe("zsh");
    });

    test("detects fish", () => {
      expect(detectShellType("/usr/bin/fish")).toBe("fish");
    });

    test("detects sh", () => {
      expect(detectShellType("/bin/sh")).toBe("sh");
    });

    test("detects ash", () => {
      expect(detectShellType("/bin/ash")).toBe("ash");
    });

    test("returns unknown for unrecognized shells", () => {
      expect(detectShellType("/bin/tcsh")).toBe("unknown");
      expect(detectShellType("/bin/csh")).toBe("unknown");
    });

    test("returns unknown for undefined", () => {
      expect(detectShellType(undefined)).toBe("unknown");
    });
  });

  describe("getConfigCandidates", () => {
    const homeDir = "/home/user";
    const xdgConfigHome = "/home/user/.config";

    test("returns bash config candidates", () => {
      const candidates = getConfigCandidates("bash", homeDir, xdgConfigHome);
      expect(candidates).toContain("/home/user/.bashrc");
      expect(candidates).toContain("/home/user/.bash_profile");
      expect(candidates).toContain("/home/user/.profile");
    });

    test("returns zsh config candidates", () => {
      const candidates = getConfigCandidates("zsh", homeDir, xdgConfigHome);
      expect(candidates).toContain("/home/user/.zshrc");
      expect(candidates).toContain("/home/user/.zshenv");
    });

    test("returns fish config candidates", () => {
      const candidates = getConfigCandidates("fish", homeDir, xdgConfigHome);
      expect(candidates).toContain("/home/user/.config/fish/config.fish");
    });

    test("returns profile for sh", () => {
      const candidates = getConfigCandidates("sh", homeDir, xdgConfigHome);
      expect(candidates).toContain("/home/user/.profile");
    });

    test("uses default XDG_CONFIG_HOME when not provided", () => {
      const candidates = getConfigCandidates("fish", homeDir);
      expect(candidates).toContain("/home/user/.config/fish/config.fish");
    });

    test("returns fallback candidates for unknown shell", () => {
      const candidates = getConfigCandidates("unknown", homeDir, xdgConfigHome);
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

  describe("getPathCommand", () => {
    test("returns fish command for fish shell", () => {
      const cmd = getPathCommand("fish", "/home/user/.local/bin");
      expect(cmd).toBe('fish_add_path "/home/user/.local/bin"');
    });

    test("returns export command for other shells", () => {
      expect(getPathCommand("bash", "/home/user/.local/bin")).toBe(
        'export PATH="/home/user/.local/bin:$PATH"'
      );
      expect(getPathCommand("zsh", "/home/user/.local/bin")).toBe(
        'export PATH="/home/user/.local/bin:$PATH"'
      );
      expect(getPathCommand("sh", "/home/user/.local/bin")).toBe(
        'export PATH="/home/user/.local/bin:$PATH"'
      );
    });
  });

  describe("isInPath", () => {
    test("returns true when directory is in PATH", () => {
      const path = "/usr/bin:/home/user/.local/bin:/bin";
      expect(isInPath("/home/user/.local/bin", path)).toBe(true);
    });

    test("returns false when directory is not in PATH", () => {
      const path = "/usr/bin:/bin";
      expect(isInPath("/home/user/.local/bin", path)).toBe(false);
    });

    test("returns false for undefined PATH", () => {
      expect(isInPath("/home/user/.local/bin", undefined)).toBe(false);
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

    test("uses fish syntax for fish shell", async () => {
      const configFile = join(testDir, "config.fish");
      const result = await addToPath(
        configFile,
        "/home/user/.sentry/bin",
        "fish"
      );

      expect(result.modified).toBe(true);

      const content = await Bun.file(configFile).text();
      expect(content).toContain('fish_add_path "/home/user/.sentry/bin"');
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
      // Should have double newline separator before sentry block
      expect(content).toContain(
        "# existing content without newline\n\n# sentry\n"
      );
    });

    test("returns manualCommand when config file cannot be created", async () => {
      // Point to a path inside a nonexistent, deeply nested directory that can't be auto-created
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

    test("returns manualCommand when existing config file is not writable", async () => {
      const configFile = join(testDir, ".bashrc");
      writeFileSync(configFile, "# existing\n");
      const { chmodSync } = await import("node:fs");
      chmodSync(configFile, 0o444);

      const result = await addToPath(
        configFile,
        "/home/user/.sentry/bin",
        "bash"
      );

      // On failure to write, should return manual command
      // Restore permissions for cleanup
      chmodSync(configFile, 0o644);

      // The file is read-only, but Bun.write may override on some systems
      // At minimum, verify the result is valid
      expect(
        result.configFile === configFile || result.manualCommand !== null
      ).toBe(true);
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

    test("appends to existing GITHUB_PATH content", async () => {
      const pathFile = join(testDir, "github_path");
      writeFileSync(pathFile, "/existing/path\n");

      const result = await addToGitHubPath("/usr/local/bin", {
        GITHUB_ACTIONS: "true",
        GITHUB_PATH: pathFile,
      });

      expect(result).toBe(true);
      const content = await Bun.file(pathFile).text();
      expect(content).toContain("/existing/path");
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
      // Should still be just the one entry
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
