/**
 * Region Resolution Tests
 *
 * Tests for resolving organization regions in multi-region Sentry support.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setAuthToken } from "../../src/lib/db/auth.js";
import { CONFIG_DIR_ENV_VAR, closeDatabase } from "../../src/lib/db/index.js";
import { setOrgRegion } from "../../src/lib/db/regions.js";
import {
  getDefaultBaseUrl,
  isMultiRegionEnabled,
  resolveOrgRegion,
} from "../../src/lib/region.js";

const testBaseDir = process.env[CONFIG_DIR_ENV_VAR]!;

beforeEach(async () => {
  closeDatabase();
  const testConfigDir = join(
    testBaseDir,
    `region-resolve-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
  // Clear any SENTRY_URL override for most tests
  delete process.env.SENTRY_URL;
  // Set up auth token for API tests
  await setAuthToken("test-token");
});

afterEach(() => {
  closeDatabase();
  delete process.env.SENTRY_URL;
});

describe("getDefaultBaseUrl", () => {
  test("returns sentry.io by default", () => {
    delete process.env.SENTRY_URL;
    expect(getDefaultBaseUrl()).toBe("https://sentry.io");
  });

  test("respects SENTRY_URL env var", () => {
    process.env.SENTRY_URL = "https://sentry.mycompany.com";
    expect(getDefaultBaseUrl()).toBe("https://sentry.mycompany.com");
  });
});

describe("isMultiRegionEnabled", () => {
  test("returns true for sentry.io (default)", () => {
    delete process.env.SENTRY_URL;
    expect(isMultiRegionEnabled()).toBe(true);
  });

  test("returns true for *.sentry.io URLs", () => {
    process.env.SENTRY_URL = "https://us.sentry.io";
    expect(isMultiRegionEnabled()).toBe(true);
  });

  test("returns true for de.sentry.io", () => {
    process.env.SENTRY_URL = "https://de.sentry.io";
    expect(isMultiRegionEnabled()).toBe(true);
  });

  test("returns false for self-hosted URLs", () => {
    process.env.SENTRY_URL = "https://sentry.mycompany.com";
    expect(isMultiRegionEnabled()).toBe(false);
  });

  test("returns false for localhost", () => {
    process.env.SENTRY_URL = "http://localhost:9000";
    expect(isMultiRegionEnabled()).toBe(false);
  });

  // Security edge cases - ensure proper URL parsing
  test("returns false for URL with sentry.io in path (not hostname)", () => {
    process.env.SENTRY_URL = "https://evil.com/sentry.io";
    expect(isMultiRegionEnabled()).toBe(false);
  });

  test("returns false for lookalike domain sentry.io.evil.com", () => {
    process.env.SENTRY_URL = "https://sentry.io.evil.com";
    expect(isMultiRegionEnabled()).toBe(false);
  });

  test("returns false for domain with sentry.io prefix", () => {
    process.env.SENTRY_URL = "https://sentry.io-fake.com";
    expect(isMultiRegionEnabled()).toBe(false);
  });

  test("returns false for invalid URL", () => {
    process.env.SENTRY_URL = "not-a-valid-url";
    expect(isMultiRegionEnabled()).toBe(false);
  });
});

describe("resolveOrgRegion", () => {
  test("returns cached region when available", async () => {
    await setOrgRegion("cached-org", "https://de.sentry.io");

    const regionUrl = await resolveOrgRegion("cached-org");
    expect(regionUrl).toBe("https://de.sentry.io");
  });

  test("fetches and caches region from API on cache miss", async () => {
    // Import getOrgRegion to verify caching
    const { getOrgRegion } = await import("../../src/lib/db/regions.js");

    // Verify org is not in cache
    const before = await getOrgRegion("new-org");
    expect(before).toBeUndefined();

    // Mock fetch to return org with regionUrl
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.includes("/organizations/new-org/")) {
        return new Response(
          JSON.stringify({
            id: "123",
            slug: "new-org",
            name: "New Organization",
            links: {
              organizationUrl: "https://de.sentry.io/organizations/new-org/",
              regionUrl: "https://de.sentry.io",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    try {
      const regionUrl = await resolveOrgRegion("new-org");

      // Should return the region from API
      expect(regionUrl).toBe("https://de.sentry.io");

      // Should have cached the region
      const after = await getOrgRegion("new-org");
      expect(after).toBe("https://de.sentry.io");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses default URL as region when org has no links.regionUrl", async () => {
    // Mock fetch to return org without links
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.includes("/organizations/no-links-org/")) {
        return new Response(
          JSON.stringify({
            id: "456",
            slug: "no-links-org",
            name: "Org Without Links",
            // No links field
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    try {
      const regionUrl = await resolveOrgRegion("no-links-org");

      // Should fall back to default URL
      expect(regionUrl).toBe("https://sentry.io");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to default URL when API call fails", async () => {
    // Mock fetch to fail
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network error");
    };

    try {
      const regionUrl = await resolveOrgRegion("unknown-org");
      // Should fall back to default
      expect(regionUrl).toBe("https://sentry.io");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses SENTRY_URL as fallback for self-hosted", async () => {
    process.env.SENTRY_URL = "https://sentry.mycompany.com";

    // Mock fetch to fail (no multi-region on self-hosted)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network error");
    };

    try {
      const regionUrl = await resolveOrgRegion("self-hosted-org");
      expect(regionUrl).toBe("https://sentry.mycompany.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses cached region on subsequent calls", async () => {
    // Pre-populate cache (simulating what happens after a successful API fetch)
    await setOrgRegion("cached-org-2", "https://de.sentry.io");

    // First call should use cache
    const regionUrl1 = await resolveOrgRegion("cached-org-2");
    expect(regionUrl1).toBe("https://de.sentry.io");

    // Second call should also use cache
    const regionUrl2 = await resolveOrgRegion("cached-org-2");
    expect(regionUrl2).toBe("https://de.sentry.io");
  });

  test("cache survives across multiple resolve calls", async () => {
    // Populate cache with multiple orgs
    await setOrgRegion("org-a", "https://us.sentry.io");
    await setOrgRegion("org-b", "https://de.sentry.io");

    // Resolve in different order
    expect(await resolveOrgRegion("org-b")).toBe("https://de.sentry.io");
    expect(await resolveOrgRegion("org-a")).toBe("https://us.sentry.io");
    expect(await resolveOrgRegion("org-b")).toBe("https://de.sentry.io");
  });
});
