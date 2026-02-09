/**
 * Setup Command Tests
 *
 * Tests the `sentry cli setup` command end-to-end through Stricli's run().
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "@stricli/core";
import { app } from "../../../src/app.js";
import type { SentryContext } from "../../../src/context.js";

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
      ["cli", "setup", "--quiet", "--no-modify-path", "--no-completions"],
      context
    );

    // With --quiet, no output should be produced
    expect(output.join("")).toBe("");
  });

  test("outputs 'Setup complete!' without --quiet", async () => {
    const { context, output } = createMockContext({ homeDir: testDir });

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-completions"],
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

    await run(app, ["cli", "setup", "--no-completions"], context);

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

    await run(app, ["cli", "setup", "--no-completions"], context);

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

    await run(app, ["cli", "setup", "--no-completions"], context);

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

    await run(app, ["cli", "setup", "--no-modify-path"], context);

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

    await run(app, ["cli", "setup", "--no-modify-path"], context);

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

    await run(app, ["cli", "setup", "--no-completions"], context);

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

    await run(app, ["cli", "setup", "--no-modify-path"], context);

    const combined = output.join("");
    expect(combined).toContain("Not supported for");
  });

  test("supports kebab-case flags", async () => {
    const { context, output } = createMockContext({ homeDir: testDir });

    // Verify kebab-case works (--no-modify-path instead of --noModifyPath)
    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-completions", "--quiet"],
      context
    );

    // Should not error
    expect(output.join("")).toBe("");
  });
});
