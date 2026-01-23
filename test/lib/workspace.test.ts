/**
 * Tests for workspace detection utilities
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getWorkspaceRoot } from "../../src/lib/workspace.js";

describe("getWorkspaceRoot", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = join(
      process.env.TMPDIR || "/tmp",
      `workspace-test-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns git root when .git exists", async () => {
    // Create a git repo structure
    const gitDir = join(tempDir, ".git");
    mkdirSync(gitDir, { recursive: true });

    // Create a subdirectory
    const subDir = join(tempDir, "src", "lib");
    mkdirSync(subDir, { recursive: true });

    // Should return git root when called from subdirectory
    const result = await getWorkspaceRoot(subDir);
    expect(result).toBe(tempDir);
  });

  test("returns package.json directory when no git", async () => {
    // Create a package.json
    writeFileSync(join(tempDir, "package.json"), "{}");

    // Create a subdirectory
    const subDir = join(tempDir, "src", "lib");
    mkdirSync(subDir, { recursive: true });

    // Should return package.json root when called from subdirectory
    const result = await getWorkspaceRoot(subDir);
    expect(result).toBe(tempDir);
  });

  test("returns cwd when no git or package.json", async () => {
    // Create a subdirectory without any markers
    const subDir = join(tempDir, "some", "path");
    mkdirSync(subDir, { recursive: true });

    // Should return the provided cwd
    const result = await getWorkspaceRoot(subDir);
    expect(result).toBe(subDir);
  });

  test("prefers git root over package.json", async () => {
    // Create a git repo structure
    const gitDir = join(tempDir, ".git");
    mkdirSync(gitDir, { recursive: true });

    // Create a subdirectory with its own package.json
    const subDir = join(tempDir, "packages", "frontend");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "package.json"), "{}");

    // Should return git root, not the package subdirectory
    const result = await getWorkspaceRoot(subDir);
    expect(result).toBe(tempDir);
  });

  test("returns immediate directory when it has .git", async () => {
    // Create a git repo at the search directory itself
    const gitDir = join(tempDir, ".git");
    mkdirSync(gitDir, { recursive: true });

    const result = await getWorkspaceRoot(tempDir);
    expect(result).toBe(tempDir);
  });

  test("returns immediate directory when it has package.json", async () => {
    writeFileSync(join(tempDir, "package.json"), "{}");

    const result = await getWorkspaceRoot(tempDir);
    expect(result).toBe(tempDir);
  });
});
