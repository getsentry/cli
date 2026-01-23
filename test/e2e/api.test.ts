/**
 * API Command E2E Tests
 *
 * Tests for sentry api command - raw authenticated API requests.
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
  testConfigDir = await createTestConfigDir("e2e-api-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry api", () => {
  // Note: The API client's base URL already includes /api/0/, so endpoints
  // should NOT include that prefix (e.g., use "organizations/" not "/api/0/organizations/")

  test("requires authentication", async () => {
    const result = await runCli(["api", "organizations/"], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test(
    "GET request works with valid auth",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["api", "organizations/"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(0);
      // Should return JSON array of organizations
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
    },
    { timeout: 15_000 }
  );

  test(
    "--include flag shows response headers",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["api", "organizations/", "--include"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(0);
      // Should include HTTP status and headers before JSON body
      expect(result.stdout).toMatch(/^HTTP \d{3}/);
      expect(result.stdout).toMatch(/content-type:/i);
    },
    { timeout: 15_000 }
  );

  test(
    "invalid endpoint returns non-zero exit code",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["api", "nonexistent-endpoint-12345/"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(1);
    },
    { timeout: 15_000 }
  );

  test(
    "--silent flag suppresses output",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["api", "organizations/", "--silent"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    },
    { timeout: 15_000 }
  );

  test(
    "--silent with error sets exit code but no output",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(
        ["api", "nonexistent-endpoint-12345/", "--silent"],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
    },
    { timeout: 15_000 }
  );

  test(
    "supports custom HTTP method",
    async () => {
      await setAuthToken(TEST_TOKEN);

      // DELETE on organizations list should return 405 Method Not Allowed
      const result = await runCli(
        ["api", "organizations/", "--method", "DELETE"],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      // Method not allowed or similar error - just checking it processes the flag
      expect(result.exitCode).toBe(1);
    },
    { timeout: 15_000 }
  );

  test(
    "rejects invalid HTTP method",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(
        ["api", "organizations/", "--method", "INVALID"],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      // Exit code 252 is stricli's parse error code, 1 is a general error
      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.stderr + result.stdout).toMatch(/invalid method/i);
    },
    { timeout: 15_000 }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Alias Tests (curl/gh api compatibility)
  // ─────────────────────────────────────────────────────────────────────────────

  test(
    "-X alias for --method works",
    async () => {
      await setAuthToken(TEST_TOKEN);

      // Use -X POST on organizations list (should fail with 405)
      const result = await runCli(["api", "organizations/", "-X", "POST"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      // POST on list endpoint typically returns 405 or similar error
      expect(result.exitCode).toBe(1);
    },
    { timeout: 15_000 }
  );

  test(
    "-i alias for --include works",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["api", "organizations/", "-i"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^HTTP \d{3}/);
    },
    { timeout: 15_000 }
  );

  test(
    "-H alias for --header works",
    async () => {
      await setAuthToken(TEST_TOKEN);

      // Add a custom header - the request should still succeed
      const result = await runCli(
        ["api", "organizations/", "-H", "X-Custom-Header: test-value"],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      expect(result.exitCode).toBe(0);
      // Should return valid JSON
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
    },
    { timeout: 15_000 }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Verbose Mode Tests
  // ─────────────────────────────────────────────────────────────────────────────

  test(
    "--verbose flag shows request and response details",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["api", "organizations/", "--verbose"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(0);
      // Should show request line with > prefix
      expect(result.stdout).toMatch(/^> GET \/api\/0\/organizations\//m);
      // Should show response status with < prefix
      expect(result.stdout).toMatch(/^< HTTP \d{3}/m);
      // Should show response headers with < prefix
      expect(result.stdout).toMatch(/^< content-type:/im);
    },
    { timeout: 15_000 }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Input From File Tests
  // ─────────────────────────────────────────────────────────────────────────────

  test(
    "--input reads body from file",
    async () => {
      await setAuthToken(TEST_TOKEN);

      // Create a temp file with JSON body
      const tempFile = `${testConfigDir}/input.json`;
      await Bun.write(tempFile, JSON.stringify({ status: "resolved" }));

      // Try to update a non-existent issue - this will fail but tests the flow
      const result = await runCli(
        ["api", "issues/999999999/", "-X", "PUT", "--input", tempFile],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      // Will fail with 404 or similar, but the flag should be processed
      expect(result.exitCode).toBe(1);
    },
    { timeout: 15_000 }
  );

  test(
    "--input with non-existent file throws error",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(
        ["api", "organizations/", "--input", "/nonexistent/file.json"],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/file not found/i);
    },
    { timeout: 15_000 }
  );
});
