/**
 * Project/Org Command E2E Tests
 *
 * Tests for sentry project and org commands (list, get).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CONFIG_DIR_ENV_VAR, setAuthToken } from "../../src/lib/config.js";
import { runCli } from "../fixture.js";
import { cleanupTestDir, createTestConfigDir } from "../helpers.js";

// Test credentials from environment - these MUST be set
const TEST_TOKEN = process.env.SENTRY_TEST_AUTH_TOKEN;
const TEST_ORG = process.env.SENTRY_TEST_ORG;
const TEST_PROJECT = process.env.SENTRY_TEST_PROJECT;

if (!(TEST_TOKEN && TEST_ORG && TEST_PROJECT)) {
  throw new Error(
    "SENTRY_TEST_AUTH_TOKEN, SENTRY_TEST_ORG, and SENTRY_TEST_PROJECT environment variables are required for E2E tests"
  );
}

// Each test gets its own config directory
let testConfigDir: string;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("e2e-project-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
});

afterEach(async () => {
  await cleanupTestDir(testConfigDir);
});

describe("sentry org list", () => {
  test("requires authentication", async () => {
    const result = await runCli(["org", "list"], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test(
    "lists organizations with valid auth",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["org", "list"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(0);
      // Should contain header and at least one org
      expect(result.stdout).toContain("SLUG");
    },
    { timeout: 15_000 }
  );

  test(
    "supports --json output",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["org", "list", "--json"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

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
    const result = await runCli(["project", "list"], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test(
    "lists projects with valid auth and org filter",
    async () => {
      await setAuthToken(TEST_TOKEN);

      // Use --org flag to filter by organization
      const result = await runCli(
        ["project", "list", "--org", TEST_ORG, "--limit", "5"],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      expect(result.exitCode).toBe(0);
    },
    { timeout: 15_000 }
  );

  test(
    "supports --json output",
    async () => {
      await setAuthToken(TEST_TOKEN);

      // Use --org flag to filter by organization
      const result = await runCli(
        ["project", "list", "--org", TEST_ORG, "--json", "--limit", "5"],
        {
          env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
        }
      );

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
    },
    { timeout: 15_000 }
  );
});

describe("sentry org view", () => {
  test("requires authentication", async () => {
    const result = await runCli(["org", "view", TEST_ORG], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test(
    "gets organization details",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["org", "view", TEST_ORG], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(TEST_ORG);
      expect(result.stdout).toContain("Slug:");
    },
    { timeout: 15_000 }
  );

  test(
    "supports --json output",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["org", "view", TEST_ORG, "--json"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.slug).toBe(TEST_ORG);
    },
    { timeout: 15_000 }
  );

  test(
    "handles non-existent org",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(["org", "view", "nonexistent-org-12345"], {
        env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/not found|error|404/i);
    },
    { timeout: 15_000 }
  );
});

describe("sentry project view", () => {
  test("requires authentication", async () => {
    const result = await runCli(
      ["project", "view", TEST_PROJECT, "--org", TEST_ORG],
      { env: { [CONFIG_DIR_ENV_VAR]: testConfigDir } }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("requires org and project", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["project", "view"], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/organization|project/i);
  });

  test("rejects partial flags (--org without project)", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["project", "view", "--org", TEST_ORG], {
      env: { [CONFIG_DIR_ENV_VAR]: testConfigDir },
    });

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
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(
        ["project", "view", TEST_PROJECT, "--org", TEST_ORG],
        { env: { [CONFIG_DIR_ENV_VAR]: testConfigDir } }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(TEST_PROJECT);
      expect(result.stdout).toContain("Slug:");
    },
    { timeout: 15_000 }
  );

  test(
    "supports --json output",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(
        ["project", "view", TEST_PROJECT, "--org", TEST_ORG, "--json"],
        { env: { [CONFIG_DIR_ENV_VAR]: testConfigDir } }
      );

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.slug).toBe(TEST_PROJECT);
    },
    { timeout: 15_000 }
  );

  test(
    "handles non-existent project",
    async () => {
      await setAuthToken(TEST_TOKEN);

      const result = await runCli(
        ["project", "view", "nonexistent-project-12345", "--org", TEST_ORG],
        { env: { [CONFIG_DIR_ENV_VAR]: testConfigDir } }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/not found|error|404/i);
    },
    { timeout: 15_000 }
  );
});
