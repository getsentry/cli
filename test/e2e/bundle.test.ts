/**
 * Bundle Smoke Tests
 *
 * Verifies the npm bundle is correctly built and can be executed by Node.js.
 * These tests ensure the bundle has proper shebang and runs without syntax errors.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT_DIR = join(import.meta.dir, "../..");
const BUNDLE_PATH = join(ROOT_DIR, "dist/bin.cjs");

describe("npm bundle", () => {
  beforeAll(async () => {
    // Clean dist directory before building
    const distDir = join(ROOT_DIR, "dist");
    if (existsSync(distDir)) {
      rmSync(distDir, { recursive: true, force: true });
    }

    // Build the bundle (requires SENTRY_CLIENT_ID)
    // Run the bundle script directly to avoid PATH issues in test environments
    const proc = Bun.spawn([process.execPath, "run", "script/bundle.ts"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        SENTRY_CLIENT_ID: process.env.SENTRY_CLIENT_ID || "test-client-id",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Bundle failed with exit code ${exitCode}: ${stderr}`);
    }
  }, 60_000); // Bundle can take a while

  afterAll(() => {
    // Clean up bundle after tests
    const distDir = join(ROOT_DIR, "dist");
    if (existsSync(distDir)) {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("bundle file exists", () => {
    expect(existsSync(BUNDLE_PATH)).toBe(true);
  });

  test("bundle starts with node shebang", async () => {
    const file = Bun.file(BUNDLE_PATH);
    const content = await file.text();

    // The bundle MUST start with the Node.js shebang for npm global installs to work
    // Without this, Unix shells try to execute the JavaScript as shell commands
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  test("bundle executes without syntax errors", async () => {
    // Run the bundle with --version to verify it executes correctly
    // Using --version instead of --help as it has fewer dependencies
    // This catches the exact error from the bug report where the shell
    // tried to interpret JavaScript as shell commands
    const proc = Bun.spawn(["node", BUNDLE_PATH, "--version"], {
      cwd: ROOT_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;

    // Should not have shell syntax errors (the original bug)
    expect(stderr).not.toContain("syntax error");
    expect(stderr).not.toContain("unexpected token");

    // The CLI should start and produce some output
    // Even if it exits non-zero due to missing config, it should run as JS not shell
    const output = stdout + stderr;
    expect(output.length).toBeGreaterThan(0);
  });

  test("bundle does not emit Node.js warnings", async () => {
    // Run the bundle and capture stderr to check for warnings
    // This ensures we don't regress on warning suppression (e.g., SQLite experimental)
    const proc = Bun.spawn(["node", BUNDLE_PATH, "--version"], {
      cwd: ROOT_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    // Should not have any Node.js warnings
    expect(stderr).not.toContain("ExperimentalWarning");
    expect(stderr).not.toContain("DeprecationWarning");
    expect(stderr).not.toContain("Warning:");
  });

  test("bundle can be executed directly on Unix", async () => {
    // Skip on Windows where shebang doesn't apply
    if (process.platform === "win32") {
      return;
    }

    // Make the bundle executable
    const { chmod } = await import("node:fs/promises");
    await chmod(BUNDLE_PATH, 0o755);

    // Execute it directly (like npm global install would)
    const proc = Bun.spawn([BUNDLE_PATH, "--version"], {
      cwd: ROOT_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;

    // This is the exact error from the bug report - shell interpreting JS as bash
    expect(stderr).not.toContain("syntax error near unexpected token");

    // The CLI should start and produce some output
    const output = stdout + stderr;
    expect(output.length).toBeGreaterThan(0);
  });
});
