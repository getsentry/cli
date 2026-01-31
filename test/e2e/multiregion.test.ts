/**
 * Multi-Region E2E Tests
 *
 * Tests for multi-region support in the CLI. Verifies that the CLI correctly
 * discovers regions, fetches data from multiple regions, and displays region
 * information when appropriate.
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
  createMultiRegionMockServer,
  EU_ORGS,
  EU_PROJECTS,
  type MultiRegionMockServer,
  TEST_TOKEN,
  US_ORGS,
  US_PROJECTS,
} from "../mocks/multiregion.js";

/** Test timeout for multi-region tests (3 servers = slower startup) */
const TEST_TIMEOUT = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Region Tests (user has orgs in both US and EU)
// ─────────────────────────────────────────────────────────────────────────────

describe("multi-region", () => {
  let testConfigDir: string;
  let mockServer: MultiRegionMockServer;
  let ctx: E2EContext;

  beforeAll(async () => {
    mockServer = createMultiRegionMockServer();
    await mockServer.start();
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(async () => {
    testConfigDir = await createTestConfigDir("e2e-multiregion-");
    ctx = createE2EContext(testConfigDir, mockServer.url);
  });

  afterEach(async () => {
    await cleanupTestDir(testConfigDir);
  });

  describe("sentry org list", () => {
    test(
      "shows REGION column when user has orgs in multiple regions",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        const result = await ctx.run(["org", "list"]);

        expect(result.exitCode).toBe(0);
        // Should have REGION column in header
        expect(result.stdout).toContain("REGION");
        // In test environment, region URLs are localhost, so display shows LOCALHOST
        // The important thing is that REGION column appears when orgs span multiple regions
        // (In production, would show US/EU based on actual hostname like us.sentry.io)
      },
      { timeout: TEST_TIMEOUT }
    );

    test(
      "lists organizations from all regions",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        const result = await ctx.run(["org", "list"]);

        expect(result.exitCode).toBe(0);
        // Should contain US orgs
        for (const orgSlug of US_ORGS) {
          expect(result.stdout).toContain(orgSlug);
        }
        // Should contain EU orgs
        for (const orgSlug of EU_ORGS) {
          expect(result.stdout).toContain(orgSlug);
        }
      },
      { timeout: TEST_TIMEOUT }
    );

    test(
      "--json returns orgs from all regions",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        const result = await ctx.run(["org", "list", "--json"]);

        expect(result.exitCode).toBe(0);
        const data = JSON.parse(result.stdout);
        expect(Array.isArray(data)).toBe(true);

        const slugs = data.map((org: { slug: string }) => org.slug);
        // Should contain all orgs from both regions
        for (const orgSlug of [...US_ORGS, ...EU_ORGS]) {
          expect(slugs).toContain(orgSlug);
        }
      },
      { timeout: TEST_TIMEOUT }
    );
  });

  describe("sentry org view", () => {
    test(
      "routes to correct region for US org",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        // First list orgs to populate region cache
        await ctx.run(["org", "list"]);

        // Then view a US org
        const result = await ctx.run(["org", "view", "acme-corp"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("acme-corp");
        expect(result.stdout).toContain("Acme Corporation");
      },
      { timeout: TEST_TIMEOUT }
    );

    test(
      "routes to correct region for EU org",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        // First list orgs to populate region cache
        await ctx.run(["org", "list"]);

        // Then view an EU org
        const result = await ctx.run(["org", "view", "euro-gmbh"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("euro-gmbh");
        expect(result.stdout).toContain("Euro GmbH");
      },
      { timeout: TEST_TIMEOUT }
    );
  });

  describe("sentry project list", () => {
    test(
      "lists projects from US region org",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        // First list orgs to populate region cache
        await ctx.run(["org", "list"]);

        const result = await ctx.run(["project", "list", "--org", "acme-corp"]);

        expect(result.exitCode).toBe(0);
        // Should contain US projects for acme-corp
        for (const projectSlug of US_PROJECTS["acme-corp"]) {
          expect(result.stdout).toContain(projectSlug);
        }
      },
      { timeout: TEST_TIMEOUT }
    );

    test(
      "lists projects from EU region org",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        // First list orgs to populate region cache
        await ctx.run(["org", "list"]);

        const result = await ctx.run(["project", "list", "--org", "euro-gmbh"]);

        expect(result.exitCode).toBe(0);
        // Should contain EU projects for euro-gmbh
        for (const projectSlug of EU_PROJECTS["euro-gmbh"]) {
          expect(result.stdout).toContain(projectSlug);
        }
      },
      { timeout: TEST_TIMEOUT }
    );

    test(
      "--json returns projects from specified region",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        // First list orgs to populate region cache
        await ctx.run(["org", "list"]);

        const result = await ctx.run([
          "project",
          "list",
          "--org",
          "berlin-startup",
          "--json",
        ]);

        expect(result.exitCode).toBe(0);
        const data = JSON.parse(result.stdout);
        expect(Array.isArray(data)).toBe(true);

        const slugs = data.map((p: { slug: string }) => p.slug);
        for (const projectSlug of EU_PROJECTS["berlin-startup"]) {
          expect(slugs).toContain(projectSlug);
        }
      },
      { timeout: TEST_TIMEOUT }
    );
  });

  describe("sentry issue list", () => {
    test(
      "lists issues from US region project",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        // First list orgs to populate region cache
        await ctx.run(["org", "list"]);

        const result = await ctx.run([
          "issue",
          "list",
          "--org",
          "acme-corp",
          "--project",
          "acme-frontend",
        ]);

        expect(result.exitCode).toBe(0);
        // Should contain the US issue
        expect(result.stdout).toContain("ACME-FRONTEND-1A");
      },
      { timeout: TEST_TIMEOUT }
    );

    test(
      "lists issues from EU region project",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        // First list orgs to populate region cache
        await ctx.run(["org", "list"]);

        const result = await ctx.run([
          "issue",
          "list",
          "--org",
          "euro-gmbh",
          "--project",
          "euro-portal",
        ]);

        expect(result.exitCode).toBe(0);
        // Should contain the EU issue
        expect(result.stdout).toContain("EURO-PORTAL-1A");
      },
      { timeout: TEST_TIMEOUT }
    );

    test(
      "--json returns issues from correct region",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        // First list orgs to populate region cache
        await ctx.run(["org", "list"]);

        const result = await ctx.run([
          "issue",
          "list",
          "--org",
          "berlin-startup",
          "--project",
          "berlin-app",
          "--json",
        ]);

        expect(result.exitCode).toBe(0);
        const data = JSON.parse(result.stdout);
        expect(Array.isArray(data)).toBe(true);

        // Should contain Berlin issue
        const shortIds = data.map((i: { shortId: string }) => i.shortId);
        expect(shortIds).toContain("BERLIN-APP-1A");
      },
      { timeout: TEST_TIMEOUT }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Single Region Tests (user only has orgs in US)
// ─────────────────────────────────────────────────────────────────────────────

describe("single-region", () => {
  let testConfigDir: string;
  let mockServer: MultiRegionMockServer;
  let ctx: E2EContext;

  beforeAll(async () => {
    mockServer = createMultiRegionMockServer({ singleRegionMode: true });
    await mockServer.start();
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(async () => {
    testConfigDir = await createTestConfigDir("e2e-singleregion-");
    ctx = createE2EContext(testConfigDir, mockServer.url);
  });

  afterEach(async () => {
    await cleanupTestDir(testConfigDir);
  });

  describe("sentry org list", () => {
    test(
      "does NOT show REGION column when user has orgs in single region",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        const result = await ctx.run(["org", "list"]);

        expect(result.exitCode).toBe(0);
        // Should NOT have REGION column (only one region)
        expect(result.stdout).not.toContain("REGION");
        // Should still contain US orgs
        expect(result.stdout).toContain("acme-corp");
        expect(result.stdout).toContain("widgets-inc");
      },
      { timeout: TEST_TIMEOUT }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Self-Hosted Fallback Tests (regions endpoint returns 404)
// ─────────────────────────────────────────────────────────────────────────────

describe("self-hosted fallback", () => {
  let testConfigDir: string;
  let mockServer: MultiRegionMockServer;
  let ctx: E2EContext;

  beforeAll(async () => {
    mockServer = createMultiRegionMockServer({ selfHostedMode: true });
    await mockServer.start();
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(async () => {
    testConfigDir = await createTestConfigDir("e2e-selfhosted-");
    ctx = createE2EContext(testConfigDir, mockServer.url);
  });

  afterEach(async () => {
    await cleanupTestDir(testConfigDir);
  });

  describe("sentry org list", () => {
    test(
      "falls back to default API when regions endpoint returns 404",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        const result = await ctx.run(["org", "list"]);

        expect(result.exitCode).toBe(0);
        // Should still list organizations (from default endpoint)
        expect(result.stdout).toContain("SLUG");
        // Should have orgs from the fallback (US fixtures served by control silo)
        expect(result.stdout).toContain("acme-corp");
      },
      { timeout: TEST_TIMEOUT }
    );

    test(
      "--json works with self-hosted fallback",
      async () => {
        await ctx.setAuthToken(TEST_TOKEN);

        const result = await ctx.run(["org", "list", "--json"]);

        expect(result.exitCode).toBe(0);
        const data = JSON.parse(result.stdout);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);
      },
      { timeout: TEST_TIMEOUT }
    );
  });
});
