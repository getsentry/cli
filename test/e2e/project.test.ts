/**
 * Project/Org Command E2E Tests
 *
 * Tests for sentry project and org commands (list, get).
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
  TEST_DSN,
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
  testConfigDir = await createTestConfigDir("e2e-project-");
  ctx = createE2EContext(testConfigDir, mockServer.url);
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry org list", () => {
  test("requires authentication", async () => {
    const result = await ctx.run(["org", "list"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test(
    "lists organizations with valid auth",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run(["org", "list"]);

      expect(result.exitCode).toBe(0);
      // Should contain header and at least one org
      expect(result.stdout).toContain("SLUG");
    },
    { timeout: 15_000 }
  );

  test(
    "supports --json output",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run(["org", "list", "--json"]);

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    },
    { timeout: 15_000 }
  );
});

describe("sentry project list", () => {
  test("requires authentication", async () => {
    const result = await ctx.run(["project", "list"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test(
    "lists projects with valid auth using positional org arg",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      // Use positional argument for organization
      const result = await ctx.run([
        "project",
        "list",
        TEST_ORG,
        "--limit",
        "5",
      ]);

      expect(result.exitCode).toBe(0);
    },
    { timeout: 15_000 }
  );

  test(
    "supports --json output",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      // Use positional argument for organization
      const result = await ctx.run([
        "project",
        "list",
        TEST_ORG,
        "--json",
        "--limit",
        "5",
      ]);

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
    },
    { timeout: 15_000 }
  );
});

describe("sentry org view", () => {
  test("requires authentication", async () => {
    const result = await ctx.run(["org", "view", TEST_ORG]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test(
    "gets organization details",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run(["org", "view", TEST_ORG]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(TEST_ORG);
      expect(result.stdout).toContain("Slug:");
    },
    { timeout: 15_000 }
  );

  test(
    "supports --json output",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run(["org", "view", TEST_ORG, "--json"]);

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.slug).toBe(TEST_ORG);
    },
    { timeout: 15_000 }
  );

  test(
    "handles non-existent org",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run(["org", "view", "nonexistent-org-12345"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/not found|error|404/i);
    },
    { timeout: 15_000 }
  );
});

describe("sentry project view", () => {
  test("requires authentication", async () => {
    const result = await ctx.run([
      "project",
      "view",
      TEST_PROJECT,
      "--org",
      TEST_ORG,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("requires org and project", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run(["project", "view"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/organization|project/i);
  });

  test("rejects partial flags (--org without project)", async () => {
    await ctx.setAuthToken(TEST_TOKEN);

    const result = await ctx.run(["project", "view", "--org", TEST_ORG]);

    expect(result.exitCode).toBe(1);
    // Should show error with usage hint
    const output = result.stderr + result.stdout;
    expect(output).toMatch(/organization and project is required/i);
    expect(output).toContain(
      "sentry project view <project-slug> --org <org-slug>"
    );
  });

  test(
    "gets project details",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run([
        "project",
        "view",
        TEST_PROJECT,
        "--org",
        TEST_ORG,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(TEST_PROJECT);
      expect(result.stdout).toContain("Slug:");
    },
    { timeout: 15_000 }
  );

  test(
    "displays DSN in human-readable output",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run([
        "project",
        "view",
        TEST_PROJECT,
        "--org",
        TEST_ORG,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DSN:");
      expect(result.stdout).toContain(TEST_DSN);
    },
    { timeout: 15_000 }
  );

  test(
    "supports --json output",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run([
        "project",
        "view",
        TEST_PROJECT,
        "--org",
        TEST_ORG,
        "--json",
      ]);

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.slug).toBe(TEST_PROJECT);
    },
    { timeout: 15_000 }
  );

  test(
    "includes DSN in JSON output",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run([
        "project",
        "view",
        TEST_PROJECT,
        "--org",
        TEST_ORG,
        "--json",
      ]);

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.dsn).toBe(TEST_DSN);
    },
    { timeout: 15_000 }
  );

  test(
    "handles non-existent project",
    async () => {
      await ctx.setAuthToken(TEST_TOKEN);

      const result = await ctx.run([
        "project",
        "view",
        "nonexistent-project-12345",
        "--org",
        TEST_ORG,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/not found|error|404/i);
    },
    { timeout: 15_000 }
  );
});
