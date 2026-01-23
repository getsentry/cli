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

  test(
    "GET request with --field uses query parameters (not body)",
    async () => {
      await setAuthToken(TEST_TOKEN);

      // Use issues endpoint with query parameter - this tests that --field
      // with GET request properly converts fields to query params instead of body
      // (GET requests cannot have a body, so this would fail if fields went to body)
      const result = await runCli(
        ["api", "projects/", "--field", "query=platform:javascript"],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      // Should succeed (not throw "GET/HEAD method cannot have body" error)
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
    },
    { timeout: 15_000 }
  );

  test(
    "POST request with --field uses request body",
    async () => {
      await setAuthToken(TEST_TOKEN);

      // POST to a read-only endpoint will return 405, but the important thing
      // is that it doesn't fail with a client-side error about body/params
      const result = await runCli(
        ["api", "organizations/", "--method", "POST", "--field", "name=test"],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      // Should get a server error (405 Method Not Allowed or 400 Bad Request),
      // not a client-side error about body handling
      expect(result.exitCode).toBe(1);
      // The error should be from the API, not a TypeError about body
      expect(result.stdout + result.stderr).not.toMatch(/cannot have body/i);
    },
    { timeout: 15_000 }
  );
});
