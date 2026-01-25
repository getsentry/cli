/**
 * Auth Command E2E Tests
 *
 * Tests for sentry auth login, logout, and status commands.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CONFIG_DIR_ENV_VAR, setAuthToken } from "../../src/lib/config.js";
import { runCli } from "../fixture.js";
import { cleanupTestDir, createTestConfigDir } from "../helpers.js";

// Test credentials from environment - these MUST be set
const TEST_TOKEN = process.env.SENTRY_TEST_AUTH_TOKEN;

if (!TEST_TOKEN) {
  throw new Error(
    "SENTRY_TEST_AUTH_TOKEN environment variable is required for E2E tests"
  );
}

// Each test gets its own config directory
let testConfigDir: string;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("e2e-auth-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry auth status", () => {
  test("shows not authenticated when no token", async () => {
    const result = await runCli(["auth", "status"], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

    // Error message may be in stdout or stderr depending on CLI framework
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/not authenticated/i);
    expect(result.exitCode).toBe(1);
  });

  test("shows authenticated with valid token", async () => {
    // Set up auth token in config
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["auth", "status"], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

    expect(result.stdout).toContain("Authenticated");
    expect(result.exitCode).toBe(0);
  });

  test("verifies credentials with valid token", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["auth", "status"], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Authenticated");
    expect(result.stdout).toContain("Access verified");
  });
});

describe("sentry auth login --token", () => {
  test(
    "stores valid API token",
    async () => {
      const result = await runCli(["auth", "login", "--token", TEST_TOKEN], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.stdout).toContain("Authenticated");
      expect(result.exitCode).toBe(0);

      // Verify token was stored
      const statusResult = await runCli(["auth", "status"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });
      expect(statusResult.stdout).toContain("Authenticated");
    },
    { timeout: 15_000 }
  );

  test("rejects invalid token", async () => {
    const result = await runCli(
      ["auth", "login", "--token", "invalid-token-12345"],
      {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(
      /invalid|unauthorized|error/i
    );
  });
});

describe("sentry auth logout", () => {
  test(
    "clears stored auth",
    async () => {
      // First login
      const loginResult = await runCli(
        ["auth", "login", "--token", TEST_TOKEN],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );
      expect(loginResult.exitCode).toBe(0);

      // Then logout
      const result = await runCli(["auth", "logout"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/logged out/i);

      // Verify we're logged out
      const statusResult = await runCli(["auth", "status"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });
      const output = statusResult.stdout + statusResult.stderr;
      expect(output).toMatch(/not authenticated/i);
    },
    { timeout: 15_000 }
  );

  test("succeeds even when not authenticated", async () => {
    const result = await runCli(["auth", "logout"], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

    // Should not error, just inform user
    expect(result.exitCode).toBe(0);
  });
});
