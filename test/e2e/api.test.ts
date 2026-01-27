/**
 * API Command E2E Tests
 *
 * Tests for sentry api command - raw authenticated API requests.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { CONFIG_DIR_ENV_VAR, setAuthToken } from "../../src/lib/config.js";
import { createE2EContext, type E2EContext } from "../fixture.js";
import { cleanupTestDir, createTestConfigDir } from "../helpers.js";
import { createSentryMockServer, TEST_TOKEN } from "../mocks/routes.js";
import type { MockServer } from "../mocks/server.js";

let testConfigDir: string;
let mockServer: MockServer;
let ctx: E2EContext;

beforeAll(async () => {
  mockServer = createSentryMockServer();
  await mockServer.start();
});

afterAll(() => {
  mockServer.stop();
});

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("e2e-api-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
  ctx = createE2EContext(testConfigDir, mockServer.url);
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry api", () => {
  // Note: The API client's base URL already includes /api/0/, so endpoints
  // should NOT include that prefix (e.g., use "organizations/" not "/api/0/organizations/")

  test("requires authentication", async () => {
    const result = await ctx.run(["api", "organizations/"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test(
    "GET request works with valid auth",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await ctx.run(["api", "organizations/"]);

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

      const result = await ctx.run(["api", "organizations/", "--include"]);

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

      const result = await ctx.run(["api", "nonexistent-endpoint-12345/"]);

      expect(result.exitCode).toBe(1);
    },
    { timeout: 15_000 }
  );

  test(
    "--silent flag suppresses output",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await ctx.run(["api", "organizations/", "--silent"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    },
    { timeout: 15_000 }
  );

  test(
    "--silent with error sets exit code but no output",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await ctx.run([
        "api",
        "nonexistent-endpoint-12345/",
        "--silent",
      ]);

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
      const result = await ctx.run([
        "api",
        "organizations/",
        "--method",
        "DELETE",
      ]);

      // Method not allowed or similar error - just checking it processes the flag
      expect(result.exitCode).toBe(1);
    },
    { timeout: 15_000 }
  );

  test(
    "rejects invalid HTTP method",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await ctx.run([
        "api",
        "organizations/",
        "--method",
        "INVALID",
      ]);

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
      const result = await ctx.run(["api", "organizations/", "-X", "POST"]);

      // POST on list endpoint typically returns 405 or similar error
      expect(result.exitCode).toBe(1);
    },
    { timeout: 15_000 }
  );

  test(
    "-i alias for --include works",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await ctx.run(["api", "organizations/", "-i"]);

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
      const result = await ctx.run([
        "api",
        "organizations/",
        "-H",
        "X-Custom-Header: test-value",
      ]);

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

      const result = await ctx.run(["api", "organizations/", "--verbose"]);

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
      const result = await ctx.run([
        "api",
        "issues/999999999/",
        "-X",
        "PUT",
        "--input",
        tempFile,
      ]);

      // Will fail with 404 or similar, but the flag should be processed
      expect(result.exitCode).toBe(1);
    },
    { timeout: 15_000 }
  );

  test(
    "--input with non-existent file throws error",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await ctx.run([
        "api",
        "organizations/",
        "--input",
        "/nonexistent/file.json",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/file not found/i);
    },
    { timeout: 15_000 }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // GET/POST Field Routing Tests
  // ─────────────────────────────────────────────────────────────────────────────

  test(
    "GET request with --field uses query parameters (not body)",
    async () => {
      await setAuthToken(TEST_TOKEN);

      // Use issues endpoint with query parameter - this tests that --field
      // with GET request properly converts fields to query params instead of body
      // (GET requests cannot have a body, so this would fail if fields went to body)
      const result = await ctx.run([
        "api",
        "projects/",
        "--field",
        "query=platform:javascript",
      ]);

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
      const result = await ctx.run([
        "api",
        "organizations/",
        "--method",
        "POST",
        "--field",
        "name=test",
      ]);

      // Should get a server error (405 Method Not Allowed or 400 Bad Request),
      // not a client-side error about body handling
      expect(result.exitCode).toBe(1);
      // The error should be from the API, not a TypeError about body
      expect(result.stdout + result.stderr).not.toMatch(/cannot have body/i);
    },
    { timeout: 15_000 }
  );
});
