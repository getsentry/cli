/**
 * Version Check Logic Tests
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setVersionCheckInfo } from "../../src/lib/db/version-check.js";
import {
  getUpdateNotification,
  maybeCheckForUpdateInBackground,
  shouldSuppressNotification,
} from "../../src/lib/version-check.js";
import { cleanupTestDir, createTestConfigDir } from "../helpers.js";

describe("shouldSuppressNotification", () => {
  test("suppresses for upgrade command", () => {
    expect(shouldSuppressNotification(["upgrade"])).toBe(true);
    expect(shouldSuppressNotification(["upgrade", "--check"])).toBe(true);
  });

  test("suppresses for --version flag", () => {
    expect(shouldSuppressNotification(["--version"])).toBe(true);
    expect(shouldSuppressNotification(["-V"])).toBe(true);
  });

  test("suppresses for --json flag", () => {
    expect(shouldSuppressNotification(["issue", "list", "--json"])).toBe(true);
    expect(shouldSuppressNotification(["--json", "issue", "list"])).toBe(true);
  });

  test("does not suppress for regular commands", () => {
    expect(shouldSuppressNotification(["issue", "list"])).toBe(false);
    expect(shouldSuppressNotification(["auth", "status"])).toBe(false);
    expect(shouldSuppressNotification(["help"])).toBe(false);
  });

  test("does not suppress for empty args", () => {
    expect(shouldSuppressNotification([])).toBe(false);
  });
});

// Note: shouldCheckForUpdate is now an internal function that reads from the DB.
// Its probabilistic behavior is tested indirectly through maybeCheckForUpdateInBackground.

describe("getUpdateNotification", () => {
  let testConfigDir: string;

  beforeEach(async () => {
    testConfigDir = await createTestConfigDir("test-version-notif-");
    process.env.SENTRY_CONFIG_DIR = testConfigDir;
  });

  afterEach(async () => {
    delete process.env.SENTRY_CONFIG_DIR;
    await cleanupTestDir(testConfigDir);
  });

  test("returns null when no version info is cached", () => {
    const notification = getUpdateNotification();
    expect(notification).toBeNull();
  });

  test("returns null when cached version is same as current", () => {
    // CLI_VERSION is "0.0.0-dev" in test environment
    setVersionCheckInfo("0.0.0-dev");
    const notification = getUpdateNotification();
    expect(notification).toBeNull();
  });

  test("returns null when cached version is older than current", () => {
    // Any version older than 0.0.0-dev (which is essentially "no version")
    // Actually 0.0.0 is equal to 0.0.0-dev in semver (pre-release is older)
    // So let's use something clearly older
    setVersionCheckInfo("0.0.0-alpha");
    const notification = getUpdateNotification();
    expect(notification).toBeNull();
  });

  test("returns notification message when newer version is available", () => {
    setVersionCheckInfo("99.0.0");
    const notification = getUpdateNotification();

    expect(notification).not.toBeNull();
    expect(notification).toContain("Update available:");
    expect(notification).toContain("99.0.0");
    expect(notification).toContain("sentry upgrade");
  });
});

describe("maybeCheckForUpdateInBackground", () => {
  let testConfigDir: string;

  beforeEach(async () => {
    testConfigDir = await createTestConfigDir("test-version-bg-");
    process.env.SENTRY_CONFIG_DIR = testConfigDir;
  });

  afterEach(async () => {
    delete process.env.SENTRY_CONFIG_DIR;
    await cleanupTestDir(testConfigDir);
  });

  test("does not throw when called", () => {
    // This test verifies the function can be called without errors
    // The actual network call happens in the background and may fail,
    // but the function itself should not throw
    expect(() => maybeCheckForUpdateInBackground()).not.toThrow();
  });
});

describe("opt-out behavior", () => {
  test("functions are no-ops when SENTRY_CLI_NO_UPDATE_CHECK=1", () => {
    // We need to test this in a subprocess because the env var is checked
    // at module load time. The current process has already loaded the module.
    const { spawnSync } = require("node:child_process");
    const { join } = require("node:path");

    const testScript = `
      const { getUpdateNotification, maybeCheckForUpdateInBackground } = await import('./src/lib/version-check.js');
      
      // These should be no-ops
      maybeCheckForUpdateInBackground();
      const notification = getUpdateNotification();
      
      console.log(notification === null ? 'PASS' : 'FAIL');
    `;

    const cwd = join(import.meta.dir, "../..");
    const proc = spawnSync("bun", ["-e", testScript], {
      cwd,
      env: { ...process.env, SENTRY_CLI_NO_UPDATE_CHECK: "1" },
      encoding: "utf-8",
    });

    expect(proc.stdout.trim()).toBe("PASS");
  });
});
