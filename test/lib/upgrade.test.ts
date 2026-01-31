/**
 * Upgrade Module Tests
 *
 * Tests for upgrade detection and logic.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { UpgradeError } from "../../src/lib/errors.js";
import {
  fetchLatestFromGitHub,
  fetchLatestFromNpm,
  parseInstallationMethod,
} from "../../src/lib/upgrade.js";

// Store original fetch for restoration
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseInstallationMethod", () => {
  test("parses valid methods", () => {
    expect(parseInstallationMethod("curl")).toBe("curl");
    expect(parseInstallationMethod("npm")).toBe("npm");
    expect(parseInstallationMethod("pnpm")).toBe("pnpm");
    expect(parseInstallationMethod("bun")).toBe("bun");
    expect(parseInstallationMethod("yarn")).toBe("yarn");
  });

  test("parses case-insensitively", () => {
    expect(parseInstallationMethod("NPM")).toBe("npm");
    expect(parseInstallationMethod("Curl")).toBe("curl");
    expect(parseInstallationMethod("YARN")).toBe("yarn");
  });

  test("throws on invalid method", () => {
    expect(() => parseInstallationMethod("pip")).toThrow("Invalid method: pip");
    expect(() => parseInstallationMethod("apt")).toThrow("Invalid method: apt");
    expect(() => parseInstallationMethod("brew")).toThrow(
      "Invalid method: brew"
    );
    expect(() => parseInstallationMethod("")).toThrow("Invalid method: ");
  });
});

describe("fetchLatestFromGitHub", () => {
  test("returns version from GitHub API", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: "v1.2.3",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const version = await fetchLatestFromGitHub();
    expect(version).toBe("1.2.3");
  });

  test("strips v prefix from version", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.5.0",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const version = await fetchLatestFromGitHub();
    expect(version).toBe("0.5.0");
  });

  test("handles version without v prefix", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: "1.0.0",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const version = await fetchLatestFromGitHub();
    expect(version).toBe("1.0.0");
  });

  test("throws on HTTP error", async () => {
    globalThis.fetch = async () =>
      new Response("Not Found", {
        status: 404,
      });

    await expect(fetchLatestFromGitHub()).rejects.toThrow(UpgradeError);
    await expect(fetchLatestFromGitHub()).rejects.toThrow(
      "Failed to fetch from GitHub: 404"
    );
  });

  test("throws on network failure (DNS, timeout, etc.)", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(fetchLatestFromGitHub()).rejects.toThrow(UpgradeError);
    await expect(fetchLatestFromGitHub()).rejects.toThrow(
      "Failed to connect to GitHub: fetch failed"
    );
  });

  test("throws when no tag_name in response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    await expect(fetchLatestFromGitHub()).rejects.toThrow(
      "No version found in GitHub release"
    );
  });
});

describe("fetchLatestFromNpm", () => {
  test("returns version from npm registry", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          version: "1.2.3",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const version = await fetchLatestFromNpm();
    expect(version).toBe("1.2.3");
  });

  test("throws on HTTP error", async () => {
    globalThis.fetch = async () =>
      new Response("Server Error", {
        status: 500,
      });

    await expect(fetchLatestFromNpm()).rejects.toThrow(UpgradeError);
    await expect(fetchLatestFromNpm()).rejects.toThrow(
      "Failed to fetch from npm: 500"
    );
  });

  test("throws on network failure (DNS, timeout, etc.)", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(fetchLatestFromNpm()).rejects.toThrow(UpgradeError);
    await expect(fetchLatestFromNpm()).rejects.toThrow(
      "Failed to connect to npm registry: fetch failed"
    );
  });

  test("throws when no version in response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    await expect(fetchLatestFromNpm()).rejects.toThrow(
      "No version found in npm registry"
    );
  });
});

describe("UpgradeError", () => {
  test("creates error with default message for unknown_method", () => {
    const error = new UpgradeError("unknown_method");
    expect(error.reason).toBe("unknown_method");
    expect(error.message).toBe(
      "Could not detect installation method. Use --method to specify."
    );
  });

  test("creates error with default message for network_error", () => {
    const error = new UpgradeError("network_error");
    expect(error.reason).toBe("network_error");
    expect(error.message).toBe("Failed to fetch version information.");
  });

  test("creates error with default message for execution_failed", () => {
    const error = new UpgradeError("execution_failed");
    expect(error.reason).toBe("execution_failed");
    expect(error.message).toBe("Upgrade command failed.");
  });

  test("creates error with default message for version_not_found", () => {
    const error = new UpgradeError("version_not_found");
    expect(error.reason).toBe("version_not_found");
    expect(error.message).toBe("The specified version was not found.");
  });

  test("allows custom message", () => {
    const error = new UpgradeError("network_error", "Custom error message");
    expect(error.reason).toBe("network_error");
    expect(error.message).toBe("Custom error message");
  });
});
