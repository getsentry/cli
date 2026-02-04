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

/** Why a directory was chosen as project root */
export type ProjectRootReason =
  | "env_dsn" // Found .env with SENTRY_DSN
  | "vcs" // Version control (.git, .hg, etc.)
  | "ci" // CI/CD markers (.github, etc.)
  | "editorconfig" // .editorconfig with root=true
  | "language" // Language/package marker
  | "build_system" // Build system marker
  | "fallback"; // No markers found, using cwd

/** Result of project root detection */
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

/**
 * Regex for detecting root=true in .editorconfig.
 * Leading whitespace is valid per EditorConfig spec (allows indentation).
 */
const EDITORCONFIG_ROOT_REGEX = /^\s*root\s*=\s*true\s*$/im;

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

/**
 * Check if a path exists (file or directory) using stat.
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if any of the given paths exist in a directory.
 * Runs checks in parallel and resolves as soon as any returns true.
 *
 * @param dir - Directory to check
 * @param names - Array of file/directory names to check
 * @returns True if any path exists
 */
function anyExists(dir: string, names: readonly string[]): Promise<boolean> {
  if (names.length === 0) {
    return Promise.resolve(false);
  }

  return new Promise((done) => {
    let pending = names.length;

    const checkDone = () => {
      pending -= 1;
      if (pending === 0) {
        done(false);
      }
    };

    for (const name of names) {
      pathExists(join(dir, name))
        .then((exists) => {
          if (exists) {
            done(true);
          } else {
            checkDone();
          }
        })
        .catch(checkDone);
    }
  });
}

/**
 * Check if any files matching glob patterns exist in a directory.
 * Runs pattern checks in parallel and resolves as soon as any finds a match.
 *
 * @param dir - Directory to check
 * @param patterns - Glob patterns to match
 * @returns True if any matching file exists
 */
function anyGlobMatches(
  dir: string,
  patterns: readonly string[]
): Promise<boolean> {
  if (patterns.length === 0) {
    return Promise.resolve(false);
  }

  return new Promise((done) => {
    let pending = patterns.length;

    const checkDone = () => {
      pending -= 1;
      if (pending === 0) {
        done(false);
      }
    };

    for (const pattern of patterns) {
      const glob = new Bun.Glob(pattern);
      (async () => {
        for await (const _match of glob.scan({ cwd: dir, onlyFiles: true })) {
          done(true);
          return;
        }
        checkDone();
      })().catch(checkDone);
    }
  });
}

/**
 * Check if .editorconfig exists and contains root=true.
 * Reads file directly and handles ENOENT gracefully.
 *
 * @param dir - Directory to check
 * @returns True if .editorconfig with root=true found
 */
async function checkEditorConfigRoot(dir: string): Promise<boolean> {
  const editorConfigPath = join(dir, ".editorconfig");
  try {
    const content = await Bun.file(editorConfigPath).text();
    return EDITORCONFIG_ROOT_REGEX.test(content);
  } catch {
    // File doesn't exist or can't be read
    return false;
  }
}

/**
 * Determine the type of repo root marker found.
 * Returns in priority order: VCS > CI > editorconfig.
 *
 * Note: This only handles "definitive" repo root markers (VCS, CI, editorconfig).
 * Language and build markers are handled separately in walkUpDirectories() because
 * they indicate project boundaries but don't definitively mark the repository root.
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
    // Check exact filenames first (more common), then glob patterns
    if (await anyExists(dir, LANGUAGE_MARKERS)) {
      return true;
    }
    return anyGlobMatches(dir, LANGUAGE_MARKER_GLOBS);
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

/**
 * Check .env files in a directory for SENTRY_DSN.
 * Reads files directly and handles ENOENT gracefully.
 *
 * @param dir - Directory to check
 * @returns Detected DSN or null
 */
function checkEnvForDsn(dir: string): Promise<DetectedDsn | null> {
  return withFsSpan("checkEnvForDsn", async () => {
    // Check env files in priority order, stop on first DSN found
    for (const filename of ENV_FILES) {
      const filePath = join(dir, filename);
      try {
        const content = await Bun.file(filePath).text();
        const dsn = extractDsnFromEnvContent(content);
        if (dsn) {
          return createDetectedDsn(dsn, "env_file", filename);
        }
      } catch {
        // File doesn't exist or can't be read - continue to next file
      }
    }
    return null;
  });
}

/**
 * Get the stop boundary for project root search.
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

/** State tracked during directory walk-up */
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
 * Create result when repo root marker is found.
 * Maps marker type to reason (defaults to "vcs" for undefined).
 */
function createRepoRootResult(
  currentDir: string,
  markerType: "vcs" | "ci" | "editorconfig" | undefined,
  levelsTraversed: number
): ProjectRootResult {
  return {
    projectRoot: currentDir,
    reason: markerType ?? "vcs",
    levelsTraversed,
  };
}

/**
 * Walk up directories searching for project root.
 *
 * Loop logic:
 * 1. Always process starting directory (do-while ensures this)
 * 2. Stop at stopBoundary AFTER processing it (break before moving to parent)
 * 3. Stop at filesystem root (parentDir === currentDir)
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

  // do-while ensures starting directory is always checked,
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

    // Move to parent directory (or stop if at boundary/root)
    const parentDir = dirname(state.currentDir);
    const shouldStop =
      state.currentDir === stopBoundary || parentDir === state.currentDir;
    if (shouldStop) {
      break;
    }
    state.currentDir = parentDir;
    // biome-ignore lint/correctness/noConstantCondition: loop exits via break
  } while (true);

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
