/**
 * Setup Command Tests
 *
 * Tests the `sentry cli setup` command end-to-end through Stricli's run().
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "@stricli/core";
import { app } from "../../../src/app.js";
import type { SentryContext } from "../../../src/context.js";

/** Store original fetch for restoration */
let originalFetch: typeof globalThis.fetch;

/** Helper to mock fetch without TypeScript errors about missing Bun-specific properties */
function mockFetch(
  fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

/** Create a mock SentryContext for testing */
function createMockContext(
  overrides: Partial<{
    homeDir: string;
    env: Record<string, string | undefined>;
    execPath: string;
  }> = {}
): { context: SentryContext; output: string[] } {
  const output: string[] = [];
  const env: Record<string, string | undefined> = {
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/bash",
    ...overrides.env,
  };

  const context = {
    process: {
      stdout: {
        write: (s: string) => {
          output.push(s);
          return true;
        },
      },
      stderr: {
        write: (s: string) => {
          output.push(s);
          return true;
        },
      },
      stdin: process.stdin,
      env,
      cwd: () => "/tmp",
      execPath: overrides.execPath ?? "/usr/local/bin/sentry",
      exit: mock(() => {
        // no-op for tests
      }),
      exitCode: 0,
    },
    homeDir: overrides.homeDir ?? "/tmp/test-home",
    cwd: "/tmp",
    configDir: "/tmp/test-config",
    env,
    stdout: {
      write: (s: string) => {
        output.push(s);
        return true;
      },
    },
    stderr: {
      write: (s: string) => {
        output.push(s);
        return true;
      },
    },
    stdin: process.stdin,
    setContext: () => {
      // no-op for tests
    },
    setFlags: () => {
      // no-op for tests
    },
  } as unknown as SentryContext;

  return { context, output };
}

describe("sentry cli setup", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("runs with --quiet and skips all output", async () => {
    const { context, output } = createMockContext({ homeDir: testDir });

    await run(
      app,
      [
        "cli",
        "setup",
        "--quiet",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    // With --quiet, no output should be produced
    expect(output.join("")).toBe("");
  });

  test("outputs 'Setup complete!' without --quiet", async () => {
    const { context, output } = createMockContext({ homeDir: testDir });

    await run(
      app,
      [
        "cli",
        "setup",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    const combined = output.join("");
    expect(combined).toContain("Setup complete!");
  });

  test("records install method when --method is provided", async () => {
    const { context, output } = createMockContext({ homeDir: testDir });

    await run(
      app,
      [
        "cli",
        "setup",
        "--method",
        "curl",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    const combined = output.join("");
    expect(combined).toContain("Recorded installation method: curl");
  });

  test("handles PATH modification when binary not in PATH", async () => {
    // Create a .bashrc for the shell config to find
    const bashrc = join(testDir, ".bashrc");
    writeFileSync(bashrc, "# existing config\n");

    const { context, output } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/bash",
      },
    });

    await run(
      app,
      ["cli", "setup", "--no-completions", "--no-agent-skills"],
      context
    );

    const combined = output.join("");
    expect(combined).toContain("PATH:");
  });

  test("reports PATH already configured when binary dir is in PATH", async () => {
    const binDir = join(testDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const { context, output } = createMockContext({
      homeDir: testDir,
      execPath: join(binDir, "sentry"),
      env: {
        PATH: `/usr/bin:${binDir}:/bin`,
        SHELL: "/bin/bash",
      },
    });

    await run(
      app,
      ["cli", "setup", "--no-completions", "--no-agent-skills"],
      context
    );

    const combined = output.join("");
    expect(combined).toContain("already in PATH");
  });

  test("reports no config file found for unknown shell", async () => {
    const { context, output } = createMockContext({
      homeDir: testDir,
      env: {
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/tcsh",
      },
    });

    await run(
      app,
      ["cli", "setup", "--no-completions", "--no-agent-skills"],
      context
    );

    const combined = output.join("");
    expect(combined).toContain("No shell config file found");
    expect(combined).toContain("Add manually");
  });

  test("installs completions when not skipped", async () => {
    const bashrc = join(testDir, ".bashrc");
    writeFileSync(bashrc, "# existing\n");

    const { context, output } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
        SHELL: "/bin/bash",
      },
    });

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    const combined = output.join("");
    expect(combined).toContain("Completions:");
  });

  test("shows zsh fpath hint for zsh completions", async () => {
    const { context, output } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
        SHELL: "/bin/zsh",
      },
    });

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    const combined = output.join("");
    expect(combined).toContain("fpath=");
  });

  test("handles GitHub Actions PATH when GITHUB_ACTIONS is set", async () => {
    const ghPathFile = join(testDir, "github_path");
    writeFileSync(ghPathFile, "");

    const { context, output } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/bash",
        GITHUB_ACTIONS: "true",
        GITHUB_PATH: ghPathFile,
      },
    });

    await run(
      app,
      ["cli", "setup", "--no-completions", "--no-agent-skills"],
      context
    );

    const combined = output.join("");
    expect(combined).toContain("GITHUB_PATH");
  });

  test("shows unsupported message for sh shell completions", async () => {
    const { context, output } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
        SHELL: "/bin/tcsh",
      },
    });

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    const combined = output.join("");
    expect(combined).toContain("Not supported for");
  });

  test("supports kebab-case flags", async () => {
    const { context, output } = createMockContext({ homeDir: testDir });

    // Verify kebab-case works (--no-modify-path instead of --noModifyPath)
    await run(
      app,
      [
        "cli",
        "setup",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
        "--quiet",
      ],
      context
    );

    // Should not error
    expect(output.join("")).toBe("");
  });

  describe("--install flag", () => {
    test("installs binary from temp location and shows welcome message", async () => {
      // Create a fake source binary to "install"
      const sourceDir = join(testDir, "tmp");
      mkdirSync(sourceDir, { recursive: true });
      const sourcePath = join(sourceDir, "sentry-download");
      writeFileSync(sourcePath, "#!/bin/sh\necho test-binary");
      const { chmodSync } = await import("node:fs");
      chmodSync(sourcePath, 0o755);

      const { context, output } = createMockContext({
        homeDir: testDir,
        execPath: sourcePath,
        env: {
          PATH: "/usr/bin:/bin",
          SHELL: "/bin/bash",
          SENTRY_INSTALL_DIR: join(testDir, "install-dir"),
        },
      });

      await run(
        app,
        [
          "cli",
          "setup",
          "--install",
          "--method",
          "curl",
          "--no-modify-path",
          "--no-completions",
          "--no-agent-skills",
        ],
        context
      );

      const combined = output.join("");

      // Should show welcome message, not "Setup complete!"
      expect(combined).toContain("Installed sentry v");
      expect(combined).toContain("Get started:");
      expect(combined).toContain("sentry login");
      expect(combined).toContain("sentry --help");
      expect(combined).toContain("cli.sentry.dev");
      expect(combined).not.toContain("Setup complete!");

      // Should install binary to the target directory
      const installedPath = join(testDir, "install-dir", "sentry");
      expect(existsSync(installedPath)).toBe(true);
    });

    test("does not log 'Recorded installation method' with --install", async () => {
      const sourceDir = join(testDir, "tmp");
      mkdirSync(sourceDir, { recursive: true });
      const sourcePath = join(sourceDir, "sentry-download");
      writeFileSync(sourcePath, "binary-content");
      const { chmodSync } = await import("node:fs");
      chmodSync(sourcePath, 0o755);

      const { context, output } = createMockContext({
        homeDir: testDir,
        execPath: sourcePath,
        env: {
          PATH: "/usr/bin:/bin",
          SHELL: "/bin/bash",
          SENTRY_INSTALL_DIR: join(testDir, "install-dir"),
        },
      });

      await run(
        app,
        [
          "cli",
          "setup",
          "--install",
          "--method",
          "curl",
          "--no-modify-path",
          "--no-completions",
          "--no-agent-skills",
        ],
        context
      );

      const combined = output.join("");
      // With --install, the "Recorded installation method" log is suppressed
      expect(combined).not.toContain("Recorded installation method");
    });

    test("--install with --quiet suppresses all output", async () => {
      const sourceDir = join(testDir, "tmp");
      mkdirSync(sourceDir, { recursive: true });
      const sourcePath = join(sourceDir, "sentry-download");
      writeFileSync(sourcePath, "binary-content");
      const { chmodSync } = await import("node:fs");
      chmodSync(sourcePath, 0o755);

      const { context, output } = createMockContext({
        homeDir: testDir,
        execPath: sourcePath,
        env: {
          PATH: "/usr/bin:/bin",
          SHELL: "/bin/bash",
          SENTRY_INSTALL_DIR: join(testDir, "install-dir"),
        },
      });

      await run(
        app,
        [
          "cli",
          "setup",
          "--install",
          "--method",
          "curl",
          "--no-modify-path",
          "--no-completions",
          "--no-agent-skills",
          "--quiet",
        ],
        context
      );

      expect(output.join("")).toBe("");
    });
  });

  describe("agent skills", () => {
    beforeEach(() => {
      originalFetch = globalThis.fetch;
      mockFetch(
        async () =>
          new Response("# Sentry CLI Skill\nTest content", { status: 200 })
      );
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("installs agent skills when Claude Code is detected", async () => {
      // Create ~/.claude to simulate Claude Code being installed
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const { context, output } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });

      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-completions"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Agent skills:");
      expect(combined).toContain("Installed to");

      // Verify the file was actually written
      const skillPath = join(
        testDir,
        ".claude",
        "skills",
        "sentry-cli",
        "SKILL.md"
      );
      expect(existsSync(skillPath)).toBe(true);
    });

    test("silently skips when Claude Code is not detected", async () => {
      const { context, output } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });

      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-completions"],
        context
      );

      const combined = output.join("");
      expect(combined).not.toContain("Agent skills:");
    });

    test("skips when --no-agent-skills is set", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const { context, output } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });

      await run(
        app,
        [
          "cli",
          "setup",
          "--no-modify-path",
          "--no-completions",
          "--no-agent-skills",
        ],
        context
      );

      const combined = output.join("");
      expect(combined).not.toContain("Agent skills:");
    });

    test("does not break setup on network failure", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      mockFetch(async () => {
        throw new Error("Network error");
      });

      const { context, output } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });

      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-completions"],
        context
      );

      // Setup should still complete successfully
      const combined = output.join("");
      expect(combined).toContain("Setup complete!");
      expect(combined).not.toContain("Agent skills:");
    });
  });
});
