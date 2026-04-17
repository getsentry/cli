/**
 * Project Root Detection Tests
 *
 * Tests for finding project root by walking up from a starting directory.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  findProjectRoot,
  getStopBoundary,
  hasBuildSystemMarker,
  hasLanguageMarker,
  hasRepoRootMarker,
  STAT_CONCURRENCY,
} from "../../../src/lib/dsn/project-root.js";

// Test directory structure helper
function createDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function createFile(path: string, content = ""): void {
  writeFileSync(path, content);
}

describe("project-root", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(
      tmpdir(),
      `sentry-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    createDir(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getStopBoundary", () => {
    test("returns home directory", () => {
      const boundary = getStopBoundary();
      expect(boundary).toBe(homedir());
    });
  });

  describe("hasRepoRootMarker", () => {
    test("detects .git directory", async () => {
      createDir(join(testDir, ".git"));
      const result = await hasRepoRootMarker(testDir);
      expect(result.found).toBe(true);
      expect(result.type).toBe("vcs");
    });

    test("detects .hg directory", async () => {
      createDir(join(testDir, ".hg"));
      const result = await hasRepoRootMarker(testDir);
      expect(result.found).toBe(true);
      expect(result.type).toBe("vcs");
    });

    test("detects .github directory", async () => {
      createDir(join(testDir, ".github"));
      const result = await hasRepoRootMarker(testDir);
      expect(result.found).toBe(true);
      expect(result.type).toBe("ci");
    });

    test("detects .gitlab-ci.yml file", async () => {
      createFile(join(testDir, ".gitlab-ci.yml"));
      const result = await hasRepoRootMarker(testDir);
      expect(result.found).toBe(true);
      expect(result.type).toBe("ci");
    });

    test("detects .editorconfig with root=true", async () => {
      createFile(
        join(testDir, ".editorconfig"),
        "root = true\n[*]\nindent_style = space"
      );
      const result = await hasRepoRootMarker(testDir);
      expect(result.found).toBe(true);
      expect(result.type).toBe("editorconfig");
    });

    test("ignores .editorconfig without root=true", async () => {
      createFile(join(testDir, ".editorconfig"), "[*]\nindent_style = space");
      const result = await hasRepoRootMarker(testDir);
      expect(result.found).toBe(false);
    });

    test("returns found=false when no markers", async () => {
      const result = await hasRepoRootMarker(testDir);
      expect(result.found).toBe(false);
    });
  });

  describe("hasLanguageMarker", () => {
    test("detects package.json", async () => {
      createFile(join(testDir, "package.json"), "{}");
      expect(await hasLanguageMarker(testDir)).toBe(true);
    });

    test("detects pyproject.toml", async () => {
      createFile(join(testDir, "pyproject.toml"), "");
      expect(await hasLanguageMarker(testDir)).toBe(true);
    });

    test("detects go.mod", async () => {
      createFile(join(testDir, "go.mod"), "module example.com/test");
      expect(await hasLanguageMarker(testDir)).toBe(true);
    });

    test("detects Cargo.toml", async () => {
      createFile(join(testDir, "Cargo.toml"), "");
      expect(await hasLanguageMarker(testDir)).toBe(true);
    });

    test("detects .sln file (glob pattern)", async () => {
      createFile(join(testDir, "MyProject.sln"), "");
      expect(await hasLanguageMarker(testDir)).toBe(true);
    });

    test("detects .csproj file (glob pattern)", async () => {
      createFile(join(testDir, "MyProject.csproj"), "");
      expect(await hasLanguageMarker(testDir)).toBe(true);
    });

    test("returns false when no markers", async () => {
      expect(await hasLanguageMarker(testDir)).toBe(false);
    });
  });

  describe("hasBuildSystemMarker", () => {
    test("detects Makefile", async () => {
      createFile(join(testDir, "Makefile"), "");
      expect(await hasBuildSystemMarker(testDir)).toBe(true);
    });

    test("detects CMakeLists.txt", async () => {
      createFile(join(testDir, "CMakeLists.txt"), "");
      expect(await hasBuildSystemMarker(testDir)).toBe(true);
    });

    test("detects BUILD.bazel", async () => {
      createFile(join(testDir, "BUILD.bazel"), "");
      expect(await hasBuildSystemMarker(testDir)).toBe(true);
    });

    test("returns false when no markers", async () => {
      expect(await hasBuildSystemMarker(testDir)).toBe(false);
    });
  });

  describe("findProjectRoot", () => {
    describe("DSN detection in .env files", () => {
      test("finds DSN in .env file and returns immediately", async () => {
        const dsn = "https://abc123@o123.ingest.sentry.io/456";
        createFile(join(testDir, ".env"), `SENTRY_DSN=${dsn}`);
        createDir(join(testDir, "src", "lib"));

        const result = await findProjectRoot(join(testDir, "src", "lib"));

        expect(result.foundDsn).toBeDefined();
        expect(result.foundDsn?.raw).toBe(dsn);
        expect(result.reason).toBe("env_dsn");
        expect(result.projectRoot).toBe(testDir);
      });

      test("finds DSN in .env.local (higher priority)", async () => {
        const dsnLocal = "https://local@o123.ingest.sentry.io/456";
        const dsnBase = "https://base@o123.ingest.sentry.io/789";
        createFile(join(testDir, ".env.local"), `SENTRY_DSN=${dsnLocal}`);
        createFile(join(testDir, ".env"), `SENTRY_DSN=${dsnBase}`);

        const result = await findProjectRoot(testDir);

        expect(result.foundDsn?.raw).toBe(dsnLocal);
      });

      test("finds DSN at intermediate level during walk-up", async () => {
        const dsn = "https://abc123@o123.ingest.sentry.io/456";
        // Create nested structure: testDir/packages/app/src
        const packagesDir = join(testDir, "packages");
        const appDir = join(packagesDir, "app");
        const srcDir = join(appDir, "src");
        createDir(srcDir);

        // Put DSN in app directory
        createFile(join(appDir, ".env"), `SENTRY_DSN=${dsn}`);

        // Put .git at root
        createDir(join(testDir, ".git"));

        const result = await findProjectRoot(srcDir);

        // Should find DSN at app level (immediate return)
        expect(result.foundDsn).toBeDefined();
        expect(result.foundDsn?.raw).toBe(dsn);
        expect(result.reason).toBe("env_dsn");
      });
    });

    describe("VCS marker detection", () => {
      test("stops at .git directory", async () => {
        createDir(join(testDir, ".git"));
        createDir(join(testDir, "src", "lib", "utils"));

        const result = await findProjectRoot(
          join(testDir, "src", "lib", "utils")
        );

        expect(result.projectRoot).toBe(testDir);
        expect(result.reason).toBe("vcs");
        // Levels: utils(1) -> lib(2) -> src(3) -> testDir(4, found .git)
        expect(result.levelsTraversed).toBe(4);
      });

      test("stops at .github directory", async () => {
        createDir(join(testDir, ".github"));
        createDir(join(testDir, "src"));

        const result = await findProjectRoot(join(testDir, "src"));

        expect(result.projectRoot).toBe(testDir);
        expect(result.reason).toBe("ci");
      });
    });

    describe("language marker detection", () => {
      test("uses closest language marker to cwd", async () => {
        // Root has package.json
        createFile(join(testDir, "package.json"), "{}");

        // Nested package also has package.json
        const nestedDir = join(testDir, "packages", "frontend");
        createDir(nestedDir);
        createFile(join(nestedDir, "package.json"), "{}");

        // Start from nested/src
        const srcDir = join(nestedDir, "src");
        createDir(srcDir);

        const result = await findProjectRoot(srcDir);

        // Should use the closest package.json (in packages/frontend)
        expect(result.projectRoot).toBe(nestedDir);
        expect(result.reason).toBe("language");
      });

      test("VCS marker takes precedence over language marker", async () => {
        createDir(join(testDir, ".git"));
        createFile(join(testDir, "package.json"), "{}");
        createDir(join(testDir, "src"));

        const result = await findProjectRoot(join(testDir, "src"));

        // Should stop at .git even though package.json was also found
        expect(result.projectRoot).toBe(testDir);
        expect(result.reason).toBe("vcs");
      });
    });

    describe("build system marker detection", () => {
      test("uses build system marker as last resort", async () => {
        createFile(join(testDir, "Makefile"), "");
        createDir(join(testDir, "src"));

        const result = await findProjectRoot(join(testDir, "src"));

        expect(result.projectRoot).toBe(testDir);
        expect(result.reason).toBe("build_system");
      });

      test("language marker takes precedence over build system", async () => {
        createFile(join(testDir, "Makefile"), "");
        createFile(join(testDir, "package.json"), "{}");
        createDir(join(testDir, "src"));

        const result = await findProjectRoot(join(testDir, "src"));

        expect(result.reason).toBe("language");
      });
    });

    describe("fallback behavior", () => {
      test("returns cwd when no markers found", async () => {
        const deepDir = join(testDir, "a", "b", "c");
        createDir(deepDir);

        const result = await findProjectRoot(deepDir);

        // Should fall back to the starting directory
        expect(result.projectRoot).toBe(deepDir);
        expect(result.reason).toBe("fallback");
      });
    });

    describe("levels traversed tracking", () => {
      test("tracks correct number of levels", async () => {
        createDir(join(testDir, ".git"));
        createDir(join(testDir, "a", "b", "c", "d"));

        const result = await findProjectRoot(join(testDir, "a", "b", "c", "d"));

        // Levels: d(1) -> c(2) -> b(3) -> a(4) -> testDir(5, found .git)
        expect(result.levelsTraversed).toBe(5);
      });
    });
  });

  describe("stat() concurrency limiting", () => {
    test("caps concurrent stat() calls at STAT_CONCURRENCY", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      // Spy on stat to track concurrent calls without changing behavior
      const realStat = stat;
      mock.module("node:fs/promises", () => ({
        ...require("node:fs/promises"),
        stat: async (path: string) => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          try {
            return await realStat(path);
          } finally {
            concurrent -= 1;
          }
        },
        opendir: require("node:fs/promises").opendir,
      }));

      // hasBuildSystemMarker uses anyExists with BUILD_SYSTEM_MARKERS (19 items).
      // We want to test with more items — call hasRepoRootMarker which fans out
      // across VCS (7) + CI (12) + editorconfig (1) all via the shared statLimit.
      // Instead, directly verify via a directory with many fake marker names.
      // The most direct route: create many files and call hasBuildSystemMarker
      // repeatedly to accumulate concurrent pressure.
      //
      // Simpler: use the fact that all anyExists() calls share statLimit.
      // Fire hasBuildSystemMarker (19) + hasLanguageMarker (30) in parallel → 49 stats,
      // more than STAT_CONCURRENCY=32, so the cap must be visible.
      await Promise.all([
        hasBuildSystemMarker(testDir), // 19 stat() calls
        hasLanguageMarker(testDir), // 30 stat() calls
      ]);

      mock.restore();

      expect(maxConcurrent).toBeLessThanOrEqual(STAT_CONCURRENCY);
    });

    test("anyExists still resolves true when a marker exists (limiter doesn't break early exit)", async () => {
      // Place a recognizable marker and verify detection still works
      // even with the concurrency limiter in the path.
      createFile(join(testDir, "Makefile"), "");

      const result = await hasBuildSystemMarker(testDir);

      expect(result).toBe(true);
    });
  });
});
