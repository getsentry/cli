/**
 * Upgrade Command Tests
 *
 * Tests the `sentry cli upgrade` command through Stricli's run().
 * Covers resolveTargetVersion branches (check mode, already up-to-date,
 * version validation) and error paths.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "@stricli/core";
import { app } from "../../../src/app.js";
import type { SentryContext } from "../../../src/context.js";
import { CLI_VERSION } from "../../../src/lib/constants.js";
import {
  getReleaseChannel,
  setReleaseChannel,
} from "../../../src/lib/db/release-channel.js";
import { useTestConfigDir } from "../../helpers.js";

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
 * Mock fetch to simulate GHCR manifest returning a specific nightly version.
 * Handles token exchange and manifest fetch.
 */
function mockGhcrNightlyVersion(version: string): void {
  mockFetch(async (url) => {
    const urlStr = String(url);

    // GHCR anonymous token exchange
    if (urlStr.includes("ghcr.io/token")) {
      return new Response(JSON.stringify({ token: "test-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // GHCR OCI manifest for :nightly tag
    if (urlStr.includes("/manifests/nightly")) {
      return new Response(
        JSON.stringify({
          schemaVersion: 2,
          layers: [],
          annotations: { version },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/vnd.oci.image.manifest.v1+json",
          },
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  });
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

    // GitHub tag check (for versionExists) — this repo uses un-prefixed tags
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

/**
 * Mock fetch for the nightly version.json endpoint.
 */
/**
 * Mock fetch for GHCR nightly version checks (token exchange + manifest).
 * Used by nightly channel tests — replaces the old GitHub version.json mock.
 */
function mockNightlyVersion(version: string): void {
  mockFetch(async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("ghcr.io/token")) {
      return new Response(JSON.stringify({ token: "test-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlStr.includes("/manifests/nightly")) {
      return new Response(JSON.stringify({ annotations: { version } }), {
        status: 200,
        headers: {
          "content-type": "application/vnd.oci.image.manifest.v1+json",
        },
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

  describe("brew method", () => {
    test("errors immediately when specific version requested with brew", async () => {
      // No fetch mock needed — error is thrown before any network call
      const { context, output, errors } = createMockContext({
        homeDir: testDir,
      });

      await run(app, ["cli", "upgrade", "--method", "brew", "1.2.3"], context);

      const allOutput = [...output, ...errors].join("");
      expect(allOutput).toContain(
        "Homebrew does not support installing a specific version"
      );
    });

    test("check mode works for brew method", async () => {
      mockGitHubVersion("99.99.99");

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "brew"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Installation method: brew");
      expect(combined).toContain("Latest version: 99.99.99");
      expect(combined).toContain("Run 'sentry cli upgrade' to update.");
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

  describe("nightly version check", () => {
    test("--check mode with 'nightly' positional fetches latest from GHCR", async () => {
      const nightlyVersion = "0.0.0-dev.1740000000";
      // 'nightly' as positional switches channel to nightly — fetches from GHCR
      mockGhcrNightlyVersion(nightlyVersion);

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = output.join("");
      // Should show nightly channel and latest version from GHCR
      expect(combined).toContain("nightly");
      expect(combined).toContain(nightlyVersion);
    });

    test("--check with 'nightly' positional shows upgrade hint when newer nightly available", async () => {
      const nightlyVersion = "0.0.0-dev.1740000000";
      mockGhcrNightlyVersion(nightlyVersion);

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = output.join("");
      // CLI_VERSION is "0.0.0-dev" (not matching nightlyVersion), show upgrade hint
      expect(combined).toContain("sentry cli upgrade");
    });
  });
});

describe("sentry cli upgrade — nightly channel", () => {
  useTestConfigDir("test-upgrade-nightly-");

  let testDir: string;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `upgrade-nightly-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("resolveChannelAndVersion", () => {
    test("'nightly' positional sets channel to nightly", async () => {
      mockNightlyVersion(CLI_VERSION);

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Channel: nightly");
    });

    test("'stable' positional sets channel to stable", async () => {
      mockGitHubVersion(CLI_VERSION);
      setReleaseChannel("nightly");

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "stable"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Channel: stable");
    });

    test("without positional, uses persisted channel", async () => {
      setReleaseChannel("nightly");
      mockNightlyVersion(CLI_VERSION);

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Channel: nightly");
    });
  });

  describe("channel persistence", () => {
    test("persists nightly channel when 'nightly' positional is passed", async () => {
      mockNightlyVersion(CLI_VERSION);

      const { context } = createMockContext({ homeDir: testDir });

      expect(getReleaseChannel()).toBe("stable");

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      expect(getReleaseChannel()).toBe("nightly");
    });

    test("persists stable channel when 'stable' positional resets from nightly", async () => {
      setReleaseChannel("nightly");
      mockGitHubVersion(CLI_VERSION);

      const { context } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "stable"],
        context
      );

      expect(getReleaseChannel()).toBe("stable");
    });
  });

  describe("nightly --check mode", () => {
    test("shows 'already on target' when current matches nightly latest", async () => {
      mockNightlyVersion(CLI_VERSION);

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Channel: nightly");
      expect(combined).toContain(`Latest version: ${CLI_VERSION}`);
      expect(combined).toContain("You are already on the target version");
    });

    test("shows upgrade hint when newer nightly available", async () => {
      mockNightlyVersion("0.99.0-dev.9999999999");

      const { context, output } = createMockContext({ homeDir: testDir });

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = output.join("");
      expect(combined).toContain("Channel: nightly");
      expect(combined).toContain("Latest version: 0.99.0-dev.9999999999");
      expect(combined).toContain("Run 'sentry cli upgrade' to update.");
    });
  });
});

// ---------------------------------------------------------------------------
// Download + setup paths (Option B: Bun.spawn spy)
//
// These tests cover runSetupOnNewBinary and the full executeUpgrade flow by:
//   1. Mocking fetch to return a fake binary payload for downloadBinaryToTemp
//   2. Replacing Bun.spawn with a spy that resolves immediately with exit 0
//
// Bun.spawn is writable on the global Bun object, so it can be temporarily
// replaced without mock.module.
// ---------------------------------------------------------------------------

describe("sentry cli upgrade — curl full upgrade path (Bun.spawn spy)", () => {
  useTestConfigDir("test-upgrade-spawn-");

  let testDir: string;
  let originalSpawn: typeof Bun.spawn;
  let spawnedArgs: string[][];

  /** Default install paths (default curl dir) */
  const defaultBinDir = join(homedir(), ".sentry", "bin");

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `upgrade-spawn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    mkdirSync(defaultBinDir, { recursive: true });

    originalFetch = globalThis.fetch;
    originalSpawn = Bun.spawn;
    spawnedArgs = [];

    // Replace Bun.spawn with a spy that immediately resolves with exit 0
    Bun.spawn = ((cmd: string[], _opts: unknown) => {
      spawnedArgs.push(cmd);
      return { exited: Promise.resolve(0) };
    }) as typeof Bun.spawn;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    Bun.spawn = originalSpawn;
    rmSync(testDir, { recursive: true, force: true });

    // Clean up any temp binary files written to the default curl install path
    const binName = process.platform === "win32" ? "sentry.exe" : "sentry";
    for (const suffix of ["", ".download", ".old", ".lock"]) {
      try {
        await unlink(join(defaultBinDir, `${binName}${suffix}`));
      } catch {
        // Ignore
      }
    }
  });

  /**
   * Mock fetch to serve both the GitHub latest-release version endpoint and a
   * minimal valid gzipped binary for downloadBinaryToTemp.
   */
  function mockBinaryDownloadWithVersion(version: string): void {
    const fakeContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // ELF magic
    const gzipped = Bun.gzipSync(fakeContent);
    mockFetch(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("releases/latest")) {
        return new Response(JSON.stringify({ tag_name: version }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Binary download (.gz or raw)
      return new Response(gzipped, { status: 200 });
    });
  }

  test("runs setup on downloaded binary after curl upgrade", async () => {
    mockBinaryDownloadWithVersion("99.99.99");

    const { context, output } = createMockContext({ homeDir: testDir });

    await run(app, ["cli", "upgrade", "--method", "curl"], context);

    const combined = output.join("");
    expect(combined).toContain("Upgrading to 99.99.99...");
    expect(combined).toContain("Successfully upgraded to 99.99.99.");

    // Verify Bun.spawn was called with the downloaded binary + setup args
    expect(spawnedArgs.length).toBeGreaterThan(0);
    const setupCall = spawnedArgs.find((args) => args.includes("setup"));
    expect(setupCall).toBeDefined();
    expect(setupCall).toContain("cli");
    expect(setupCall).toContain("setup");
    expect(setupCall).toContain("--method");
    expect(setupCall).toContain("curl");
    expect(setupCall).toContain("--install");
  });

  test("reports setup failure when Bun.spawn exits non-zero", async () => {
    // Use a unified mock that handles both the version endpoint and binary download
    const fakeContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    const gzipped = Bun.gzipSync(fakeContent);
    mockFetch(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "99.99.99" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Binary download (both .gz and raw URLs)
      return new Response(gzipped, { status: 200 });
    });

    Bun.spawn = ((_cmd: string[], _opts: unknown) => ({
      exited: Promise.resolve(1),
    })) as typeof Bun.spawn;

    const { context, errors } = createMockContext({ homeDir: testDir });

    await run(app, ["cli", "upgrade", "--method", "curl"], context);

    expect(errors.join("")).toContain("Setup failed with exit code 1");
  });

  test("downloads nightly binary from GHCR for nightly channel", async () => {
    const capturedUrls: string[] = [];
    const fakeContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    const gzipped = Bun.gzipSync(fakeContent);

    // GHCR flow: token exchange → manifest → blob redirect → blob download
    mockFetch(async (url) => {
      const urlStr = String(url);
      capturedUrls.push(urlStr);
      if (urlStr.includes("ghcr.io/token")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (urlStr.includes("/manifests/nightly")) {
        let filename = "sentry-linux-x64.gz";
        if (process.platform === "win32") {
          filename = "sentry-windows-x64.exe.gz";
        } else if (process.platform === "darwin") {
          filename = "sentry-darwin-arm64.gz";
        }
        return new Response(
          JSON.stringify({
            annotations: { version: "0.99.0-dev.1234567890" },
            layers: [
              {
                digest: "sha256:abc123",
                annotations: {
                  "org.opencontainers.image.title": filename,
                },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/vnd.oci.image.manifest.v1+json",
            },
          }
        );
      }
      if (urlStr.includes("/blobs/sha256:abc123")) {
        // Redirect to blob storage (GHCR blob endpoint returns 307)
        return Response.redirect("https://blob.example.com/file.gz", 307);
      }
      if (urlStr.includes("blob.example.com")) {
        return new Response(gzipped, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });

    // "nightly" positional switches channel to nightly
    const { context } = createMockContext({ homeDir: testDir });

    await run(app, ["cli", "upgrade", "--method", "curl", "nightly"], context);

    // Should have fetched from GHCR (token + manifest + blob)
    expect(capturedUrls.some((u) => u.includes("ghcr.io/token"))).toBe(true);
    expect(capturedUrls.some((u) => u.includes("/manifests/nightly"))).toBe(
      true
    );
  });

  test("--force bypasses 'already up to date' and proceeds to download", async () => {
    mockBinaryDownloadWithVersion(CLI_VERSION); // Same version — would normally short-circuit

    const { context, output } = createMockContext({ homeDir: testDir });

    await run(app, ["cli", "upgrade", "--method", "curl", "--force"], context);

    const combined = output.join("");
    // With --force, should NOT show "Already up to date"
    expect(combined).not.toContain("Already up to date.");
    // Should proceed to upgrade and succeed
    expect(combined).toContain(`Upgrading to ${CLI_VERSION}...`);
    expect(combined).toContain(`Successfully upgraded to ${CLI_VERSION}.`);
  });
});

describe("sentry cli upgrade — migrateToStandaloneForNightly (Bun.spawn spy)", () => {
  useTestConfigDir("test-upgrade-migrate-");

  let testDir: string;
  let originalSpawn: typeof Bun.spawn;

  const defaultBinDir = join(homedir(), ".sentry", "bin");

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `upgrade-migrate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    mkdirSync(defaultBinDir, { recursive: true });

    originalFetch = globalThis.fetch;
    originalSpawn = Bun.spawn;

    Bun.spawn = ((_cmd: string[], _opts: unknown) => ({
      exited: Promise.resolve(0),
    })) as typeof Bun.spawn;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    Bun.spawn = originalSpawn;
    rmSync(testDir, { recursive: true, force: true });

    const binName = process.platform === "win32" ? "sentry.exe" : "sentry";
    for (const suffix of ["", ".download", ".old", ".lock"]) {
      try {
        await unlink(join(defaultBinDir, `${binName}${suffix}`));
      } catch {
        // Ignore
      }
    }
  });

  test("migrates npm install to standalone binary for nightly channel", async () => {
    const fakeContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    const gzipped = Bun.gzipSync(fakeContent);

    // Nightly is now distributed via GHCR (token → manifest → blob)
    mockFetch(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("ghcr.io/token")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (urlStr.includes("/manifests/nightly")) {
        let filename = "sentry-linux-x64.gz";
        if (process.platform === "win32") {
          filename = "sentry-windows-x64.exe.gz";
        } else if (process.platform === "darwin") {
          filename = "sentry-darwin-arm64.gz";
        }
        return new Response(
          JSON.stringify({
            annotations: { version: "0.99.0-dev.1234567890" },
            layers: [
              {
                digest: "sha256:abc456",
                annotations: {
                  "org.opencontainers.image.title": filename,
                },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/vnd.oci.image.manifest.v1+json",
            },
          }
        );
      }
      if (urlStr.includes("/blobs/sha256:abc456")) {
        return Response.redirect("https://blob.example.com/nightly.gz", 307);
      }
      if (urlStr.includes("blob.example.com")) {
        return new Response(gzipped, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });

    // Switch to nightly and use npm method → triggers migration
    setReleaseChannel("nightly");

    const { context, output } = createMockContext({ homeDir: testDir });

    await run(app, ["cli", "upgrade", "--method", "npm", "nightly"], context);

    const combined = output.join("");
    expect(combined).toContain(
      "Nightly builds are only available as standalone binaries."
    );
    expect(combined).toContain("Migrating to standalone installation...");
    expect(combined).toContain("Successfully installed nightly");
    // Warns about old npm install
    expect(combined).toContain(
      "npm-installed sentry may still appear earlier in PATH"
    );
    expect(combined).toContain("npm uninstall -g sentry");
  });
});
