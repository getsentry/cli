/**
 * Project Root Detection
 *
 * Walks up from starting directory to find project root, optionally
 * detecting DSN along the way for early exit.
 *
 * Priority:
 * 1. .env with SENTRY_DSN → immediate return
 * 2. VCS/CI markers → definitive repo root (stop walking)
 * 3. Language markers → closest to cwd wins
 * 4. Build system markers → last resort
 *
 * Stops at: home directory or filesystem root
 */

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import { ENV_FILES, extractDsnFromEnvContent } from "./env-file.js";
import { createDetectedDsn } from "./parser.js";
import type { DetectedDsn } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why a directory was chosen as project root
 */
export type ProjectRootReason =
  | "env_dsn" // Found .env with SENTRY_DSN
  | "vcs" // Version control (.git, .hg, etc.)
  | "ci" // CI/CD markers (.github, etc.)
  | "editorconfig" // .editorconfig with root=true
  | "language" // Language/package marker
  | "build_system" // Build system marker
  | "fallback"; // No markers found, using cwd

/**
 * Result of project root detection
 */
export type ProjectRootResult = {
  /** The determined project root directory */
  projectRoot: string;
  /** DSN found in .env while walking up (early exit) */
  foundDsn?: DetectedDsn;
  /** Why this directory was chosen as root */
  reason: ProjectRootReason;
  /** Number of directories traversed to find root */
  levelsTraversed: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Marker Definitions
// ─────────────────────────────────────────────────────────────────────────────

/** VCS directories - definitive repo root */
const VCS_MARKERS = [
  ".git",
  ".hg",
  ".svn",
  ".bzr",
  "_darcs",
  ".fossil",
  ".pijul",
] as const;

/** CI/CD markers - definitive repo root */
const CI_MARKERS = [
  ".github",
  ".gitlab-ci.yml",
  ".circleci",
  "Jenkinsfile",
  ".travis.yml",
  "azure-pipelines.yml",
  ".buildkite",
  "bitbucket-pipelines.yml",
  ".drone.yml",
  ".woodpecker.yml",
  ".forgejo",
  ".gitea",
] as const;

/** Language/package markers - strong project boundary */
const LANGUAGE_MARKERS = [
  // JavaScript/Node ecosystem
  "package.json",
  "deno.json",
  "deno.jsonc",
  // Python
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  // Go
  "go.mod",
  "go.work",
  // Rust
  "Cargo.toml",
  // Ruby
  "Gemfile",
  // PHP
  "composer.json",
  // Java/JVM
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "build.sbt",
  // .NET
  "global.json",
  // Swift
  "Package.swift",
  // Elixir
  "mix.exs",
  // Dart/Flutter
  "pubspec.yaml",
  // Haskell
  "stack.yaml",
  "cabal.project",
  // OCaml
  "dune-project",
  // Zig
  "build.zig",
  "build.zig.zon",
  // Clojure
  "project.clj",
  "deps.edn",
] as const;

/** Glob patterns for language markers that need wildcard matching */
const LANGUAGE_MARKER_GLOBS = [
  "*.sln",
  "*.csproj",
  "*.fsproj",
  "*.vbproj",
  "*.cabal",
  "*.opam",
  "*.nimble",
] as const;

/** Build system markers - last resort */
const BUILD_SYSTEM_MARKERS = [
  "Makefile",
  "GNUmakefile",
  "makefile",
  "CMakeLists.txt",
  "BUILD",
  "BUILD.bazel",
  "WORKSPACE",
  "WORKSPACE.bazel",
  "MODULE.bazel",
  "meson.build",
  "Justfile",
  "justfile",
  "Taskfile.yml",
  "Taskfile.yaml",
  "SConstruct",
  "xmake.lua",
  "premake5.lua",
  "premake4.lua",
  "wscript",
  "Earthfile",
] as const;

/** Regex for detecting root=true in .editorconfig (top-level for performance) */
const EDITORCONFIG_ROOT_REGEX = /^\s*root\s*=\s*true\s*$/im;

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a file system operation with a span for tracing.
 */
function withFsSpan<T>(
  operation: string,
  fn: () => T | Promise<T>
): Promise<T> {
  return Sentry.startSpan(
    {
      name: operation,
      op: "file",
      onlyIfParent: true,
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (error) {
        span.setStatus({ code: 2 }); // Error
        throw error;
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// File System Helpers (Parallelized)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a path exists (file or directory)
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file exists (async) - only for regular files
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists();
  } catch {
    return false;
  }
}

/**
 * Check if any of the given paths exist in a directory (parallel)
 * Works for both files and directories.
 *
 * @param dir - Directory to check
 * @param names - Array of file/directory names to check
 * @returns True if any path exists
 */
async function anyExists(
  dir: string,
  names: readonly string[]
): Promise<boolean> {
  const checks = names.map((name) => pathExists(join(dir, name)));
  const results = await Promise.all(checks);
  return results.some((exists) => exists);
}

/**
 * Check if any files matching glob patterns exist in a directory (parallel)
 *
 * @param dir - Directory to check
 * @param patterns - Glob patterns to match
 * @returns True if any matching file exists
 */
async function anyGlobMatches(
  dir: string,
  patterns: readonly string[]
): Promise<boolean> {
  const checks = patterns.map(async (pattern) => {
    const glob = new Bun.Glob(pattern);
    for await (const _match of glob.scan({ cwd: dir, onlyFiles: true })) {
      return true; // Found at least one match
    }
    return false;
  });

  const results = await Promise.all(checks);
  return results.some((found) => found);
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker Detection Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if .editorconfig exists and contains root=true
 *
 * @param dir - Directory to check
 * @returns True if .editorconfig with root=true found
 */
async function checkEditorConfigRoot(dir: string): Promise<boolean> {
  const editorConfigPath = join(dir, ".editorconfig");
  try {
    const file = Bun.file(editorConfigPath);
    if (!(await file.exists())) {
      return false;
    }
    const content = await file.text();
    return EDITORCONFIG_ROOT_REGEX.test(content);
  } catch {
    return false;
  }
}

/**
 * Determine the type of repo root marker found
 */
function getRepoRootType(
  hasVcs: boolean,
  hasCi: boolean,
  hasEditorConfigRoot: boolean
): "vcs" | "ci" | "editorconfig" | undefined {
  if (hasVcs) {
    return "vcs";
  }
  if (hasCi) {
    return "ci";
  }
  if (hasEditorConfigRoot) {
    return "editorconfig";
  }
  return;
}

/**
 * Check if directory has VCS or CI/CD markers (definitive repo root)
 *
 * @param dir - Directory to check
 * @returns Object with found status and marker type
 */
export function hasRepoRootMarker(
  dir: string
): Promise<{ found: boolean; type?: "vcs" | "ci" | "editorconfig" }> {
  return withFsSpan("hasRepoRootMarker", async () => {
    // Check all marker types in parallel
    const [hasVcs, hasCi, hasEditorConfigRoot] = await Promise.all([
      anyExists(dir, VCS_MARKERS),
      anyExists(dir, CI_MARKERS),
      checkEditorConfigRoot(dir),
    ]);

    const type = getRepoRootType(hasVcs, hasCi, hasEditorConfigRoot);
    return type ? { found: true, type } : { found: false };
  });
}

/**
 * Check if directory has language/package markers
 *
 * @param dir - Directory to check
 * @returns True if any language marker found
 */
export function hasLanguageMarker(dir: string): Promise<boolean> {
  return withFsSpan("hasLanguageMarker", async () => {
    // Check exact filenames and glob patterns in parallel
    const [hasExact, hasGlob] = await Promise.all([
      anyExists(dir, LANGUAGE_MARKERS),
      anyGlobMatches(dir, LANGUAGE_MARKER_GLOBS),
    ]);
    return hasExact || hasGlob;
  });
}

/**
 * Check if directory has build system markers
 *
 * @param dir - Directory to check
 * @returns True if any build system marker found
 */
export function hasBuildSystemMarker(dir: string): Promise<boolean> {
  return withFsSpan("hasBuildSystemMarker", async () =>
    anyExists(dir, BUILD_SYSTEM_MARKERS)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DSN Detection in .env Files
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check .env files in a directory for SENTRY_DSN
 *
 * Checks files in priority order and returns immediately on first match.
 *
 * @param dir - Directory to check
 * @returns Detected DSN or null
 */
function checkEnvForDsn(dir: string): Promise<DetectedDsn | null> {
  return withFsSpan("checkEnvForDsn", async () => {
    // Check all env files in parallel for existence
    const existenceChecks = ENV_FILES.map(async (filename) => {
      const path = join(dir, filename);
      const exists = await fileExists(path);
      return { filename, path, exists };
    });

    const results = await Promise.all(existenceChecks);
    const existingFiles = results.filter((r) => r.exists);

    // Read existing files in parallel
    const contentChecks = existingFiles.map(async ({ filename, path }) => {
      try {
        const content = await Bun.file(path).text();
        const dsn = extractDsnFromEnvContent(content);
        return dsn ? { dsn, filename } : null;
      } catch {
        return null;
      }
    });

    const dsnResults = await Promise.all(contentChecks);

    // Return first found DSN (respecting priority order)
    for (const filename of ENV_FILES) {
      const found = dsnResults.find(
        (r) => r !== null && r.filename === filename
      );
      if (found) {
        return createDetectedDsn(found.dsn, "env_file", found.filename);
      }
    }

    return null;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the stop boundary for project root search.
 *
 * Returns home directory if it exists, otherwise filesystem root.
 */
export function getStopBoundary(): string {
  try {
    return homedir();
  } catch {
    return "/";
  }
}

/**
 * Process one directory level during the walk-up search
 */
async function processDirectoryLevel(
  currentDir: string,
  languageMarkerAt: string | null,
  buildSystemAt: string | null
): Promise<{
  dsnResult: DetectedDsn | null;
  repoRootResult: { found: boolean; type?: "vcs" | "ci" | "editorconfig" };
  hasLang: boolean;
  hasBuild: boolean;
}> {
  // Run all checks for this level in parallel
  const [dsnResult, repoRootResult, hasLang, hasBuild] = await Promise.all([
    checkEnvForDsn(currentDir),
    hasRepoRootMarker(currentDir),
    languageMarkerAt ? Promise.resolve(false) : hasLanguageMarker(currentDir),
    buildSystemAt ? Promise.resolve(false) : hasBuildSystemMarker(currentDir),
  ]);

  return { dsnResult, repoRootResult, hasLang, hasBuild };
}

/**
 * Convert repo root type to project root reason
 */
function repoRootTypeToReason(
  type: "vcs" | "ci" | "editorconfig" | undefined
): ProjectRootReason {
  switch (type) {
    case "editorconfig":
      return "editorconfig";
    case "ci":
      return "ci";
    default:
      return "vcs";
  }
}

/**
 * Determine the final project root from candidates
 */
function selectProjectRoot(
  languageMarkerAt: string | null,
  buildSystemAt: string | null,
  fallback: string
): { projectRoot: string; reason: ProjectRootReason } {
  if (languageMarkerAt) {
    return { projectRoot: languageMarkerAt, reason: "language" };
  }
  if (buildSystemAt) {
    return { projectRoot: buildSystemAt, reason: "build_system" };
  }
  return { projectRoot: fallback, reason: "fallback" };
}

/**
 * State tracked during directory walk-up
 */
type WalkState = {
  currentDir: string;
  levelsTraversed: number;
  languageMarkerAt: string | null;
  buildSystemAt: string | null;
};

/**
 * Create result when DSN is found in .env file
 */
function createDsnFoundResult(
  currentDir: string,
  dsnResult: DetectedDsn,
  levelsTraversed: number
): ProjectRootResult {
  return {
    projectRoot: currentDir,
    foundDsn: dsnResult,
    reason: "env_dsn",
    levelsTraversed,
  };
}

/**
 * Create result when repo root marker is found
 */
function createRepoRootResult(
  currentDir: string,
  markerType: "vcs" | "ci" | "editorconfig" | undefined,
  levelsTraversed: number
): ProjectRootResult {
  return {
    projectRoot: currentDir,
    reason: repoRootTypeToReason(markerType),
    levelsTraversed,
  };
}

/**
 * Walk up directories searching for project root
 */
async function walkUpDirectories(
  resolvedStart: string,
  stopBoundary: string
): Promise<ProjectRootResult> {
  const state: WalkState = {
    currentDir: resolvedStart,
    levelsTraversed: 0,
    languageMarkerAt: null,
    buildSystemAt: null,
  };

  // Use do-while to ensure starting directory is always checked,
  // even when it equals the stop boundary (e.g., user runs from home dir)
  do {
    state.levelsTraversed += 1;

    const { dsnResult, repoRootResult, hasLang, hasBuild } =
      await processDirectoryLevel(
        state.currentDir,
        state.languageMarkerAt,
        state.buildSystemAt
      );

    // 1. Check for DSN in .env files - immediate return
    if (dsnResult) {
      return createDsnFoundResult(
        state.currentDir,
        dsnResult,
        state.levelsTraversed
      );
    }

    // 2. Check for VCS/CI markers - definitive root, stop walking
    if (repoRootResult.found) {
      return createRepoRootResult(
        state.currentDir,
        repoRootResult.type,
        state.levelsTraversed
      );
    }

    // 3. Remember language marker (closest to cwd wins)
    if (!state.languageMarkerAt && hasLang) {
      state.languageMarkerAt = state.currentDir;
    }

    // 4. Remember build system marker (last resort)
    if (!state.buildSystemAt && hasBuild) {
      state.buildSystemAt = state.currentDir;
    }

    // Stop at boundary BEFORE moving to parent - this ensures we don't
    // traverse past home directory when starting there
    if (state.currentDir === stopBoundary) {
      break;
    }

    // Move to parent directory
    const parentDir = dirname(state.currentDir);
    if (parentDir === state.currentDir) {
      break; // Reached filesystem root
    }
    state.currentDir = parentDir;
  } while (state.currentDir !== "/");

  // Determine project root from candidates (priority order)
  const selected = selectProjectRoot(
    state.languageMarkerAt,
    state.buildSystemAt,
    resolvedStart
  );

  return {
    projectRoot: selected.projectRoot,
    reason: selected.reason,
    levelsTraversed: state.levelsTraversed,
  };
}

/**
 * Find project root by walking up from starting directory.
 *
 * Checks for DSN in .env files at each level (early exit if found).
 * Stops at VCS/CI markers (definitive repo root).
 * Falls back to language markers, then build system markers.
 *
 * @param startDir - Directory to start searching from
 * @returns Project root result with optional DSN
 */
export function findProjectRoot(startDir: string): Promise<ProjectRootResult> {
  return Sentry.startSpan(
    {
      name: "findProjectRoot",
      op: "dsn.detect",
      attributes: {
        "dsn.start_dir": startDir,
      },
      onlyIfParent: true,
    },
    async (span) => {
      const resolvedStart = resolve(startDir);
      const stopBoundary = getStopBoundary();

      const result = await walkUpDirectories(resolvedStart, stopBoundary);

      span.setAttributes({
        "dsn.found": result.foundDsn !== undefined,
        "dsn.reason": result.reason,
        "dsn.levels_traversed": result.levelsTraversed,
        "dsn.project_root": result.projectRoot,
      });
      span.setStatus({ code: 1 });

      return result;
    }
  );
}

/**
 * Check if a directory is a project root.
 *
 * A directory is considered a project root if it has any of:
 * - VCS markers (.git, .hg, etc.)
 * - CI/CD markers (.github, etc.)
 * - .editorconfig with root=true
 * - Language/package markers
 * - Build system markers
 *
 * @param dir - Directory to check
 * @returns True if directory appears to be a project root
 */
export async function isProjectRoot(dir: string): Promise<boolean> {
  // Check all marker types in parallel
  const [hasRepo, hasLang, hasBuild] = await Promise.all([
    hasRepoRootMarker(dir),
    hasLanguageMarker(dir),
    hasBuildSystemMarker(dir),
  ]);

  return hasRepo.found || hasLang || hasBuild;
}
