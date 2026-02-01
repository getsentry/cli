/**
 * Version Check Storage Tests
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getVersionCheckInfo,
  setVersionCheckInfo,
} from "../../../src/lib/db/version-check.js";
import { cleanupTestDir, createTestConfigDir } from "../../helpers.js";

let testConfigDir: string;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-version-check-");
  process.env.SENTRY_CONFIG_DIR = testConfigDir;
});

afterEach(async () => {
  delete process.env.SENTRY_CONFIG_DIR;
  await cleanupTestDir(testConfigDir);
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
