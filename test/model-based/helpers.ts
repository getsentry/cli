/**
 * Model-Based Testing Helpers
 *
 * Shared utilities for fast-check model-based tests.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_ENV_VAR, closeDatabase } from "../../src/lib/db/index.js";

/**
 * Create an isolated database context for model-based tests.
 * Each test run gets its own SQLite database to avoid interference.
 *
 * Falls back to creating a temp directory if CONFIG_DIR_ENV_VAR is not set,
 * which can happen due to test ordering/worker isolation in CI.
 *
 * @returns Cleanup function to call after test completes
 */
export function createIsolatedDbContext(): () => void {
  const originalEnvValue = process.env[CONFIG_DIR_ENV_VAR];

  let testBaseDir = originalEnvValue;
  if (!testBaseDir) {
    // Fallback: create a temp base dir (matches preload.ts pattern)
    testBaseDir = join(homedir(), `.sentry-cli-test-model-${process.pid}`);
    mkdirSync(testBaseDir, { recursive: true });
    process.env[CONFIG_DIR_ENV_VAR] = testBaseDir;
  }

  // Close any existing database connection
  closeDatabase();

  // Create unique subdirectory for this test run
  const testDir = join(
    testBaseDir,
    `model-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testDir, { recursive: true });
  process.env[CONFIG_DIR_ENV_VAR] = testDir;

  return () => {
    closeDatabase();
    // Restore the original env var value, preserving undefined if it was unset
    if (originalEnvValue === undefined) {
      delete process.env[CONFIG_DIR_ENV_VAR];
    } else {
      process.env[CONFIG_DIR_ENV_VAR] = originalEnvValue;
    }
  };
}

/**
 * Default number of runs for property-based and model-based tests.
 * Balance between thoroughness and CI speed.
 */
export const DEFAULT_NUM_RUNS = 50;
