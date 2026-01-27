/**
 * Test Helpers
 *
 * Shared utilities for test setup and teardown.
 */

import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const TEST_TMP_DIR = resolve(import.meta.dir, "../.test-tmp");
mkdirSync(TEST_TMP_DIR, { recursive: true });

/**
 * Creates a unique temporary directory for test isolation.
 * Uses a project-local temp directory to avoid read-only system /tmp issues.
 *
 * @param prefix - Directory name prefix (default: "sentry-test-")
 * @returns Full path to the created temporary directory
 */
export async function createTestConfigDir(
  prefix = "sentry-test-"
): Promise<string> {
  return mkdtemp(join(TEST_TMP_DIR, prefix));
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
