/**
 * Issue Command E2E Tests
 *
 * Tests for sentry issue list and get commands.
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
  testConfigDir = await createTestConfigDir("e2e-issue-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
  ctx = createE2EContext(testConfigDir, mockServer.url);
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry issue list", () => {
  test("requires authentication", async () => {
    const result = await ctx.run([
      "issue",
      "list",
      "--org",
      "test-org",
      "--project",
      "test-project",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("lists issues with valid auth", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "issue",
      "list",
      "--org",
      TEST_ORG,
      "--project",
      TEST_PROJECT,
    ]);

    // Should succeed (may have 0 issues, that's fine)
    expect(result.exitCode).toBe(0);
  });

  test("supports --json output", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await ctx.run([
      "issue",
      "list",
      "--org",
      TEST_ORG,
      "--project",
      TEST_PROJECT,
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    // Should be valid JSON array
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("sentry issue view", () => {
  test("requires authentication", async () => {
    const result = await ctx.run(["issue", "view", "12345"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("handles non-existent issue", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await ctx.run(["issue", "view", "99999999999"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not found|error/i);
  });
});
