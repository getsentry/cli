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

import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import ignore, { type Ignore } from "ignore";
import pLimit from "p-limit";
import { DEFAULT_SENTRY_HOST } from "../constants.js";
import { createDetectedDsn, inferPackagePath, parseDsn } from "./parser.js";
import type { DetectedDsn } from "./types.js";

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
 * Pattern to split paths on both forward and back slashes for cross-platform support.
 */
const PATH_SEPARATOR_PATTERN = /[/\\]/;

/**
 * Pattern to match Sentry DSN URLs.
 * Captures the full DSN including protocol, public key, host, and project ID.
 *
 * Format: https://{PUBLIC_KEY}@{HOST}/{PROJECT_ID}
 * Example: https://abc123def456@o123456.ingest.us.sentry.io/4507654321
 *
 * The public key is typically a 32-character hex string, but we accept any
 * alphanumeric string to support test fixtures and edge cases.
 *
 * Uses 'g' flag for global matching - IMPORTANT: reset lastIndex before reuse
 * or create new RegExp instances when needed.
 */
const DSN_PATTERN =
  /https?:\/\/[a-z0-9]+@[a-z0-9.-]+(?:\.[a-z]+|:[0-9]+)\/\d+/gi;

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
 * Returns all unique DSNs found across all files.
 *
 * @param cwd - Directory to scan
 * @returns Array of detected DSNs with source information
 */
export function scanCodeForDsns(cwd: string): Promise<DetectedDsn[]> {
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
  const results = await scanDirectory(cwd, true);
  return results[0] ?? null;
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
 * @returns Object with host info for validation
 */
function getExpectedHost(): { host: string; isSaas: boolean } | null {
  const sentryUrl = process.env.SENTRY_URL;

  if (sentryUrl) {
    // Self-hosted: only accept DSNs matching the configured host
    try {
      const url = new URL(sentryUrl);
      return { host: url.host, isSaas: false };
    } catch {
      // Invalid SENTRY_URL, can't validate
      return null;
    }
  }

  // SaaS: only accept *.sentry.io
  return { host: DEFAULT_SENTRY_HOST, isSaas: true };
}

/**
 * Validate that a DSN has an acceptable Sentry host.
 *
 * When SENTRY_URL is set (self-hosted): only DSNs matching that exact host are valid
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

  const expected = getExpectedHost();
  if (!expected) {
    return false;
  }

  if (expected.isSaas) {
    // SaaS: accept sentry.io or any subdomain (e.g., o123.ingest.us.sentry.io)
    return (
      parsed.host === expected.host || parsed.host.endsWith(`.${expected.host}`)
    );
  }

  // Self-hosted: exact host match only
  return parsed.host === expected.host;
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
    const gitignorePath = join(cwd, ".gitignore");
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
  const ext = extname(filename);
  return ext !== "" && TEXT_EXTENSIONS.has(ext);
}

/**
 * Get the depth of a path (number of directory separators).
 * Uses regex to split on both forward and back slashes for cross-platform support.
 */
function getPathDepth(relativePath: string): number {
  if (!relativePath) {
    return 0;
  }
  return relativePath.split(PATH_SEPARATOR_PATTERN).length - 1;
}

/**
 * Collect files to scan from a directory using recursive readdir.
 *
 * @param cwd - Root directory to scan
 * @param ig - Ignore filter instance
 * @returns Array of file paths relative to cwd
 */
async function collectFiles(cwd: string, ig: Ignore): Promise<string[]> {
  const entries = await readdir(cwd, { withFileTypes: true, recursive: true });
  const files: string[] = [];

  for (const entry of entries) {
    // Skip non-files
    if (!entry.isFile()) {
      continue;
    }

    // Build relative path - entry.parentPath is the directory containing the entry
    const relativePath = relative(cwd, join(entry.parentPath, entry.name));

    // Skip files beyond max depth
    if (getPathDepth(relativePath) > MAX_SCAN_DEPTH) {
      continue;
    }

    // Skip ignored paths (includes ALWAYS_SKIP_DIRS and .gitignore patterns)
    if (ig.ignores(relativePath)) {
      continue;
    }

    // Only include files with scannable extensions
    if (shouldScanFile(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Process a single file and extract DSNs.
 *
 * @param cwd - Root directory
 * @param relativePath - Path relative to cwd
 * @param limit - Maximum DSNs to extract (undefined = no limit)
 * @returns Array of detected DSNs (may be empty)
 */
async function processFile(
  cwd: string,
  relativePath: string,
  limit?: number
): Promise<DetectedDsn[]> {
  const filepath = join(cwd, relativePath);

  try {
    const file = Bun.file(filepath);

    // Skip large files - check happens here to avoid extra stat() calls during
    // collection. Bun.file().size is cheap once we have the file handle.
    if (file.size > MAX_FILE_SIZE) {
      return [];
    }

    const content = await file.text();
    const dsnStrings = extractDsnsFromContent(content, limit);

    if (dsnStrings.length === 0) {
      return [];
    }

    const packagePath = inferPackagePath(relativePath);

    // Map DSN strings to DetectedDsn objects, filtering out any that fail to parse
    return dsnStrings
      .map((dsn) => createDetectedDsn(dsn, "code", relativePath, packagePath))
      .filter((d): d is DetectedDsn => d !== null);
  } catch {
    // Skip files we can't read
    return [];
  }
}

/**
 * State for concurrent DSN scanning.
 */
type ScanState = {
  results: Map<string, DetectedDsn>;
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
  const dsns = await processFile(cwd, file, stopOnFirst ? 1 : undefined);

  for (const dsn of dsns) {
    if (!state.results.has(dsn.raw)) {
      state.results.set(dsn.raw, dsn);
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
 * @returns Map of DSNs (keyed by raw string) and count of files scanned
 */
async function scanFilesForDsns(
  cwd: string,
  files: string[],
  stopOnFirst: boolean
): Promise<{ results: Map<string, DetectedDsn>; filesScanned: number }> {
  const limit = pLimit(CONCURRENCY_LIMIT);
  const state: ScanState = {
    results: new Map(),
    filesScanned: 0,
    earlyExit: false,
  };

  const tasks = files.map((file) =>
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
    })
  );

  await Promise.all(tasks);

  return { results: state.results, filesScanned: state.filesScanned };
}

/**
 * Main scan implementation with Sentry performance tracing and metrics.
 */
function scanDirectory(
  cwd: string,
  stopOnFirst: boolean
): Promise<DetectedDsn[]> {
  return Sentry.startSpan(
    {
      name: "scanCodeForDsns",
      op: "dsn.detect.code",
      attributes: {
        "dsn.scan_dir": cwd,
        "dsn.stop_on_first": stopOnFirst,
        "dsn.max_depth": MAX_SCAN_DEPTH,
      },
      onlyIfParent: true,
    },
    async (span) => {
      // Create ignore filter with built-in patterns and .gitignore
      const ig = await createIgnoreFilter(cwd);

      // Collect all files to scan
      let files: string[];
      try {
        files = await collectFiles(cwd, ig);
      } catch {
        span.setStatus({ code: 2, message: "Directory scan failed" });
        return [];
      }

      span.setAttribute("dsn.files_collected", files.length);
      Sentry.metrics.distribution("dsn.files_collected", files.length, {
        attributes: { stop_on_first: String(stopOnFirst) },
      });

      if (files.length === 0) {
        span.setStatus({ code: 1 });
        return [];
      }

      // Scan files
      const { results, filesScanned } = await scanFilesForDsns(
        cwd,
        files,
        stopOnFirst
      );

      span.setAttributes({
        "dsn.files_scanned": filesScanned,
        "dsn.dsns_found": results.size,
      });

      Sentry.metrics.distribution("dsn.files_scanned", filesScanned, {
        attributes: { stop_on_first: String(stopOnFirst) },
      });
      Sentry.metrics.distribution("dsn.dsns_found", results.size, {
        attributes: { stop_on_first: String(stopOnFirst) },
      });

      span.setStatus({ code: 1 });

      return [...results.values()];
    }
  );
}
