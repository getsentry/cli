/**
 * Upgrade Command Tests
 *
 * Tests the `sentry cli upgrade` command through Stricli's run().
 * Covers resolveTargetVersion branches (check mode, already up-to-date,
 * version validation) and error paths.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "@stricli/core";
import { app } from "../../../src/app.js";
import type { SentryContext } from "../../../src/context.js";
import { CLI_VERSION } from "../../../src/lib/constants.js";

/** Store original fetch for restoration */
let originalFetch: typeof globalThis.fetch;

/** Helper to mock fetch */
function mockFetch(
  fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

/** Create a mock SentryContext for testing */
function createMockContext(
  overrides: Partial<{
    homeDir: string;
    env: Record<string, string | undefined>;
    execPath: string;
  }> = {}
): { context: SentryContext; output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  const env: Record<string, string | undefined> = {
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/bash",
    ...overrides.env,
  };

  const context = {
    process: {
      stdout: {
        write: (s: string) => {
          output.push(s);
          return true;
        },
      },
      stderr: {
        write: (s: string) => {
          errors.push(s);
          return true;
        },
      },
      stdin: process.stdin,
      env,
      cwd: () => "/tmp",
      execPath: overrides.execPath ?? "/usr/local/bin/sentry",
      exit: mock(() => {
        // no-op for tests
      }),
      exitCode: 0,
    },
    homeDir: overrides.homeDir ?? "/tmp/test-home",
    cwd: "/tmp",
    configDir: "/tmp/test-config",
    env,
    stdout: {
      write: (s: string) => {
        output.push(s);
        return true;
      },
    },
    stderr: {
      write: (s: string) => {
        errors.push(s);
        return true;
      },
    },
    stdin: process.stdin,
    setContext: () => {
      // no-op for tests
    },
    setFlags: () => {
      // no-op for tests
    },
  } as unknown as SentryContext;

  return { context, output, errors };
}

/**
 * Mock fetch to simulate GitHub releases API returning a specific version.
 * Handles the latest release endpoint, version-exists check, and npm registry.
 */
function mockGitHubVersion(version: string): void {
  mockFetch(async (url) => {
    const urlStr = String(url);

    // GitHub latest release endpoint — returns JSON with tag_name
    if (urlStr.includes("releases/latest")) {
      return new Response(JSON.stringify({ tag_name: version }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // GitHub tag check (for versionExists)
    if (urlStr.includes("/releases/tags/")) {
      const requested = urlStr.split("/releases/tags/")[1];
      if (requested === version) {
        return new Response(JSON.stringify({ tag_name: version }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    // npm registry fallback
    if (new URL(urlStr).hostname === "registry.npmjs.org") {
      return new Response(JSON.stringify({ version }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  });
}

describe("sentry cli upgrade", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `upgrade-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("--check mode", () => {
    test("shows 'already on the target version' when current equals latest", async () => {
      mockGitHubVersion(CLI_VERSION);

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Installation method: curl");
      expect(combined).toContain(`Current version: ${CLI_VERSION}`);
      expect(combined).toContain(`Latest version: ${CLI_VERSION}`);
      expect(combined).toContain("You are already on the target version");
    });

    test("shows upgrade command hint when newer version available", async () => {
      mockGitHubVersion("99.99.99");

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Latest version: 99.99.99");
      expect(combined).toContain("Run 'sentry cli upgrade' to update.");
    });

    test("shows version-specific upgrade hint when user-specified version", async () => {
      mockGitHubVersion("99.99.99");

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "88.88.88"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Target version: 88.88.88");
      expect(combined).toContain(
        "Run 'sentry cli upgrade 88.88.88' to update."
      );
    });
  });

  describe("already up to date", () => {
    test("reports already up to date when current equals target", async () => {
      mockGitHubVersion(CLI_VERSION);

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(app, ["cli", "upgrade", "--method", "curl"], context);

      const combined = output.join("");
      expect(combined).toContain("Already up to date.");
      expect(combined).not.toContain("Upgrading to");
    });
  });

  describe("version validation", () => {
    test("reports error for non-existent version", async () => {
      // Mock: latest is 99.99.99, but 0.0.1 doesn't exist
      mockFetch(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("releases/latest")) {
          return new Response(JSON.stringify({ tag_name: "v99.99.99" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        // Specific version check returns 404
        return new Response("Not Found", { status: 404 });
      });

      const { context, output, errors } = createMockContext({
        homeDir: testDir,
      });

      await run(app, ["cli", "upgrade", "--method", "curl", "0.0.1"], context);

      // Stricli catches errors and writes to stderr / calls exit
      const allOutput = [...output, ...errors].join("");
      expect(allOutput).toContain("Version 0.0.1 not found");
    });

    test("strips v prefix from user-specified version", async () => {
      mockGitHubVersion(CLI_VERSION);

      const { context, output } = createMockContext({ homeDir: testDir });

      // Pass "v<current>" — should strip prefix and match current
      await run(
        app,
        ["cli", "upgrade", "--method", "curl", `v${CLI_VERSION}`],
        context
      );

      const combined = output.join("");
      // Should match current version (after stripping v prefix) and report up to date
      expect(combined).toContain("Already up to date.");
    });
  });
});
