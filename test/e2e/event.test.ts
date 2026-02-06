/**
 * Event Command E2E Tests
 *
 * Tests for sentry event get command.
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
  testConfigDir = await createTestConfigDir("e2e-event-");
  ctx = createE2EContext(testConfigDir, mockServer.url);
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry event view", () => {
  test("requires authentication", async () => {
    // Use positional arg format: <org>/<project> <event-id>
    const result = await ctx.run([
      "event",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "abc123",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("requires org and project without DSN", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run(["event", "view", "abc123"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/organization|project/i);
  });

  test("handles non-existent event", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    // Use positional arg format: <org>/<project> <event-id>
    const result = await ctx.run([
      "event",
      "view",
      `${TEST_ORG}/${TEST_PROJECT}`,
      "nonexistent123",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not found|error|404/i);
  });
});
