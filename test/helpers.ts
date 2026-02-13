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
 * Lock SENTRY_CONFIG_DIR so concurrent test files cannot change it.
 *
 * Bun runs test files concurrently in a single process, sharing
 * `process.env` and `globalThis.fetch`. Between any `await` point
 * inside our test, another file's beforeEach/afterEach can mutate
 * these globals. The DB singleton auto-invalidates when the config
 * dir changes, so even a momentary mutation causes getDatabase() to
 * open the wrong DB and lose auth tokens / defaults.
 *
 * Uses Object.defineProperty to make the env var return the locked
 * value regardless of what other tests write. Call `unlockConfigDir`
 * in afterEach so other tests can proceed normally.
 *
 * @param configDir - The config directory path to lock
 * @returns Unlock function to call in afterEach
 */
export function lockConfigDir(configDir: string): () => void {
  Object.defineProperty(process.env, "SENTRY_CONFIG_DIR", {
    get() {
      return configDir;
    },
    set() {
      // Silently ignore writes from other test files
    },
    configurable: true,
    enumerable: true,
  });

  return () => {
    // Restore normal property behavior
    delete process.env.SENTRY_CONFIG_DIR;
    process.env.SENTRY_CONFIG_DIR = configDir;
  };
}

/**
 * Lock globalThis.fetch to a mock handler so concurrent test files
 * cannot replace it between async boundaries.
 *
 * Uses Object.defineProperty to intercept writes to globalThis.fetch,
 * similar to lockConfigDir. Call the returned unlock function in
 * afterEach to restore normal behavior.
 *
 * @param fn - The fetch mock implementation
 * @returns Unlock function to call in afterEach
 */
export function lockFetch(
  fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): () => void {
  Object.defineProperty(globalThis, "fetch", {
    get() {
      return fn;
    },
    set() {
      // Silently ignore writes from other test files
    },
    configurable: true,
    enumerable: true,
  });

  return () => {
    delete (globalThis as Record<string, unknown>).fetch;
  };
}
