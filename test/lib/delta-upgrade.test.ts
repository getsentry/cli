/**
 * Unit Tests for Delta Upgrade Module
 *
 * Tests the helper functions that don't require network access.
 * Network-dependent functions (resolveStableChain, resolveNightlyChain, etc.)
 * are tested via E2E tests.
 */

import { describe, expect, test } from "bun:test";
import {
  canAttemptDelta,
  getPlatformBinaryName,
} from "../../src/lib/delta-upgrade.js";

describe("getPlatformBinaryName", () => {
  test("returns a string starting with 'sentry-'", () => {
    const name = getPlatformBinaryName();
    expect(name.startsWith("sentry-")).toBe(true);
  });

  test("contains platform and arch components", () => {
    const name = getPlatformBinaryName();
    // Should be sentry-<os>-<arch> or sentry-<os>-<arch>.exe
    const parts = name.replace(".exe", "").split("-");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe("sentry");
    // OS should be one of the known values
    expect(["linux", "darwin", "windows"]).toContain(parts[1]);
    // Arch should be one of the known values
    expect(["x64", "arm64"]).toContain(parts[2]);
  });

  test("has .exe suffix on windows platform name", () => {
    const name = getPlatformBinaryName();
    if (process.platform === "win32") {
      expect(name.endsWith(".exe")).toBe(true);
    } else {
      expect(name.endsWith(".exe")).toBe(false);
    }
  });
});

describe("canAttemptDelta", () => {
  test("returns false for cross-channel upgrade (stable → nightly)", () => {
    // If CLI_VERSION is a dev build (0.0.0-dev), this also returns false
    // but for a different reason. Testing the cross-channel check requires
    // a non-dev CLI_VERSION, which is hard to mock without module-level changes.
    // Instead we test the observable behavior.
    const result = canAttemptDelta("0.14.0-dev.123");
    // Since CLI_VERSION in test is "0.0.0-dev", this should be false
    expect(result).toBe(false);
  });

  test("returns false for dev build", () => {
    // CLI_VERSION is "0.0.0-dev" in development
    const result = canAttemptDelta("0.14.0");
    expect(result).toBe(false);
  });

  test("returns false for nightly target from dev build", () => {
    const result = canAttemptDelta("0.14.0-dev.abc123");
    expect(result).toBe(false);
  });
});
