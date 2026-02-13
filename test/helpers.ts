/**
 * Test Helpers
 *
 * Shared utilities for test setup and teardown.
 */

import { afterEach, beforeEach } from "bun:test";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG_DIR_ENV_VAR, closeDatabase } from "../src/lib/db/index.js";

const TEST_TMP_DIR = resolve(import.meta.dir, "../.test-tmp");
mkdirSync(TEST_TMP_DIR, { recursive: true });

type TestConfigDirOptions = {
  /**
   * Creates a .git directory to make this an isolated "project root".
   * This prevents DSN detection from walking up to the actual project root,
   * which would find real DSNs and cause fingerprint mismatches in tests.
   */
  isolateProjectRoot?: boolean;
};

/**
 * Creates a unique temporary directory for test isolation.
 * Uses a project-local temp directory to avoid read-only system /tmp issues.
 *
 * @param prefix - Directory name prefix (default: "sentry-test-")
 * @param options - Configuration options
 * @returns Full path to the created temporary directory
 */
export async function createTestConfigDir(
  prefix = "sentry-test-",
  options?: TestConfigDirOptions
): Promise<string> {
  const dir = await mkdtemp(join(TEST_TMP_DIR, prefix));

  if (options?.isolateProjectRoot) {
    mkdirSync(join(dir, ".git"));
  }

  return dir;
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

/**
 * Helper type for fetch mock functions.
 * Bun's fetch type includes extra properties like `preconnect` that our mocks don't have.
 * Supports both full signature and simpler forms for tests that don't need input/init.
 */
type FetchMockFn =
  | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)
  | (() => Promise<Response>);

/**
 * Create a properly typed fetch mock for tests.
 * This casts the mock function to handle Bun's extended fetch type.
 *
 * @param fn - Fetch mock implementation
 * @returns Properly typed fetch function
 */
export function mockFetch(fn: FetchMockFn): typeof fetch {
  return fn as unknown as typeof fetch;
}

/**
 * Sets up an isolated test config directory with proper env var lifecycle.
 *
 * Registers beforeEach/afterEach hooks that create a unique config directory,
 * point SENTRY_CONFIG_DIR at it, and restore the original value on teardown.
 * This eliminates the fragile pattern of manually managing process.env in
 * each test file, which caused cross-file pollution when afterEach hooks
 * deleted the env var while other files were still loading.
 *
 * Must be called at module scope or inside a describe() block.
 *
 * @param prefix - Directory name prefix for the temp directory
 * @param options - Configuration options (e.g., isolateProjectRoot)
 * @returns Getter function for the current test's config directory path
 */
export function useTestConfigDir(
  prefix = "sentry-test-",
  options?: TestConfigDirOptions
): () => string {
  let dir: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env[CONFIG_DIR_ENV_VAR];
    closeDatabase();
    dir = await createTestConfigDir(prefix, options);
    process.env[CONFIG_DIR_ENV_VAR] = dir;
  });

  afterEach(async () => {
    closeDatabase();
    // Always restore the previous value — never delete.
    // Deleting process.env.SENTRY_CONFIG_DIR causes failures in test files
    // that load after this afterEach runs, because their module-level code
    // (or beforeEach hooks) may read the env var and get undefined.
    if (savedConfigDir !== undefined) {
      process.env[CONFIG_DIR_ENV_VAR] = savedConfigDir;
    }
    await cleanupTestDir(dir);
  });

  return () => dir;
}
