/**
 * File Scanner Utilities
 *
 * Shared utilities for scanning specific files and extracting DSNs.
 * Used by env-file detection for scanning .env file variants.
 */

import { join } from "node:path";
import { handleFileError } from "./fs-utils.js";
import type { DetectedDsn } from "./types.js";

/** Result of processing a single file for DSN extraction. */
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

    try {
      // Read file directly - handles ENOENT gracefully
      const content = await Bun.file(filepath).text();
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
    } catch (error) {
      handleFileError(error, {
        operation: "scanSpecificFiles",
        path: filepath,
      });
    }
  }

  return results;
}
