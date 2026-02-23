/**
 * Test Environment Setup
 *
 * Isolates tests from user's real configuration and environment.
 * Runs before all tests via bunfig.toml preload.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Load .env.local for test credentials (SENTRY_TEST_*)
// This mimics what would happen in CI where secrets are injected as env vars
const envLocalPath = resolve(import.meta.dir, "../.env.local");
if (existsSync(envLocalPath)) {
  const content = readFileSync(envLocalPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only set if not already set (env vars take precedence)
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Create isolated test directory
const testDir = join(homedir(), `.sentry-cli-test-${process.pid}`);
mkdirSync(testDir, { recursive: true });

// Override config directory for all tests
// Note: This must match CONFIG_DIR_ENV_VAR from src/lib/config.ts
process.env.SENTRY_CONFIG_DIR = testDir;

// Clear Sentry environment variables to ensure clean state
// (but preserve SENTRY_TEST_* vars for E2E tests)
delete process.env.SENTRY_DSN;
delete process.env.SENTRY_AUTH_TOKEN;
delete process.env.SENTRY_CLIENT_ID;
delete process.env.SENTRY_URL;
delete process.env.SENTRY_ORG;
delete process.env.SENTRY_PROJECT;

// Disable telemetry and background update checks in tests
// This prevents Sentry SDK from keeping the process alive and making external calls
process.env.SENTRY_CLI_NO_TELEMETRY = "1";
process.env.SENTRY_CLI_NO_UPDATE_CHECK = "1";

// Mock global fetch to prevent any external network calls in unit tests
// Tests that need real fetch should restore it in their setup
const originalFetch = globalThis.fetch;

function getUrlFromInput(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
  const url = getUrlFromInput(input);
  console.error(`[TEST] Unexpected fetch call to: ${url}`);
  console.error(
    "[TEST] Tests should mock fetch or use SENTRY_TEST_* credentials for real API calls"
  );
  throw new Error(`Unmocked fetch call to: ${url}`);
};

// Cast via unknown to avoid Bun's extended fetch type (which includes preconnect)
globalThis.fetch = mockFetch as unknown as typeof fetch;

// Export original fetch for tests that need to restore it
(globalThis as { __originalFetch?: typeof fetch }).__originalFetch =
  originalFetch;

// Cleanup after all tests
process.on("exit", () => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// Also cleanup on SIGINT/SIGTERM
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
