/**
 * Version Check Storage Tests
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_ENV_VAR,
  closeDatabase,
} from "../../../src/lib/db/index.js";
import {
  getVersionCheckInfo,
  setVersionCheckInfo,
} from "../../../src/lib/db/version-check.js";

/**
 * Test isolation: Each test gets its own config directory.
 * Uses the same pattern as config.test.ts to avoid env var conflicts.
 */
const testBaseDir = process.env[CONFIG_DIR_ENV_VAR]!;

beforeEach(() => {
  closeDatabase();
  const testConfigDir = join(
    testBaseDir,
    `version-check-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
});

afterEach(() => {
  closeDatabase();
  // Restore original base dir to maintain test isolation
  process.env[CONFIG_DIR_ENV_VAR] = testBaseDir;
});

describe("getVersionCheckInfo", () => {
  test("returns null values when no data stored", () => {
    const info = getVersionCheckInfo();
    expect(info.lastChecked).toBeNull();
    expect(info.latestVersion).toBeNull();
  });
});

describe("setVersionCheckInfo", () => {
  test("stores and retrieves version check info", () => {
    setVersionCheckInfo("1.2.3");
    const info = getVersionCheckInfo();

    expect(info.latestVersion).toBe("1.2.3");
    expect(info.lastChecked).toBeGreaterThan(0);
    expect(info.lastChecked).toBeLessThanOrEqual(Date.now());
  });

  test("updates existing version check info", () => {
    setVersionCheckInfo("1.0.0");
    const first = getVersionCheckInfo();

    setVersionCheckInfo("2.0.0");
    const second = getVersionCheckInfo();

    expect(second.latestVersion).toBe("2.0.0");
    expect(second.lastChecked).toBeGreaterThanOrEqual(first.lastChecked!);
  });
});
