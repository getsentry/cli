/**
 * Region Resolution Tests
 *
 * Tests for resolving organization regions in multi-region Sentry support.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_ENV_VAR, closeDatabase } from "../../src/lib/db/index.js";
import { setOrgRegion } from "../../src/lib/db/regions.js";
import {
  getDefaultBaseUrl,
  isMultiRegionEnabled,
  resolveOrgRegion,
} from "../../src/lib/region.js";

const testBaseDir = process.env[CONFIG_DIR_ENV_VAR]!;

beforeEach(() => {
  closeDatabase();
  const testConfigDir = join(
    testBaseDir,
    `region-resolve-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
  // Clear any SENTRY_URL override for most tests
  delete process.env.SENTRY_URL;
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

  test("returns false for self-hosted URLs", () => {
    process.env.SENTRY_URL = "https://sentry.mycompany.com";
    expect(isMultiRegionEnabled()).toBe(false);
  });

  test("returns false for localhost", () => {
    process.env.SENTRY_URL = "http://localhost:9000";
    expect(isMultiRegionEnabled()).toBe(false);
  });
});

describe("resolveOrgRegion", () => {
  test("returns cached region when available", async () => {
    await setOrgRegion("cached-org", "https://de.sentry.io");

    const regionUrl = await resolveOrgRegion("cached-org");
    expect(regionUrl).toBe("https://de.sentry.io");
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
