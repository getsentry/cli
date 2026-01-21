/**
 * File Scanner Utilities
 *
 * Shared utilities for scanning files and extracting DSNs.
 * Used by both env-file and code detection to reduce duplication.
 *
 * The scanner provides a unified pattern for:
 * - Scanning files matching glob patterns
 * - Processing file contents to extract DSNs
 * - Supporting both "first match" and "all matches" modes
 */

import { join } from "node:path";
import type { DetectedDsn } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of processing a single file for DSN extraction.
 */
export type FileProcessResult = {
  /** Extracted DSN string (null if not found) */
  dsn: string | null;
  /** Additional metadata to attach to the DetectedDsn */
  metadata?: {
    packagePath?: string;
  };
};

/**
 * Function that processes file content and extracts DSN.
 *
 * @param relativePath - Path relative to scan root
 * @param content - File content
 * @returns Extraction result or null to skip this file
 */
export type FileProcessor = (
  relativePath: string,
  content: string
) => FileProcessResult | null;

/**
 * Options for scanning files.
 */
export type ScanOptions = {
  /** Root directory to scan from */
  cwd: string;
  /** Glob pattern(s) to match files */
  patterns: string[];
  /** Directories to skip (matched against any path segment) */
  skipDirs?: Set<string>;
  /** Stop after finding first DSN (default: false) */
  stopOnFirst?: boolean;
  /** Process file content to extract DSN */
  processFile: FileProcessor;
  /** Create DetectedDsn from raw DSN string */
  createDsn: (
    raw: string,
    relativePath: string,
    metadata?: { packagePath?: string }
  ) => DetectedDsn | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Scanner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a path should be skipped based on skip directories.
 *
 * @param filepath - Relative file path to check
 * @param skipDirs - Set of directory names to skip
 * @returns True if any path segment matches a skip directory
 */
function shouldSkipPath(filepath: string, skipDirs: Set<string>): boolean {
  if (skipDirs.size === 0) {
    return false;
  }
  const parts = filepath.split("/");
  return parts.some((part) => skipDirs.has(part));
}

/**
 * Scan files and extract DSNs using provided processor.
 *
 * This is the core scanning function used by both env-file and code detection.
 * It handles:
 * - Glob pattern matching
 * - Directory skipping
 * - File reading
 * - DSN extraction via processor callback
 * - Early exit for "first match" mode
 *
 * @param options - Scan configuration
 * @returns Array of detected DSNs (single element if stopOnFirst)
 */
export async function scanForDsns(
  options: ScanOptions
): Promise<DetectedDsn[]> {
  const {
    cwd,
    patterns,
    skipDirs = new Set(),
    stopOnFirst = false,
    processFile,
    createDsn,
  } = options;

  const results: DetectedDsn[] = [];

  // Create glob for all patterns
  if (patterns.length === 0) {
    return results;
  }
  const globPattern =
    patterns.length === 1 ? patterns[0]! : `{${patterns.join(",")}}`;
  const glob = new Bun.Glob(globPattern);

  for await (const relativePath of glob.scan({ cwd, onlyFiles: true })) {
    // Skip excluded directories
    if (shouldSkipPath(relativePath, skipDirs)) {
      continue;
    }

    const filepath = join(cwd, relativePath);

    try {
      const content = await Bun.file(filepath).text();
      const result = processFile(relativePath, content);

      if (result?.dsn) {
        const detected = createDsn(result.dsn, relativePath, result.metadata);
        if (detected) {
          results.push(detected);

          if (stopOnFirst) {
            return results;
          }
        }
      }
    } catch {
      // Skip files we can't read (permissions, binary, etc.)
    }
  }

  return results;
}

/**
 * Scan specific files (not glob) and extract DSNs.
 *
 * Used when scanning a known list of files (e.g., .env variants).
 *
 * @param cwd - Root directory
 * @param filenames - List of filenames to check (relative to cwd)
 * @param options - Processing options
 * @returns Array of detected DSNs
 */
export async function scanSpecificFiles(
  cwd: string,
  filenames: string[],
  options: {
    stopOnFirst?: boolean;
    processFile: FileProcessor;
    createDsn: (
      raw: string,
      relativePath: string,
      metadata?: { packagePath?: string }
    ) => DetectedDsn | null;
  }
): Promise<DetectedDsn[]> {
  const { stopOnFirst = false, processFile, createDsn } = options;
  const results: DetectedDsn[] = [];

  for (const filename of filenames) {
    const filepath = join(cwd, filename);
    const file = Bun.file(filepath);

    if (!(await file.exists())) {
      continue;
    }

    try {
      const content = await file.text();
      const result = processFile(filename, content);

      if (result?.dsn) {
        const detected = createDsn(result.dsn, filename, result.metadata);
        if (detected) {
          results.push(detected);

          if (stopOnFirst) {
            return results;
          }
        }
      }
    } catch {
      // Skip files we can't read
    }
  }

  return results;
}
