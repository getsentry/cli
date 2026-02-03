/**
 * Language-Agnostic Code Scanner
 *
 * Scans source code for Sentry DSNs using a simple grep-based approach.
 * This replaces the language-specific detectors with a unified scanner that:
 *
 * 1. Greps for DSN URL pattern directly: https://KEY@HOST/PROJECT_ID
 * 2. Filters out commented lines using common prefixes
 * 3. Respects .gitignore using the `ignore` package
 * 4. Validates DSN hosts (SaaS or self-hosted via SENTRY_URL)
 * 5. Scans concurrently with p-limit for performance
 * 6. Skips large files and known non-source directories
 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import ignore, { type Ignore } from "ignore";
import pLimit from "p-limit";
import { createDetectedDsn, inferPackagePath, parseDsn } from "./parser.js";
import type { DetectedDsn } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum file size to scan (256KB).
 * Files larger than this are skipped as they're unlikely to be source files
 * with DSN configuration.
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
 */
const ALWAYS_SKIP_DIRS = new Set([
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
  // PHP - vendor already listed above
  // General build outputs
  "dist",
  "out",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
]);

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
 * Pattern to match Sentry DSN URLs.
 * Captures the full DSN including protocol, public key, host, and project ID.
 *
 * Format: https://{PUBLIC_KEY}@{HOST}/{PROJECT_ID}
 * Example: https://abc123def456@o123456.ingest.us.sentry.io/4507654321
 *
 * The public key is typically a 32-character hex string, but we accept any
 * alphanumeric string to support test fixtures and edge cases.
 */
const DSN_PATTERN =
  /https?:\/\/[a-z0-9]+@[a-z0-9.-]+(?:\.sentry\.io|:[0-9]+)\/\d+/gi;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for collecting files to scan.
 */
type CollectFilesOptions = {
  /** Root directory for relative path calculation */
  cwd: string;
  /** Current directory being scanned */
  dir: string;
  /** Gitignore instance */
  ig: Ignore;
  /** Current depth level */
  depth: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract all DSN URLs from file content, filtering out commented lines.
 *
 * @param content - File content to scan
 * @returns Array of unique DSN strings found in non-commented lines
 */
export function extractDsnsFromContent(content: string): string[] {
  const dsns = new Set<string>();
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip commented lines
    if (isCommentedLine(trimmed)) {
      continue;
    }

    // Find all DSN matches in this line
    const matches = trimmed.matchAll(DSN_PATTERN);
    for (const match of matches) {
      const dsn = match[0];
      // Validate it's a real DSN with valid host
      if (isValidDsnHost(dsn)) {
        dsns.add(dsn);
      }
    }
  }

  return [...dsns];
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
 * Extract the first DSN from file content.
 * Used by cache verification to check if a DSN is still present in a file.
 *
 * @param content - File content
 * @returns First DSN found or null
 */
export function extractFirstDsnFromContent(content: string): string | null {
  const dsns = extractDsnsFromContent(content);
  return dsns[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Line Processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a line is commented out based on common comment prefixes.
 */
function isCommentedLine(trimmedLine: string): boolean {
  for (const prefix of COMMENT_PREFIXES) {
    if (trimmedLine.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate that a DSN has a valid Sentry host.
 *
 * Valid hosts are:
 * - SaaS: *.sentry.io (e.g., o123.ingest.us.sentry.io)
 * - Self-hosted: Host from SENTRY_URL environment variable
 */
function isValidDsnHost(dsn: string): boolean {
  const parsed = parseDsn(dsn);
  if (!parsed) {
    return false;
  }

  // SaaS DSN
  if (parsed.host.endsWith(".sentry.io")) {
    return true;
  }

  // Self-hosted: check SENTRY_URL environment variable
  const sentryUrl = process.env.SENTRY_URL;
  if (sentryUrl) {
    try {
      const url = new URL(sentryUrl);
      if (parsed.host === url.host) {
        return true;
      }
    } catch {
      // Invalid SENTRY_URL, ignore
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: File Collection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load .gitignore from a directory and create an ignore instance.
 */
async function loadGitignore(cwd: string): Promise<Ignore> {
  const ig = ignore();

  try {
    const gitignorePath = join(cwd, ".gitignore");
    const content = await Bun.file(gitignorePath).text();
    ig.add(content);
  } catch {
    // No .gitignore, use empty ignore instance
  }

  return ig;
}

/**
 * Check if a file should be scanned based on its extension.
 */
function shouldScanFile(filename: string): boolean {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) {
    return false;
  }
  const ext = filename.slice(lastDot);
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Recursively collect files to scan from a directory.
 *
 * @param options - Collection options (cwd, dir, ig, depth)
 * @returns Array of file paths relative to cwd
 */
async function collectFiles(options: CollectFilesOptions): Promise<string[]> {
  const { cwd, dir, ig, depth } = options;

  if (depth > MAX_SCAN_DEPTH) {
    return [];
  }

  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    const relativePath = relative(cwd, entryPath);

    // Skip always-skip directories
    if (entry.isDirectory() && ALWAYS_SKIP_DIRS.has(entry.name)) {
      continue;
    }

    // Skip gitignored paths
    if (ig.ignores(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await collectFiles({
        cwd,
        dir: entryPath,
        ig,
        depth: depth + 1,
      });
      files.push(...subFiles);
    } else if (entry.isFile() && shouldScanFile(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: File Processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a single file and extract DSNs.
 *
 * @param cwd - Root directory
 * @param relativePath - Path relative to cwd
 * @param stopOnFirst - Whether to stop after finding the first DSN
 * @returns Array of detected DSNs (may be empty)
 */
async function processFile(
  cwd: string,
  relativePath: string,
  stopOnFirst: boolean
): Promise<DetectedDsn[]> {
  const filepath = join(cwd, relativePath);

  try {
    const file = Bun.file(filepath);

    // Skip large files
    const fileSize = file.size;
    if (fileSize > MAX_FILE_SIZE) {
      return [];
    }

    const content = await file.text();
    const dsnStrings = extractDsnsFromContent(content);

    if (dsnStrings.length === 0) {
      return [];
    }

    const results: DetectedDsn[] = [];
    const packagePath = inferPackagePath(relativePath);

    for (const dsnString of dsnStrings) {
      const detected = createDetectedDsn(
        dsnString,
        "code",
        relativePath,
        packagePath
      );
      if (detected) {
        results.push(detected);
        if (stopOnFirst) {
          return results;
        }
      }
    }

    return results;
  } catch {
    // Skip files we can't read
    return [];
  }
}

/**
 * Scan files concurrently and collect DSNs.
 *
 * @param cwd - Root directory
 * @param files - Files to scan (relative paths)
 * @param stopOnFirst - Whether to stop after finding the first DSN
 * @returns Array of detected DSNs and count of files scanned
 */
async function scanFilesForDsns(
  cwd: string,
  files: string[],
  stopOnFirst: boolean
): Promise<{ results: DetectedDsn[]; filesScanned: number }> {
  const limit = pLimit(CONCURRENCY_LIMIT);
  const results: DetectedDsn[] = [];
  const seenDsns = new Set<string>();
  let filesScanned = 0;
  let earlyExit = false;

  const tasks = files.map((file) =>
    limit(async () => {
      // Check if we should stop early
      if (earlyExit) {
        return;
      }

      filesScanned += 1;
      const dsns = await processFile(cwd, file, stopOnFirst);

      for (const dsn of dsns) {
        // Deduplicate by raw DSN string
        if (!seenDsns.has(dsn.raw)) {
          seenDsns.add(dsn.raw);
          results.push(dsn);

          if (stopOnFirst) {
            earlyExit = true;
            // Clear pending tasks
            limit.clearQueue();
            return;
          }
        }
      }
    })
  );

  await Promise.all(tasks);

  return { results, filesScanned };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Main Scanner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main scan implementation with Sentry performance tracing.
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
      // Load gitignore
      const ig = await loadGitignore(cwd);

      // Collect all files to scan
      let files: string[];
      try {
        files = await collectFiles({ cwd, dir: cwd, ig, depth: 0 });
      } catch {
        // Directory might not exist or be readable
        span.setStatus({ code: 2, message: "Directory scan failed" });
        return [];
      }

      span.setAttribute("dsn.files_collected", files.length);

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
        "dsn.dsns_found": results.length,
      });
      span.setStatus({ code: 1 });

      return results;
    }
  );
}
