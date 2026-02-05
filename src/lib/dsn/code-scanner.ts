/**
 * Language-Agnostic Code Scanner
 *
 * Scans source code for Sentry DSNs using a simple grep-based approach.
 * This replaces the language-specific detectors with a unified scanner that:
 *
 * 1. Greps for DSN URL pattern directly: https://KEY@HOST/PROJECT_ID
 * 2. Filters out DSNs appearing in commented lines
 * 3. Respects .gitignore using the `ignore` package
 * 4. Validates DSN hosts (SaaS when no SENTRY_URL, or self-hosted host when set)
 * 5. Scans concurrently with p-limit for performance
 * 6. Skips large files and known non-source directories
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import ignore, { type Ignore } from "ignore";
import pLimit from "p-limit";
import { DEFAULT_SENTRY_HOST } from "../constants.js";
import { ConfigError } from "../errors.js";
import { withTracingSpan } from "../telemetry.js";
import { createDetectedDsn, inferPackagePath, parseDsn } from "./parser.js";
import type { DetectedDsn } from "./types.js";

/**
 * Result of scanning code for DSNs, including mtimes for caching.
 */
export type CodeScanResult = {
  /** All detected DSNs */
  dsns: DetectedDsn[];
  /** Map of source file paths to their mtimes (only files containing DSNs) */
  sourceMtimes: Record<string, number>;
  /** Mtimes of scanned directories (for detecting new files added to subdirs) */
  dirMtimes: Record<string, number>;
};

/**
 * Maximum file size to scan (256KB).
 * Files larger than this are skipped as they're unlikely to be source files
 * with DSN configuration.
 *
 * Note: This check happens during file processing rather than collection to
 * avoid extra stat() calls. Bun.file().size is a cheap operation once we
 * have the file handle.
 */
const MAX_FILE_SIZE = 256 * 1024;

/**
 * Concurrency limit for file reads.
 * Balances performance with file descriptor limits.
 */
const CONCURRENCY_LIMIT = 50;

/**
 * Maximum depth to scan from project root.
 * Depth 0 = files in root directory
 * Depth 2 = files in second-level subdirectories (e.g., src/lib/file.ts)
 */
const MAX_SCAN_DEPTH = 2;

/**
 * Directories that are always skipped regardless of .gitignore.
 * These are common dependency/build/cache directories that should never contain DSNs.
 * Added to the gitignore instance as built-in patterns.
 */
const ALWAYS_SKIP_DIRS = [
  // Version control
  ".git",
  ".hg",
  ".svn",
  // IDE/Editor
  ".idea",
  ".vscode",
  ".cursor",
  // Node.js
  "node_modules",
  // Python
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "venv",
  ".venv",
  // Java/Kotlin/Gradle
  "build",
  "target",
  ".gradle",
  // Go
  "vendor",
  // Ruby
  ".bundle",
  // General build outputs
  "dist",
  "out",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
];

/**
 * File extensions to scan for DSNs.
 * Covers source code, config files, and data formats that might contain DSNs.
 */
const TEXT_EXTENSIONS = new Set([
  // JavaScript/TypeScript ecosystem
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".astro",
  ".vue",
  ".svelte",
  // Python
  ".py",
  // Go
  ".go",
  // Ruby
  ".rb",
  ".erb",
  // PHP
  ".php",
  // JVM languages
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".groovy",
  // .NET languages
  ".cs",
  ".fs",
  ".vb",
  // Rust
  ".rs",
  // Swift/Objective-C
  ".swift",
  ".m",
  ".mm",
  // Dart/Flutter
  ".dart",
  // Elixir/Erlang
  ".ex",
  ".exs",
  ".erl",
  // Lua
  ".lua",
  // Config/data formats
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".properties",
  ".config",
]);

/**
 * Common comment prefixes to detect commented-out DSNs.
 * Lines starting with these (after trimming whitespace) are ignored.
 */
const COMMENT_PREFIXES = ["//", "#", "--", "<!--", "/*", "*", "'''", '"""'];

/**
 * Normalize path separators to forward slashes for cross-platform consistency.
 * On POSIX systems, this is a no-op (identity function).
 * On Windows, converts backslashes to forward slashes.
 *
 * This is needed for:
 * 1. The `ignore` package pattern matching (requires forward slashes)
 * 2. inferPackagePath() which splits by "/"
 * 3. Consistent sourcePath values in DetectedDsn objects
 */
const normalizePath: (p: string) => string =
  path.sep === path.posix.sep
    ? (x) => x
    : (x) => x.replaceAll(path.sep, path.posix.sep);

/**
 * Pattern to match Sentry DSN URLs.
 * Captures the full DSN including protocol, public key, optional secret key, host, and project ID.
 *
 * Formats supported:
 * - https://{PUBLIC_KEY}@{HOST}/{PROJECT_ID}
 * - https://{PUBLIC_KEY}:{SECRET_KEY}@{HOST}/{PROJECT_ID}
 *
 * Examples:
 * - https://abc123def456@o123456.ingest.us.sentry.io/4507654321
 * - https://abc123def456:secret789@sentry.example.com/123
 *
 * The public key is typically a 32-character hex string, but we accept any
 * alphanumeric string to support test fixtures and edge cases.
 *
 * Note: Uses 'g' and 'i' flags. When used with String.matchAll(), the iterator
 * always starts from the beginning regardless of lastIndex, so no reset needed.
 */
const DSN_PATTERN =
  /https?:\/\/[a-z0-9]+(?::[a-z0-9]+)?@[a-z0-9.-]+(?:\.[a-z]+|:[0-9]+)\/\d+/gi;

/**
 * Extract DSN URLs from file content, filtering out those in commented lines.
 *
 * Algorithm:
 * 1. Find all DSN matches in the content using regex
 * 2. For each match, find the line it appears on
 * 3. Check if that line is commented out
 * 4. Validate the DSN host is acceptable
 *
 * @param content - File content to scan
 * @param limit - Maximum number of DSNs to return (undefined = no limit)
 * @returns Array of unique DSN strings found in non-commented lines
 */
export function extractDsnsFromContent(
  content: string,
  limit?: number
): string[] {
  const dsns = new Set<string>();

  // Find all potential DSN matches
  for (const match of content.matchAll(DSN_PATTERN)) {
    const dsn = match[0];
    const matchIndex = match.index;

    // Skip if we've already found this DSN
    if (dsns.has(dsn)) {
      continue;
    }

    // Find the line this match appears on by looking backwards for newline
    const lineStart = content.lastIndexOf("\n", matchIndex) + 1;
    const lineEnd = content.indexOf("\n", matchIndex);
    const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

    // Skip if the line is commented
    if (isCommentedLine(line.trim())) {
      continue;
    }

    // Validate it's a DSN with an acceptable host
    if (isValidDsnHost(dsn)) {
      dsns.add(dsn);

      // Early exit if we've reached the limit
      if (limit !== undefined && dsns.size >= limit) {
        break;
      }
    }
  }

  return [...dsns];
}

/**
 * Extract the first DSN from file content.
 * Used by cache verification to check if a DSN is still present in a file.
 *
 * @param content - File content
 * @returns First DSN found or null
 */
export function extractFirstDsnFromContent(content: string): string | null {
  const dsns = extractDsnsFromContent(content, 1);
  return dsns[0] ?? null;
}

/**
 * Scan a directory for all DSNs in source code files.
 *
 * Respects .gitignore, skips large files, and limits depth.
 * Returns all unique DSNs found across all files, plus mtimes for caching.
 *
 * @param cwd - Directory to scan
 * @returns Object with detected DSNs and source file mtimes
 */
export function scanCodeForDsns(cwd: string): Promise<CodeScanResult> {
  return scanDirectory(cwd, false);
}

/**
 * Scan a directory and return the first DSN found.
 *
 * Optimized for the common case of single-project repositories.
 * Stops scanning as soon as a valid DSN is found.
 *
 * @param cwd - Directory to scan
 * @returns First detected DSN or null if none found
 */
export async function scanCodeForFirstDsn(
  cwd: string
): Promise<DetectedDsn | null> {
  const { dsns } = await scanDirectory(cwd, true);
  return dsns[0] ?? null;
}

/**
 * Check if a line is commented out based on common comment prefixes.
 */
function isCommentedLine(trimmedLine: string): boolean {
  return COMMENT_PREFIXES.some((prefix) => trimmedLine.startsWith(prefix));
}

/**
 * Get the expected Sentry host for DSN validation.
 *
 * When SENTRY_URL is set (self-hosted), only DSNs matching that host are valid.
 * When not set (SaaS), only *.sentry.io DSNs are valid.
 *
 * @throws {ConfigError} If SENTRY_URL is set but not a valid URL
 * @returns The expected host domain for DSN validation
 */
function getExpectedHost(): string {
  const sentryUrl = process.env.SENTRY_URL;

  if (sentryUrl) {
    // Self-hosted: only accept DSNs matching the configured host
    try {
      const url = new URL(sentryUrl);
      return url.host;
    } catch {
      // Invalid SENTRY_URL - throw immediately since nothing will work
      throw new ConfigError(
        `SENTRY_URL "${sentryUrl}" is not a valid URL`,
        "Set SENTRY_URL to a valid URL (e.g., https://sentry.example.com) or unset it to use sentry.io"
      );
    }
  }

  // SaaS: only accept *.sentry.io
  return DEFAULT_SENTRY_HOST;
}

/**
 * Validate that a DSN has an acceptable Sentry host.
 *
 * When SENTRY_URL is set (self-hosted): DSNs matching host or any subdomain are valid
 * When SENTRY_URL is not set (SaaS): only *.sentry.io DSNs are valid
 *
 * This ensures we don't detect SaaS DSNs when configured for self-hosted
 * (they can't be queried against a self-hosted instance) and vice versa.
 */
function isValidDsnHost(dsn: string): boolean {
  const parsed = parseDsn(dsn);
  if (!parsed) {
    return false;
  }

  const expectedHost = getExpectedHost();

  // Accept exact match or any subdomain for both SaaS and self-hosted
  // e.g., for sentry.io: accept sentry.io or o123.ingest.us.sentry.io
  // e.g., for sentry.example.com: accept sentry.example.com or ingest.sentry.example.com
  return (
    parsed.host === expectedHost || parsed.host.endsWith(`.${expectedHost}`)
  );
}

/**
 * Create an ignore instance with built-in skip directories and .gitignore rules.
 */
async function createIgnoreFilter(cwd: string): Promise<Ignore> {
  const ig = ignore();

  // Add built-in skip directories first
  ig.add(ALWAYS_SKIP_DIRS);

  // Then add .gitignore rules if present
  try {
    const gitignorePath = path.join(cwd, ".gitignore");
    const content = await Bun.file(gitignorePath).text();
    ig.add(content);
  } catch {
    // No .gitignore, that's fine
  }

  return ig;
}

/**
 * Check if a file should be scanned based on its extension.
 */
function shouldScanFile(filename: string): boolean {
  const ext = path.extname(filename);
  return ext !== "" && TEXT_EXTENSIONS.has(ext);
}

/**
 * Safely read directory entries, returning empty array on error.
 */
async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    // Can't read directory (permissions, etc.) - skip it
    return [];
  }
}

/** Result of file collection */
type CollectResult = {
  files: string[];
  /** Mtimes of scanned directories (for detecting new files) */
  dirMtimes: Record<string, number>;
};

/**
 * Get directory mtime safely using node:fs/promises stat.
 * Must use stat() from node:fs/promises (not Bun.file()) for directories.
 */
async function getDirMtime(dir: string): Promise<number> {
  try {
    const { stat } = await import("node:fs/promises");
    const stats = await stat(dir);
    return Math.floor(stats.mtimeMs);
  } catch {
    return 0;
  }
}

/**
 * Collect files to scan from a directory using manual recursive walk.
 *
 * Unlike readdir with recursive: true, this implementation checks ignore rules
 * BEFORE traversing into directories, avoiding unnecessary traversal of large
 * ignored directories like node_modules.
 *
 * Also collects mtimes of all scanned directories for cache invalidation
 * (detects when new files are added to subdirectories).
 *
 * @param cwd - Root directory to scan
 * @param ig - Ignore filter instance
 * @returns Files and directory mtimes
 */
async function collectFiles(cwd: string, ig: Ignore): Promise<CollectResult> {
  const files: string[] = [];
  const dirMtimes: Record<string, number> = {};

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) {
      return;
    }

    // Track this directory's mtime for cache invalidation
    const relativeDirPath = normalizePath(path.relative(cwd, dir)) || ".";
    dirMtimes[relativeDirPath] = await getDirMtime(dir);

    const entries = await safeReaddir(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = normalizePath(path.relative(cwd, fullPath));

      // Check ignore rules BEFORE traversing - prevents walking into node_modules, etc.
      if (ig.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && shouldScanFile(entry.name)) {
        files.push(relativePath);
      }
    }
  }

  await walk(cwd, 0);
  return { files, dirMtimes };
}

/** Result from processing a single file */
type FileProcessResult = {
  dsns: DetectedDsn[];
  /** File mtime in ms, only set if DSNs were found */
  mtime?: number;
};

/**
 * Process a single file and extract DSNs.
 *
 * Note on Bun.file().size and lastModified: These are lazy properties that read
 * file metadata (via stat) only when accessed, not the file content. This is
 * cheaper than a separate stat() call since it uses the already-created file handle.
 *
 * @param cwd - Root directory
 * @param relativePath - Path relative to cwd
 * @param limit - Maximum DSNs to extract (undefined = no limit)
 * @returns Object with detected DSNs and mtime (if DSNs found)
 */
async function processFile(
  cwd: string,
  relativePath: string,
  limit?: number
): Promise<FileProcessResult> {
  const filepath = path.join(cwd, relativePath);

  try {
    const file = Bun.file(filepath);

    // Skip large files (Bun.file().size reads metadata, not content)
    if (file.size > MAX_FILE_SIZE) {
      // TODO: Add debug log when logging infrastructure is available
      return { dsns: [] };
    }

    const content = await file.text();
    const dsnStrings = extractDsnsFromContent(content, limit);

    if (dsnStrings.length === 0) {
      return { dsns: [] };
    }

    const packagePath = inferPackagePath(relativePath);

    // Map DSN strings to DetectedDsn objects, filtering out any that fail to parse
    const dsns = dsnStrings
      .map((dsn) => createDetectedDsn(dsn, "code", relativePath, packagePath))
      .filter((d): d is DetectedDsn => d !== null);

    // Return mtime only if we found valid DSNs (for cache invalidation)
    return dsns.length > 0 ? { dsns, mtime: file.lastModified } : { dsns: [] };
  } catch (error) {
    // Re-throw configuration errors - they indicate user misconfiguration
    // that should be surfaced rather than silently ignored
    if (error instanceof ConfigError) {
      throw error;
    }
    // For file system errors (ENOENT, EACCES, EPERM, etc.), return empty result
    // TODO: Add warning log for unreadable files when logging infrastructure is available
    return { dsns: [] };
  }
}

/**
 * State for concurrent DSN scanning.
 */
type ScanState = {
  results: Map<string, DetectedDsn>;
  /** Map of source file paths to their mtimes (only files containing DSNs) */
  sourceMtimes: Record<string, number>;
  filesScanned: number;
  earlyExit: boolean;
};

/**
 * Process a file and add found DSNs to the scan state.
 * Returns true if early exit should be triggered.
 */
async function processFileAndCollect(
  cwd: string,
  file: string,
  stopOnFirst: boolean,
  state: ScanState
): Promise<boolean> {
  state.filesScanned += 1;
  const { dsns, mtime } = await processFile(
    cwd,
    file,
    stopOnFirst ? 1 : undefined
  );

  // Record mtime for files that contain DSNs (for cache invalidation)
  if (mtime !== undefined && dsns.length > 0) {
    state.sourceMtimes[file] = mtime;
  }

  for (const dsn of dsns) {
    if (!state.results.has(dsn.raw)) {
      state.results.set(dsn.raw, dsn);
      // When stopOnFirst is true, processFile returns at most 1 DSN per file.
      // This check triggers early exit when we find the first *unique* DSN,
      // handling the case where the same DSN appears in multiple files.
      if (stopOnFirst) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Scan files concurrently and collect DSNs.
 *
 * @param cwd - Root directory
 * @param files - Files to scan (relative paths)
 * @param stopOnFirst - Whether to stop after finding the first DSN
 * @returns Map of DSNs (keyed by raw string), source mtimes, and count of files scanned
 */
async function scanFilesForDsns(
  cwd: string,
  files: string[],
  stopOnFirst: boolean
): Promise<{
  results: Map<string, DetectedDsn>;
  sourceMtimes: Record<string, number>;
  filesScanned: number;
}> {
  const limit = pLimit(CONCURRENCY_LIMIT);
  const state: ScanState = {
    results: new Map(),
    sourceMtimes: {},
    filesScanned: 0,
    earlyExit: false,
  };

  // Create a rate-limited processor that handles early exit
  const processWithLimit = (file: string) =>
    limit(async () => {
      if (state.earlyExit) {
        return;
      }

      const shouldExit = await processFileAndCollect(
        cwd,
        file,
        stopOnFirst,
        state
      );

      if (shouldExit) {
        state.earlyExit = true;
        limit.clearQueue();
      }
    });

  await Promise.all(files.map(processWithLimit));

  return {
    results: state.results,
    sourceMtimes: state.sourceMtimes,
    filesScanned: state.filesScanned,
  };
}

/**
 * Main scan implementation with Sentry performance tracing and metrics.
 */
function scanDirectory(
  cwd: string,
  stopOnFirst: boolean
): Promise<CodeScanResult> {
  return withTracingSpan(
    "scanCodeForDsns",
    "dsn.detect.code",
    async (span) => {
      // Create ignore filter with built-in patterns and .gitignore
      const ig = await createIgnoreFilter(cwd);

      // Collect all files to scan (also collects directory mtimes)
      let collectResult: CollectResult;
      try {
        collectResult = await collectFiles(cwd, ig);
      } catch {
        span.setStatus({ code: 2, message: "Directory scan failed" });
        return { dsns: [], sourceMtimes: {}, dirMtimes: {} };
      }

      const { files, dirMtimes } = collectResult;

      span.setAttribute("dsn.files_collected", files.length);
      Sentry.metrics.distribution("dsn.files_collected", files.length, {
        attributes: { stop_on_first: stopOnFirst },
      });

      if (files.length === 0) {
        return { dsns: [], sourceMtimes: {}, dirMtimes };
      }

      // Scan files
      const { results, sourceMtimes, filesScanned } = await scanFilesForDsns(
        cwd,
        files,
        stopOnFirst
      );

      span.setAttributes({
        "dsn.files_scanned": filesScanned,
        "dsn.dsns_found": results.size,
      });

      Sentry.metrics.distribution("dsn.files_scanned", filesScanned, {
        attributes: { stop_on_first: stopOnFirst },
      });
      Sentry.metrics.distribution("dsn.dsns_found", results.size, {
        attributes: { stop_on_first: stopOnFirst },
      });

      return { dsns: [...results.values()], sourceMtimes, dirMtimes };
    },
    {
      "dsn.scan_dir": cwd,
      "dsn.stop_on_first": stopOnFirst,
      "dsn.max_depth": MAX_SCAN_DEPTH,
    }
  );
}
