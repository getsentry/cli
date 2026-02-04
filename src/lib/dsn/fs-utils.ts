/**
 * File System Utilities for DSN Detection
 *
 * Shared utilities for handling file system errors during scanning.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";

/**
 * Check if an error is an expected file system error that should be silently ignored.
 *
 * Expected errors during file scanning:
 * - ENOENT: File or directory does not exist
 * - EACCES: Permission denied (e.g., no read access)
 *
 * All other errors are unexpected and should be reported to Sentry.
 *
 * @param error - The error to check
 * @returns True if the error is expected and should be ignored
 */
export function isIgnorableFileError(error: unknown): boolean {
  if (error instanceof Error && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "EACCES";
  }
  return false;
}

/**
 * Handle a file system error by either ignoring it (for expected errors)
 * or capturing it to Sentry (for unexpected errors).
 *
 * @param error - The error that occurred
 * @param context - Additional context for Sentry (e.g., file path, operation)
 */
export function handleFileError(
  error: unknown,
  context: { operation: string; path?: string }
): void {
  if (!isIgnorableFileError(error)) {
    Sentry.captureException(error, {
      tags: {
        operation: context.operation,
      },
      extra: {
        path: context.path,
      },
    });
  }
}
