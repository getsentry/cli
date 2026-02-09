/**
 * Trace Command E2E Tests
 *
 * Tests for sentry trace list and sentry trace view commands.
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
  TEST_TRACE_ID,
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
  testConfigDir = await createTestConfigDir("e2e-trace-");
  ctx = createE2EContext(testConfigDir, mockServer.url);
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry trace list", () => {
  test("requires authentication", async () => {
    const result = await ctx.run([
      "trace",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("lists traces with valid auth using positional arg", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "trace",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
    ]);

    expect(result.exitCode).toBe(0);
  });

  test("supports --json output", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "trace",
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
      "trace",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "--limit",
      "5",
    ]);

    expect(result.exitCode).toBe(0);
  });

  test("validates --limit range", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "trace",
      "list",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "--limit",
      "9999",
    ]);

    // Stricli uses exit code 252 for parse errors
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/must be between|1.*1000/i);
  });

  test("traces shortcut works", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run(["traces", `${TEST_ORG}/${TEST_PROJECT}`]);

    expect(result.exitCode).toBe(0);
  });
});

describe("sentry trace view", () => {
  test("requires authentication", async () => {
    const result = await ctx.run([
      "trace",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      TEST_TRACE_ID,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("requires org and project without DSN", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run(["trace", "view", TEST_TRACE_ID]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/organization|project/i);
  });

  test("fetches trace with valid auth", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "trace",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      TEST_TRACE_ID,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(TEST_TRACE_ID);
  });

  test("supports --json output", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "trace",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      TEST_TRACE_ID,
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("summary");
    expect(data).toHaveProperty("spans");
  });

  test("handles non-existent trace", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "trace",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "00000000000000000000000000000000",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not found|no trace/i);
  });
});
