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
import { runCli } from "../fixture.js";
import { cleanupTestDir, createTestConfigDir } from "../helpers.js";
import {
  createSentryMockServer,
  TEST_ORG,
  TEST_PROJECT,
  TEST_TOKEN,
} from "../mocks/routes.js";
import type { MockServer } from "../mocks/server.js";

// Each test gets its own config directory
let testConfigDir: string;
let mockServer: MockServer;

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
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry issue list", () => {
  test("requires authentication", async () => {
    const result = await runCli(
      ["issue", "list", "--org", "test-org", "--project", "test-project"],
      {
        env: {
          [CONFIG_DIR_ENV_VAR]: testConfigDir,
          SENTRY_URL: mockServer.url,
        },
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("lists issues with valid auth", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(
      ["issue", "list", "--org", TEST_ORG, "--project", TEST_PROJECT],
      {
        env: {
          [CONFIG_DIR_ENV_VAR]: testConfigDir,
          SENTRY_URL: mockServer.url,
        },
      }
    );

    // Should succeed (may have 0 issues, that's fine)
    expect(result.exitCode).toBe(0);
  });

  test("supports --json output", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(
      ["issue", "list", "--org", TEST_ORG, "--project", TEST_PROJECT, "--json"],
      {
        env: {
          [CONFIG_DIR_ENV_VAR]: testConfigDir,
          SENTRY_URL: mockServer.url,
        },
      }
    );

    expect(result.exitCode).toBe(0);
    // Should be valid JSON array
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("sentry issue view", () => {
  test("requires authentication", async () => {
    const result = await runCli(["issue", "view", "12345"], {
      env: {
        [CONFIG_DIR_ENV_VAR]: testConfigDir,
        SENTRY_URL: mockServer.url,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("handles non-existent issue", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["issue", "view", "99999999999"], {
      env: {
        [CONFIG_DIR_ENV_VAR]: testConfigDir,
        SENTRY_URL: mockServer.url,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not found|error/i);
  });
});
