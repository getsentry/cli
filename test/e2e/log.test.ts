/**
 * Log Command E2E Tests
 *
 * Tests for sentry log list command.
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
import {
  createSentryMockServer,
  TEST_LOG_ID,
  TEST_ORG,
  TEST_PROJECT,
  TEST_TOKEN,
} from "../mocks/routes.js";
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
  testConfigDir = await createTestConfigDir("e2e-log-");
  ctx = createE2EContext(testConfigDir, mockServer.url);
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry log list", () => {
  test("requires authentication", async () => {
    const result = await ctx.run([
      "log",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("lists logs with valid auth using positional arg", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
    ]);

    expect(result.exitCode).toBe(0);
  });

  test("supports --json output", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    // Should be valid JSON array
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("supports --limit flag", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "--limit",
      "5",
    ]);

    expect(result.exitCode).toBe(0);
  });

  test("supports -n alias for --limit", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "-n",
      "5",
    ]);

    expect(result.exitCode).toBe(0);
  });

  test("validates --limit range", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "--limit",
      "9999",
    ]);

    // Stricli uses exit code 252 for parse errors
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/must be between|1.*1000/i);
  });

  test("supports -f flag for follow mode", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    // We can't actually test follow mode in e2e since it runs forever,
    // but we can verify the flag is accepted by checking --help
    const result = await ctx.run(["log", "list", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/-f.*--follow/);
    expect(result.stdout).toMatch(/poll interval/i);
  });
});

describe("sentry log view", () => {
  test("requires authentication", async () => {
    const result = await ctx.run([
      "log",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      TEST_LOG_ID,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("requires org and project without DSN", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run(["log", "view", TEST_LOG_ID]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/organization|project/i);
  });

  test("fetches log with valid auth", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      TEST_LOG_ID,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Log");
    expect(result.stdout).toContain(TEST_LOG_ID);
  });

  test("supports --json output", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      TEST_LOG_ID,
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data["sentry.item_id"]).toBe(TEST_LOG_ID);
  });

  test("handles non-existent log", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "nonexistent-log-id-12345",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not found|no log/i);
  });
});
