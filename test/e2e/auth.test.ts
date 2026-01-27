/**
 * Auth Command E2E Tests
 *
 * Tests for sentry auth login, logout, and status commands.
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
  testConfigDir = await createTestConfigDir("e2e-auth-");
  ctx = createE2EContext(testConfigDir, mockServer.url);
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry auth status", () => {
  test("shows not authenticated when no token", async () => {
    const result = await ctx.run(["auth", "status"]);

    // Error message may be in stdout or stderr depending on CLI framework
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/not authenticated/i);
    expect(result.exitCode).toBe(1);
  });

  test("shows authenticated with valid token", async () => {
    // Set up auth token in config
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run(["auth", "status"]);

    expect(result.stdout).toContain("Authenticated");
    expect(result.exitCode).toBe(0);
  });

  test("verifies credentials with valid token", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run(["auth", "status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Authenticated");
    expect(result.stdout).toContain("Access verified");
  });
});

describe("sentry auth login --token", () => {
  test(
    "stores valid API token",
    async () => {
      const result = await ctx.run(["auth", "login", "--token", TEST_TOKEN]);

      expect(result.stdout).toContain("Authenticated");
      expect(result.exitCode).toBe(0);

      // Verify token was stored
      const statusResult = await ctx.run(["auth", "status"]);
      expect(statusResult.stdout).toContain("Authenticated");
    },
    { timeout: 10_000 }
  );

  test("rejects invalid token", async () => {
    const result = await ctx.run([
      "auth",
      "login",
      "--token",
      "invalid-token-12345",
    ]);

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
      const loginResult = await ctx.run([
        "auth",
        "login",
        "--token",
        TEST_TOKEN,
      ]);
      expect(loginResult.exitCode).toBe(0);

      // Then logout
      const result = await ctx.run(["auth", "logout"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/logged out/i);

      // Verify we're logged out
      const statusResult = await ctx.run(["auth", "status"]);
      const output = statusResult.stdout + statusResult.stderr;
      expect(output).toMatch(/not authenticated/i);
    },
    { timeout: 15_000 }
  );

  test("succeeds even when not authenticated", async () => {
    const result = await ctx.run(["auth", "logout"]);

    // Should not error, just inform user
    expect(result.exitCode).toBe(0);
  });
});
