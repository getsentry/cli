/**
 * Test Helpers
 *
 * Shared utilities for test setup and teardown.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Creates a unique temporary directory for test isolation.
 * Uses the system temp directory for cross-platform compatibility.
 *
 * @param prefix - Directory name prefix (default: "sentry-test-")
 * @returns Full path to the created temporary directory
 */
export async function createTestConfigDir(
  prefix = "sentry-test-"
): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Safely removes a test directory.
 *
 * @param dir - Directory path to remove
 */
export async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
