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
 * Module-level lock state for SENTRY_CONFIG_DIR.
 *
 * We replace process.env with a Proxy that intercepts reads, writes,
 * and deletes of SENTRY_CONFIG_DIR. When locked, the proxy returns the
 * locked value and silently ignores mutations. When unlocked, all
 * operations pass through to the real env object.
 *
 * A Proxy is used instead of Object.defineProperty because:
 * - configurable:true descriptors can be removed by `delete` (other
 *   test files do `delete process.env[CONFIG_DIR_ENV_VAR]` in afterEach)
 * - configurable:false descriptors cause `delete` to throw in Bun,
 *   breaking other test files
 *
 * The Proxy is installed once and persists for the process lifetime.
 * Lock/unlock just toggles the module-level state variables.
 */
let configDirLocked = false;
let configDirLockedValue: string | undefined;
let envProxyInstalled = false;

function installEnvProxy(): void {
  if (envProxyInstalled) return;
  const realEnv = process.env;
  process.env = new Proxy(realEnv, {
    get(target, prop, receiver) {
      if (prop === "SENTRY_CONFIG_DIR" && configDirLocked) {
        return configDirLockedValue;
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value) {
      if (prop === "SENTRY_CONFIG_DIR" && configDirLocked) {
        return true; // Silently ignore
      }
      return Reflect.set(target, prop, value);
    },
    deleteProperty(target, prop) {
      if (prop === "SENTRY_CONFIG_DIR" && configDirLocked) {
        return true; // Silently ignore
      }
      return Reflect.deleteProperty(target, prop);
    },
  });
  envProxyInstalled = true;
}

/**
 * Lock SENTRY_CONFIG_DIR so concurrent test files cannot change it.
 *
 * Bun runs test files concurrently in a single process, sharing
 * `process.env`. Between any `await` point inside our test, another
 * file's beforeEach/afterEach can mutate the env var. The DB singleton
 * auto-invalidates when the config dir changes, so even a momentary
 * mutation causes getDatabase() to open the wrong DB and lose data.
 *
 * Uses a Proxy on process.env that intercepts get/set/delete of the
 * config dir env var. When locked, returns the locked value and ignores
 * mutations. When unlocked, all operations pass through normally.
 *
 * @param configDir - The config directory path to lock
 * @returns Unlock function to call in afterEach
 */
export function lockConfigDir(configDir: string): () => void {
  installEnvProxy();
  configDirLocked = true;
  configDirLockedValue = configDir;

  return () => {
    configDirLocked = false;
  };
}

/**
 * Lock globalThis.fetch to a mock handler so concurrent test files
 * cannot replace it between async boundaries.
 *
 * Uses configurable: true since concurrent test files use assignment
 * (not delete) for fetch, and other test files (e.g. api-client) need
 * to assign their own mock via globalThis.fetch = ... without going
 * through this lock.
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
