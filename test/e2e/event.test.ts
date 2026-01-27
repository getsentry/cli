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
  testConfigDir = await createTestConfigDir("e2e-event-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry event view", () => {
  test("requires authentication", async () => {
    const result = await runCli(
      ["event", "view", "abc123", "--org", TEST_ORG, "--project", TEST_PROJECT],
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

  test("requires org and project without DSN", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["event", "view", "abc123"], {
      env: {
        [CONFIG_DIR_ENV_VAR]: testConfigDir,
        SENTRY_URL: mockServer.url,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/organization|project/i);
  });

  test("handles non-existent event", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(
      [
        "event",
        "view",
        "nonexistent123",
        "--org",
        TEST_ORG,
        "--project",
        TEST_PROJECT,
      ],
      {
        env: {
          [CONFIG_DIR_ENV_VAR]: testConfigDir,
          SENTRY_URL: mockServer.url,
        },
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not found|error|404/i);
  });
});
