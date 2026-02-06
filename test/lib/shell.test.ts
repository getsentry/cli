import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
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
  });
});
