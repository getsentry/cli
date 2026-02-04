/**
 * Organization Region Cache Tests
 *
 * Tests for the SQLite-based region caching used in multi-region support.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_ENV_VAR,
  closeDatabase,
} from "../../../src/lib/db/index.js";
import {
  clearOrgRegions,
  getAllOrgRegions,
  getOrgRegion,
  setOrgRegion,
  setOrgRegions,
} from "../../../src/lib/db/regions.js";

const testBaseDir = process.env[CONFIG_DIR_ENV_VAR]!;

beforeEach(() => {
  closeDatabase();
  const testConfigDir = join(
    testBaseDir,
    `regions-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
});

afterEach(() => {
  closeDatabase();
  // Restore original base dir to maintain test isolation
  process.env[CONFIG_DIR_ENV_VAR] = testBaseDir;
});

describe("setOrgRegion / getOrgRegion", () => {
  test("stores and retrieves a single org region", async () => {
    await setOrgRegion("my-org", "https://us.sentry.io");

    const regionUrl = await getOrgRegion("my-org");
    expect(regionUrl).toBe("https://us.sentry.io");
  });

  test("returns undefined for unknown org", async () => {
    const regionUrl = await getOrgRegion("nonexistent-org");
    expect(regionUrl).toBeUndefined();
  });

  test("overwrites existing region on update", async () => {
    await setOrgRegion("my-org", "https://us.sentry.io");
    await setOrgRegion("my-org", "https://de.sentry.io");

    const regionUrl = await getOrgRegion("my-org");
    expect(regionUrl).toBe("https://de.sentry.io");
  });

  test("stores multiple orgs independently", async () => {
    await setOrgRegion("us-org", "https://us.sentry.io");
    await setOrgRegion("eu-org", "https://de.sentry.io");

    expect(await getOrgRegion("us-org")).toBe("https://us.sentry.io");
    expect(await getOrgRegion("eu-org")).toBe("https://de.sentry.io");
  });
});

describe("setOrgRegions (batch)", () => {
  test("stores multiple org regions in a single call", async () => {
    await setOrgRegions([
      ["org-1", "https://us.sentry.io"],
      ["org-2", "https://de.sentry.io"],
      ["org-3", "https://us.sentry.io"],
    ]);

    expect(await getOrgRegion("org-1")).toBe("https://us.sentry.io");
    expect(await getOrgRegion("org-2")).toBe("https://de.sentry.io");
    expect(await getOrgRegion("org-3")).toBe("https://us.sentry.io");
  });

  test("handles empty array gracefully", async () => {
    await setOrgRegions([]);
    // Should not throw, just be a no-op
    expect(await getOrgRegion("any-org")).toBeUndefined();
  });

  test("overwrites existing entries", async () => {
    await setOrgRegion("org-1", "https://us.sentry.io");

    await setOrgRegions([
      ["org-1", "https://de.sentry.io"],
      ["org-2", "https://us.sentry.io"],
    ]);

    expect(await getOrgRegion("org-1")).toBe("https://de.sentry.io");
    expect(await getOrgRegion("org-2")).toBe("https://us.sentry.io");
  });
});

describe("clearOrgRegions", () => {
  test("removes all cached regions", async () => {
    await setOrgRegions([
      ["org-1", "https://us.sentry.io"],
      ["org-2", "https://de.sentry.io"],
    ]);

    await clearOrgRegions();

    expect(await getOrgRegion("org-1")).toBeUndefined();
    expect(await getOrgRegion("org-2")).toBeUndefined();
  });

  test("is safe to call on empty cache", async () => {
    await clearOrgRegions();
    // Should not throw
    expect(await getOrgRegion("any-org")).toBeUndefined();
  });
});

describe("getAllOrgRegions", () => {
  test("returns all cached org->region mappings", async () => {
    await setOrgRegions([
      ["org-1", "https://us.sentry.io"],
      ["org-2", "https://de.sentry.io"],
      ["org-3", "https://us.sentry.io"],
    ]);

    const allRegions = await getAllOrgRegions();

    expect(allRegions.size).toBe(3);
    expect(allRegions.get("org-1")).toBe("https://us.sentry.io");
    expect(allRegions.get("org-2")).toBe("https://de.sentry.io");
    expect(allRegions.get("org-3")).toBe("https://us.sentry.io");
  });

  test("returns empty map when cache is empty", async () => {
    const allRegions = await getAllOrgRegions();
    expect(allRegions.size).toBe(0);
  });
});
