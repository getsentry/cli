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

  test("supports --tail flag", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "--tail",
      "5",
    ]);

    expect(result.exitCode).toBe(0);
  });

  test("validates --tail range", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "log",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "--tail",
      "9999",
    ]);

    // Stricli uses exit code 252 for parse errors
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/must be between|1.*1000/i);
  });
});
