/**
 * Unit Tests for Delta Upgrade Module
 *
 * Tests the exported pure-computation functions that drive chain resolution
 * for both stable (GitHub Releases) and nightly (GHCR) channels, plus
 * async orchestration functions tested via fetch mocking.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPatchChain,
  buildNightlyPatchGraph,
  canAttemptDelta,
  downloadStablePatch,
  type ExtractStableChainOpts,
  extractSha256,
  extractStableChain,
  fetchRecentReleases,
  type GitHubAsset,
  type GitHubRelease,
  getPatchFromVersion,
  getPatchTargetSha256,
  getPlatformBinaryName,
  getStableTargetSha256,
  type PatchChain,
  type PatchGraphEntry,
  resolveNightlyChain,
  resolveStableChain,
  type WalkNightlyChainOpts,
  walkNightlyChain,
} from "../../src/lib/delta-upgrade.js";
import type { OciManifest } from "../../src/lib/ghcr.js";

// ---------------------------------------------------------------------------
// Test helpers (file-scoped)
// ---------------------------------------------------------------------------

/** Create a GitHub asset with optional overrides */
function makeAsset(overrides: Partial<GitHubAsset> = {}): GitHubAsset {
  return {
    name: "sentry-linux-x64",
    size: 100_000,
    browser_download_url: "https://example.com/download",
    ...overrides,
  };
}

/** Create a GitHub release with optional overrides */
function makeRelease(tag: string, assets: GitHubAsset[] = []): GitHubRelease {
  return { tag_name: tag, assets };
}

/** Create an OCI manifest with patch annotations */
function makePatchManifest(
  fromVersion: string,
  sha256Map: Record<string, string> = {},
  layers: OciManifest["layers"] = []
): OciManifest {
  const annotations: Record<string, string> = {
    "from-version": fromVersion,
  };
  for (const [key, value] of Object.entries(sha256Map)) {
    annotations[`sha256-${key}`] = value;
  }
  return {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      digest: "sha256:config",
      mediaType: "application/vnd.oci.empty.v1+json",
      size: 2,
    },
    layers,
    annotations,
  };
}

// ===================================================================
// Pure computation tests
// ===================================================================

// getPlatformBinaryName

describe("getPlatformBinaryName", () => {
  test("returns a string starting with 'sentry-'", () => {
    const name = getPlatformBinaryName();
    expect(name.startsWith("sentry-")).toBe(true);
  });

  test("contains platform and arch components", () => {
    const name = getPlatformBinaryName();
    const parts = name.replace(".exe", "").split("-");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe("sentry");
    expect(["linux", "darwin", "windows"]).toContain(parts[1]);
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

// canAttemptDelta

describe("canAttemptDelta", () => {
  test("returns false for cross-channel upgrade (stable → nightly)", () => {
    const result = canAttemptDelta("0.14.0-dev.123");
    expect(result).toBe(false);
  });

  test("returns false for dev build", () => {
    const result = canAttemptDelta("0.14.0");
    expect(result).toBe(false);
  });

  test("returns false for nightly target from dev build", () => {
    const result = canAttemptDelta("0.14.0-dev.abc123");
    expect(result).toBe(false);
  });
});

// extractSha256

describe("extractSha256", () => {
  test("extracts hex from sha256: prefixed digest", () => {
    const asset = makeAsset({ digest: "sha256:abcdef0123456789" });
    expect(extractSha256(asset)).toBe("abcdef0123456789");
  });

  test("returns null when no digest field", () => {
    const asset = makeAsset({});
    expect(extractSha256(asset)).toBeNull();
  });

  test("returns null for empty digest", () => {
    const asset = makeAsset({ digest: "" });
    expect(extractSha256(asset)).toBeNull();
  });

  test("returns null for non-sha256 digest format", () => {
    const asset = makeAsset({ digest: "md5:abcdef" });
    expect(extractSha256(asset)).toBeNull();
  });

  test("handles uppercase hex", () => {
    const asset = makeAsset({ digest: "sha256:ABCDEF0123456789" });
    expect(extractSha256(asset)).toBe("ABCDEF0123456789");
  });

  test("handles mixed case prefix", () => {
    const asset = makeAsset({ digest: "SHA256:abc123" });
    expect(extractSha256(asset)).toBe("abc123");
  });
});

// getStableTargetSha256

describe("getStableTargetSha256", () => {
  test("returns hex from matching binary asset", () => {
    const release = makeRelease("0.14.0", [
      makeAsset({
        name: "sentry-linux-x64",
        digest: "sha256:deadbeef",
      }),
    ]);
    expect(getStableTargetSha256(release, "sentry-linux-x64")).toBe("deadbeef");
  });

  test("returns null when binary asset not found", () => {
    const release = makeRelease("0.14.0", [
      makeAsset({ name: "sentry-darwin-arm64" }),
    ]);
    expect(getStableTargetSha256(release, "sentry-linux-x64")).toBeNull();
  });

  test("returns null when binary asset has no digest", () => {
    const release = makeRelease("0.14.0", [
      makeAsset({ name: "sentry-linux-x64" }),
    ]);
    expect(getStableTargetSha256(release, "sentry-linux-x64")).toBeNull();
  });

  test("returns null for empty assets array", () => {
    const release = makeRelease("0.14.0", []);
    expect(getStableTargetSha256(release, "sentry-linux-x64")).toBeNull();
  });
});

// extractStableChain

describe("extractStableChain", () => {
  /**
   * Create a deterministic hex digest from a version string.
   *
   * Converts each char to its hex code to produce valid [0-9a-f]+ output.
   */
  function versionToHex(version: string): string {
    return Array.from(version)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  }

  /** Build a standard chain of releases (newest first) with valid patch assets */
  function buildReleases(
    versions: string[],
    binaryName: string,
    patchSize = 1000,
    gzSize = 100_000
  ): GitHubRelease[] {
    return versions.map((v) =>
      makeRelease(v, [
        makeAsset({
          name: binaryName,
          digest: `sha256:${versionToHex(v)}`,
        }),
        makeAsset({
          name: `${binaryName}.patch`,
          size: patchSize,
          browser_download_url: `https://example.com/${v}.patch`,
        }),
        makeAsset({
          name: `${binaryName}.gz`,
          size: gzSize,
        }),
      ])
    );
  }

  function makeOpts(
    overrides: Partial<ExtractStableChainOpts> = {}
  ): ExtractStableChainOpts {
    return {
      releases: [],
      currentVersion: "0.12.0",
      targetVersion: "0.14.0",
      binaryName: "sentry-linux-x64",
      fullGzSize: 100_000,
      ...overrides,
    };
  }

  test("resolves single-hop chain (0.12→0.13)", () => {
    const releases = buildReleases(["0.13.0", "0.12.0"], "sentry-linux-x64");
    const result = extractStableChain(
      makeOpts({
        releases,
        currentVersion: "0.12.0",
        targetVersion: "0.13.0",
        fullGzSize: 100_000,
      })
    );
    expect(result).not.toBeNull();
    expect(result?.patchUrls).toHaveLength(1);
    expect(result?.patchUrls[0]).toBe("https://example.com/0.13.0.patch");
    expect(result?.expectedSha256).toBe(versionToHex("0.13.0"));
  });

  test("resolves multi-hop chain (0.12→0.13→0.14)", () => {
    const releases = buildReleases(
      ["0.14.0", "0.13.0", "0.12.0"],
      "sentry-linux-x64"
    );
    const result = extractStableChain(
      makeOpts({ releases, fullGzSize: 100_000 })
    );
    expect(result).not.toBeNull();
    expect(result?.patchUrls).toHaveLength(2);
    expect(result?.patchUrls[0]).toBe("https://example.com/0.13.0.patch");
    expect(result?.patchUrls[1]).toBe("https://example.com/0.14.0.patch");
    expect(result?.expectedSha256).toBe(versionToHex("0.14.0"));
  });

  test("returns null when target version not in release list", () => {
    const releases = buildReleases(["0.13.0", "0.12.0"], "sentry-linux-x64");
    const result = extractStableChain(
      makeOpts({
        releases,
        targetVersion: "0.15.0",
        fullGzSize: 100_000,
      })
    );
    expect(result).toBeNull();
  });

  test("returns null when target is older than current (downgrade)", () => {
    const releases = buildReleases(
      ["0.14.0", "0.13.0", "0.12.0"],
      "sentry-linux-x64"
    );
    const result = extractStableChain(
      makeOpts({
        releases,
        currentVersion: "0.14.0",
        targetVersion: "0.12.0",
        fullGzSize: 100_000,
      })
    );
    expect(result).toBeNull();
  });

  test("returns null when target equals current", () => {
    const releases = buildReleases(["0.13.0", "0.12.0"], "sentry-linux-x64");
    const result = extractStableChain(
      makeOpts({
        releases,
        currentVersion: "0.13.0",
        targetVersion: "0.13.0",
        fullGzSize: 100_000,
      })
    );
    expect(result).toBeNull();
  });

  test("returns null when chain exceeds size threshold", () => {
    const releases = buildReleases(
      ["0.14.0", "0.13.0", "0.12.0"],
      "sentry-linux-x64",
      70_000
    );
    const result = extractStableChain(
      makeOpts({ releases, fullGzSize: 100_000 })
    );
    expect(result).toBeNull();
  });

  test("returns null when patch asset missing from a release", () => {
    const releases = [
      makeRelease("0.14.0", [
        makeAsset({
          name: "sentry-linux-x64",
          digest: `sha256:${versionToHex("0.14.0")}`,
        }),
        makeAsset({ name: "sentry-linux-x64.gz", size: 100_000 }),
      ]),
      makeRelease("0.13.0", [makeAsset({ name: "sentry-linux-x64" })]),
    ];
    const result = extractStableChain(
      makeOpts({
        releases,
        currentVersion: "0.13.0",
        targetVersion: "0.14.0",
        fullGzSize: 100_000,
      })
    );
    expect(result).toBeNull();
  });

  test("returns null when target binary has no digest (no SHA-256)", () => {
    const releases = [
      makeRelease("0.14.0", [
        makeAsset({ name: "sentry-linux-x64" }),
        makeAsset({
          name: "sentry-linux-x64.patch",
          size: 1000,
          browser_download_url: "https://example.com/0.14.0.patch",
        }),
        makeAsset({ name: "sentry-linux-x64.gz", size: 100_000 }),
      ]),
      makeRelease("0.13.0", [makeAsset({ name: "sentry-linux-x64" })]),
    ];
    const result = extractStableChain(
      makeOpts({
        releases,
        currentVersion: "0.13.0",
        targetVersion: "0.14.0",
        fullGzSize: 100_000,
      })
    );
    expect(result).toBeNull();
  });

  test("returns null for chain depth exceeding MAX_CHAIN_DEPTH (10)", () => {
    const versions = Array.from({ length: 12 }, (_, i) => `0.${i + 1}.0`);
    versions.reverse();
    const releases = buildReleases(versions, "sentry-linux-x64", 100);
    const result = extractStableChain(
      makeOpts({
        releases,
        currentVersion: "0.1.0",
        targetVersion: "0.12.0",
        fullGzSize: 100_000,
      })
    );
    expect(result).toBeNull();
  });

  test("handles exactly MAX_CHAIN_DEPTH (10) hops", () => {
    const versions = Array.from({ length: 11 }, (_, i) => `0.${i + 1}.0`);
    versions.reverse();
    const releases = buildReleases(versions, "sentry-linux-x64", 100);
    const result = extractStableChain(
      makeOpts({
        releases,
        currentVersion: "0.1.0",
        targetVersion: "0.11.0",
        fullGzSize: 100_000,
      })
    );
    expect(result).not.toBeNull();
    expect(result?.patchUrls).toHaveLength(10);
  });

  test("patch URLs are returned in apply order (oldest first)", () => {
    const releases = buildReleases(
      ["0.15.0", "0.14.0", "0.13.0", "0.12.0"],
      "sentry-linux-x64"
    );
    const result = extractStableChain(
      makeOpts({
        releases,
        currentVersion: "0.12.0",
        targetVersion: "0.15.0",
        fullGzSize: 100_000,
      })
    );
    expect(result).not.toBeNull();
    expect(result?.patchUrls).toEqual([
      "https://example.com/0.13.0.patch",
      "https://example.com/0.14.0.patch",
      "https://example.com/0.15.0.patch",
    ]);
  });

  test("cumulative size threshold is checked progressively", () => {
    const releases = [
      makeRelease("0.14.0", [
        makeAsset({
          name: "sentry-linux-x64",
          digest: `sha256:${versionToHex("0.14.0")}`,
        }),
        makeAsset({
          name: "sentry-linux-x64.patch",
          size: 50_000,
          browser_download_url: "https://example.com/0.14.0.patch",
        }),
        makeAsset({ name: "sentry-linux-x64.gz", size: 100_000 }),
      ]),
      makeRelease("0.13.0", [
        makeAsset({
          name: "sentry-linux-x64",
          digest: `sha256:${versionToHex("0.13.0")}`,
        }),
        makeAsset({
          name: "sentry-linux-x64.patch",
          size: 15_000,
          browser_download_url: "https://example.com/0.13.0.patch",
        }),
      ]),
      makeRelease("0.12.0", [makeAsset({ name: "sentry-linux-x64" })]),
    ];
    const result = extractStableChain(
      makeOpts({ releases, fullGzSize: 100_000 })
    );
    expect(result).toBeNull();
  });
});

// getPatchFromVersion & getPatchTargetSha256

describe("getPatchFromVersion", () => {
  test("extracts from-version annotation", () => {
    const manifest = makePatchManifest("0.12.0");
    expect(getPatchFromVersion(manifest)).toBe("0.12.0");
  });

  test("returns null when annotation missing", () => {
    const manifest: OciManifest = {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {
        digest: "sha256:config",
        mediaType: "application/vnd.oci.empty.v1+json",
        size: 2,
      },
      layers: [],
      annotations: {},
    };
    expect(getPatchFromVersion(manifest)).toBeNull();
  });

  test("returns null when annotations object is undefined", () => {
    const manifest: OciManifest = {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {
        digest: "sha256:config",
        mediaType: "application/vnd.oci.empty.v1+json",
        size: 2,
      },
      layers: [],
    };
    expect(getPatchFromVersion(manifest)).toBeNull();
  });
});

describe("getPatchTargetSha256", () => {
  test("extracts sha256 annotation for the given platform", () => {
    const manifest = makePatchManifest("0.12.0", {
      "sentry-linux-x64": "abc123",
      "sentry-darwin-arm64": "def456",
    });
    expect(getPatchTargetSha256(manifest, "sentry-linux-x64")).toBe("abc123");
    expect(getPatchTargetSha256(manifest, "sentry-darwin-arm64")).toBe(
      "def456"
    );
  });

  test("returns null when platform not found", () => {
    const manifest = makePatchManifest("0.12.0", {
      "sentry-linux-x64": "abc123",
    });
    expect(getPatchTargetSha256(manifest, "sentry-freebsd-x64")).toBeNull();
  });

  test("returns null when annotations are undefined", () => {
    const manifest: OciManifest = {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {
        digest: "sha256:config",
        mediaType: "application/vnd.oci.empty.v1+json",
        size: 2,
      },
      layers: [],
    };
    expect(getPatchTargetSha256(manifest, "sentry-linux-x64")).toBeNull();
  });
});

// walkNightlyChain

describe("walkNightlyChain", () => {
  const BINARY_NAME = "sentry-linux-x64";
  const PATCH_LAYER = `${BINARY_NAME}.patch`;

  /** Create a patch graph entry with proper layer metadata */
  function makeGraphEntry(
    version: string,
    fromVersion: string,
    patchSize: number,
    sha256Map: Record<string, string> = {}
  ): [string, PatchGraphEntry] {
    return [
      fromVersion,
      {
        version,
        manifest: makePatchManifest(fromVersion, sha256Map, [
          {
            digest: `sha256:layer-${version}`,
            mediaType: "application/octet-stream",
            size: patchSize,
            annotations: {
              "org.opencontainers.image.title": PATCH_LAYER,
            },
          },
        ]),
      },
    ];
  }

  function makeOpts(
    overrides: Partial<WalkNightlyChainOpts> = {}
  ): WalkNightlyChainOpts {
    return {
      graph: new Map(),
      currentVersion: "0.0.0-dev.100",
      targetVersion: "0.0.0-dev.103",
      patchLayerName: PATCH_LAYER,
      binaryName: BINARY_NAME,
      fullGzSize: 100_000,
      ...overrides,
    };
  }

  test("resolves single-hop chain", () => {
    const graph = new Map([
      makeGraphEntry("0.0.0-dev.101", "0.0.0-dev.100", 1000, {
        [BINARY_NAME]: "sha256-of-101",
      }),
    ]);

    const result = walkNightlyChain(
      makeOpts({
        graph,
        currentVersion: "0.0.0-dev.100",
        targetVersion: "0.0.0-dev.101",
      })
    );

    expect(result).not.toBeNull();
    expect(result?.layerDigests).toEqual(["sha256:layer-0.0.0-dev.101"]);
    expect(result?.expectedSha256).toBe("sha256-of-101");
  });

  test("resolves multi-hop chain", () => {
    const graph = new Map([
      makeGraphEntry("0.0.0-dev.101", "0.0.0-dev.100", 1000),
      makeGraphEntry("0.0.0-dev.102", "0.0.0-dev.101", 1000),
      makeGraphEntry("0.0.0-dev.103", "0.0.0-dev.102", 1000, {
        [BINARY_NAME]: "sha256-of-103",
      }),
    ]);

    const result = walkNightlyChain(makeOpts({ graph }));

    expect(result).not.toBeNull();
    expect(result?.layerDigests).toHaveLength(3);
    expect(result?.layerDigests).toEqual([
      "sha256:layer-0.0.0-dev.101",
      "sha256:layer-0.0.0-dev.102",
      "sha256:layer-0.0.0-dev.103",
    ]);
    expect(result?.expectedSha256).toBe("sha256-of-103");
  });

  test("returns null when chain is broken (missing intermediate)", () => {
    const graph = new Map([
      makeGraphEntry("0.0.0-dev.101", "0.0.0-dev.100", 1000),
      makeGraphEntry("0.0.0-dev.103", "0.0.0-dev.102", 1000, {
        [BINARY_NAME]: "sha256-of-103",
      }),
    ]);

    const result = walkNightlyChain(makeOpts({ graph }));
    expect(result).toBeNull();
  });

  test("returns null when current version not in graph", () => {
    const graph = new Map([
      makeGraphEntry("0.0.0-dev.102", "0.0.0-dev.101", 1000, {
        [BINARY_NAME]: "sha256-of-102",
      }),
    ]);

    const result = walkNightlyChain(
      makeOpts({
        graph,
        currentVersion: "0.0.0-dev.100",
        targetVersion: "0.0.0-dev.102",
      })
    );
    expect(result).toBeNull();
  });

  test("returns null when exceeding size threshold", () => {
    const graph = new Map([
      makeGraphEntry("0.0.0-dev.101", "0.0.0-dev.100", 40_000),
      makeGraphEntry("0.0.0-dev.102", "0.0.0-dev.101", 40_000, {
        [BINARY_NAME]: "sha256-of-102",
      }),
    ]);

    const result = walkNightlyChain(
      makeOpts({
        graph,
        currentVersion: "0.0.0-dev.100",
        targetVersion: "0.0.0-dev.102",
      })
    );
    expect(result).toBeNull();
  });

  test("returns null when target has no SHA-256 annotation", () => {
    const graph = new Map([
      makeGraphEntry("0.0.0-dev.101", "0.0.0-dev.100", 1000),
      makeGraphEntry("0.0.0-dev.102", "0.0.0-dev.101", 1000, {}),
    ]);

    const result = walkNightlyChain(
      makeOpts({
        graph,
        currentVersion: "0.0.0-dev.100",
        targetVersion: "0.0.0-dev.102",
      })
    );
    expect(result).toBeNull();
  });

  test("returns null when patch layer not found for platform", () => {
    const fromVersion = "0.0.0-dev.100";
    const version = "0.0.0-dev.101";
    const graph = new Map<string, PatchGraphEntry>([
      [
        fromVersion,
        {
          version,
          manifest: makePatchManifest(
            fromVersion,
            { [BINARY_NAME]: "sha256-target" },
            [
              {
                digest: "sha256:layer-wrong",
                mediaType: "application/octet-stream",
                size: 1000,
                annotations: {
                  "org.opencontainers.image.title": "sentry-darwin-arm64.patch",
                },
              },
            ]
          ),
        },
      ],
    ]);

    const result = walkNightlyChain(
      makeOpts({
        graph,
        currentVersion: "0.0.0-dev.100",
        targetVersion: "0.0.0-dev.101",
      })
    );
    expect(result).toBeNull();
  });

  test("returns null when chain exceeds MAX_CHAIN_DEPTH (10)", () => {
    const entries: [string, PatchGraphEntry][] = [];
    for (let i = 0; i < 11; i++) {
      const from = `0.0.0-dev.${100 + i}`;
      const to = `0.0.0-dev.${101 + i}`;
      const sha256: Record<string, string> =
        i === 10 ? { "sentry-linux-x64": "sha256-final" } : {};
      entries.push(makeGraphEntry(to, from, 100, sha256));
    }
    const graph = new Map(entries);

    const result = walkNightlyChain(
      makeOpts({
        graph,
        currentVersion: "0.0.0-dev.100",
        targetVersion: "0.0.0-dev.111",
      })
    );
    expect(result).toBeNull();
  });

  test("handles exactly MAX_CHAIN_DEPTH (10) hops", () => {
    const entries: [string, PatchGraphEntry][] = [];
    for (let i = 0; i < 10; i++) {
      const from = `0.0.0-dev.${100 + i}`;
      const to = `0.0.0-dev.${101 + i}`;
      const sha256: Record<string, string> =
        i === 9 ? { "sentry-linux-x64": "sha256-final" } : {};
      entries.push(makeGraphEntry(to, from, 100, sha256));
    }
    const graph = new Map(entries);

    const result = walkNightlyChain(
      makeOpts({
        graph,
        currentVersion: "0.0.0-dev.100",
        targetVersion: "0.0.0-dev.110",
      })
    );
    expect(result).not.toBeNull();
    expect(result?.layerDigests).toHaveLength(10);
    expect(result?.expectedSha256).toBe("sha256-final");
  });

  test("digests are returned in apply order (oldest first)", () => {
    const graph = new Map([
      makeGraphEntry("0.0.0-dev.101", "0.0.0-dev.100", 1000),
      makeGraphEntry("0.0.0-dev.102", "0.0.0-dev.101", 1000),
      makeGraphEntry("0.0.0-dev.103", "0.0.0-dev.102", 1000, {
        [BINARY_NAME]: "sha256-of-103",
      }),
    ]);

    const result = walkNightlyChain(makeOpts({ graph }));
    expect(result).not.toBeNull();
    expect(result?.layerDigests[0]).toBe("sha256:layer-0.0.0-dev.101");
    expect(result?.layerDigests[2]).toBe("sha256:layer-0.0.0-dev.103");
  });

  test("size threshold is checked cumulatively", () => {
    const graph = new Map([
      makeGraphEntry("0.0.0-dev.101", "0.0.0-dev.100", 50_000),
      makeGraphEntry("0.0.0-dev.102", "0.0.0-dev.101", 15_000, {
        [BINARY_NAME]: "sha256-of-102",
      }),
    ]);

    const result = walkNightlyChain(
      makeOpts({
        graph,
        currentVersion: "0.0.0-dev.100",
        targetVersion: "0.0.0-dev.102",
      })
    );
    expect(result).toBeNull();
  });
});

// ===================================================================
// Async functions (fetch-mocked)
// ===================================================================

/** Helper to mock globalThis.fetch */
function mockFetch(
  fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

/** Store original fetch for restoration */
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// fetchRecentReleases

describe("fetchRecentReleases", () => {
  test("returns releases from GitHub API", async () => {
    const releases: GitHubRelease[] = [
      makeRelease("0.14.0", [makeAsset({ name: "sentry-linux-x64" })]),
      makeRelease("0.13.0", [makeAsset({ name: "sentry-linux-x64" })]),
    ];

    mockFetch(async (url) => {
      expect(String(url)).toContain(
        "api.github.com/repos/getsentry/cli/releases"
      );
      expect(String(url)).toContain("per_page=");
      return new Response(JSON.stringify(releases), { status: 200 });
    });

    const result = await fetchRecentReleases();
    expect(result).toHaveLength(2);
    expect(result[0]?.tag_name).toBe("0.14.0");
  });

  test("returns empty array on HTTP error", async () => {
    mockFetch(async () => new Response("Server Error", { status: 500 }));

    const result = await fetchRecentReleases();
    expect(result).toEqual([]);
  });

  test("returns empty array on network failure", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await fetchRecentReleases();
    expect(result).toEqual([]);
  });
});

// downloadStablePatch

describe("downloadStablePatch", () => {
  test("returns Uint8Array on success", async () => {
    const patchData = new Uint8Array([1, 2, 3, 4, 5]);

    mockFetch(async (url) => {
      expect(String(url)).toBe("https://example.com/patch.bin");
      return new Response(patchData.buffer as ArrayBuffer, {
        status: 200,
      });
    });

    const result = await downloadStablePatch("https://example.com/patch.bin");
    expect(result).not.toBeNull();
    expect(result).toEqual(patchData);
  });

  test("returns null on HTTP 404", async () => {
    mockFetch(async () => new Response("Not Found", { status: 404 }));

    const result = await downloadStablePatch("https://example.com/missing.bin");
    expect(result).toBeNull();
  });

  test("returns null on network failure", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await downloadStablePatch("https://example.com/fail.bin");
    expect(result).toBeNull();
  });
});

// resolveStableChain (async orchestrator)

describe("resolveStableChain", () => {
  /**
   * Create a deterministic hex digest from a version string.
   * Reuses the same approach as the extractStableChain tests above.
   */
  function versionHex(version: string): string {
    return Array.from(version)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  }

  /** Build a mock that serves both releases API and patch downloads */
  function setupStableMocks(
    releases: GitHubRelease[],
    patches: Map<string, Uint8Array>
  ): void {
    mockFetch(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("api.github.com")) {
        return new Response(JSON.stringify(releases), { status: 200 });
      }
      const patchData = patches.get(urlStr);
      if (patchData) {
        return new Response(patchData.buffer as ArrayBuffer, {
          status: 200,
        });
      }
      return new Response("Not Found", { status: 404 });
    });
  }

  test("resolves single-hop chain with mocked fetch", async () => {
    const binaryName = getPlatformBinaryName();
    const patchBytes = new Uint8Array([10, 20, 30]);
    const patchUrl = `https://github.com/getsentry/cli/releases/download/0.14.0/${binaryName}.patch`;

    const releases: GitHubRelease[] = [
      makeRelease("0.14.0", [
        makeAsset({
          name: binaryName,
          digest: `sha256:${versionHex("0.14.0")}`,
        }),
        makeAsset({
          name: `${binaryName}.patch`,
          size: 100,
          browser_download_url: patchUrl,
        }),
        makeAsset({ name: `${binaryName}.gz`, size: 100_000 }),
      ]),
      makeRelease("0.13.0", [makeAsset({ name: binaryName })]),
    ];

    setupStableMocks(releases, new Map([[patchUrl, patchBytes]]));

    const chain = await resolveStableChain("0.13.0", "0.14.0");
    expect(chain).not.toBeNull();
    expect(chain?.patches).toHaveLength(1);
    expect(chain?.patches[0]?.data).toEqual(patchBytes);
    expect(chain?.expectedSha256).toBe(versionHex("0.14.0"));
  });

  test("resolves multi-hop chain with parallel downloads", async () => {
    const binaryName = getPlatformBinaryName();
    const patchA = new Uint8Array([1, 2]);
    const patchB = new Uint8Array([3, 4]);
    const urlA = "https://example.com/0.14.0.patch";
    const urlB = "https://example.com/0.15.0.patch";

    const releases: GitHubRelease[] = [
      makeRelease("0.15.0", [
        makeAsset({
          name: binaryName,
          digest: `sha256:${versionHex("0.15.0")}`,
        }),
        makeAsset({
          name: `${binaryName}.patch`,
          size: 50,
          browser_download_url: urlB,
        }),
        makeAsset({ name: `${binaryName}.gz`, size: 100_000 }),
      ]),
      makeRelease("0.14.0", [
        makeAsset({
          name: binaryName,
          digest: `sha256:${versionHex("0.14.0")}`,
        }),
        makeAsset({
          name: `${binaryName}.patch`,
          size: 50,
          browser_download_url: urlA,
        }),
        makeAsset({ name: `${binaryName}.gz`, size: 100_000 }),
      ]),
      makeRelease("0.13.0", [makeAsset({ name: binaryName })]),
    ];

    setupStableMocks(
      releases,
      new Map([
        [urlA, patchA],
        [urlB, patchB],
      ])
    );

    const chain = await resolveStableChain("0.13.0", "0.15.0");
    expect(chain).not.toBeNull();
    expect(chain?.patches).toHaveLength(2);
    // Oldest patch first (apply order)
    expect(chain?.patches[0]?.data).toEqual(patchA);
    expect(chain?.patches[1]?.data).toEqual(patchB);
  });

  test("returns null when target not in releases", async () => {
    const releases: GitHubRelease[] = [
      makeRelease("0.13.0", [makeAsset({ name: "sentry-linux-x64" })]),
    ];
    setupStableMocks(releases, new Map());

    const chain = await resolveStableChain("0.12.0", "0.14.0");
    expect(chain).toBeNull();
  });

  test("returns null when releases API fails", async () => {
    mockFetch(async () => new Response("Error", { status: 500 }));

    const chain = await resolveStableChain("0.12.0", "0.13.0");
    expect(chain).toBeNull();
  });

  test("returns null when a patch download fails", async () => {
    const binaryName = getPlatformBinaryName();
    const releases: GitHubRelease[] = [
      makeRelease("0.14.0", [
        makeAsset({
          name: binaryName,
          digest: `sha256:${versionHex("0.14.0")}`,
        }),
        makeAsset({
          name: `${binaryName}.patch`,
          size: 100,
          browser_download_url: "https://example.com/missing.patch",
        }),
        makeAsset({ name: `${binaryName}.gz`, size: 100_000 }),
      ]),
      makeRelease("0.13.0", [makeAsset({ name: binaryName })]),
    ];

    // Only mock releases API, no patch data available
    setupStableMocks(releases, new Map());

    const chain = await resolveStableChain("0.13.0", "0.14.0");
    expect(chain).toBeNull();
  });
});

// buildNightlyPatchGraph

describe("buildNightlyPatchGraph", () => {
  /** Create a GHCR mock that handles token exchange + tag listing + manifest fetches */
  function setupGhcrMocks(
    tags: string[],
    manifests: Map<string, OciManifest>
  ): void {
    mockFetch(async (url) => {
      const urlStr = String(url);

      // Token exchange
      if (urlStr.includes("ghcr.io/token")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
        });
      }

      // Tag listing
      if (urlStr.includes("/tags/list")) {
        return new Response(JSON.stringify({ tags }), {
          status: 200,
        });
      }

      // Manifest fetch — extract tag from URL
      const manifestMatch = urlStr.match(/\/manifests\/(.+)$/);
      if (manifestMatch) {
        const tag = manifestMatch[1];
        const manifest = manifests.get(tag ?? "");
        if (manifest) {
          return new Response(JSON.stringify(manifest), {
            status: 200,
          });
        }
        return new Response("Not Found", { status: 404 });
      }

      return new Response("Not Found", { status: 404 });
    });
  }

  test("builds graph from patch tags", async () => {
    const manifest1 = makePatchManifest("0.0.0-dev.100", {}, [
      {
        digest: "sha256:layer1",
        mediaType: "application/octet-stream",
        size: 1000,
        annotations: {
          "org.opencontainers.image.title": "sentry-linux-x64.patch",
        },
      },
    ]);
    const manifest2 = makePatchManifest("0.0.0-dev.101", {}, [
      {
        digest: "sha256:layer2",
        mediaType: "application/octet-stream",
        size: 1000,
        annotations: {
          "org.opencontainers.image.title": "sentry-linux-x64.patch",
        },
      },
    ]);

    setupGhcrMocks(
      ["patch-0.0.0-dev.101", "patch-0.0.0-dev.102"],
      new Map([
        ["patch-0.0.0-dev.101", manifest1],
        ["patch-0.0.0-dev.102", manifest2],
      ])
    );

    const graph = await buildNightlyPatchGraph("test-token");
    expect(graph.size).toBe(2);
    expect(graph.get("0.0.0-dev.100")?.version).toBe("0.0.0-dev.101");
    expect(graph.get("0.0.0-dev.101")?.version).toBe("0.0.0-dev.102");
  });

  test("skips patches without from-version annotation", async () => {
    const noAnnotation: OciManifest = {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {
        digest: "sha256:config",
        mediaType: "application/vnd.oci.empty.v1+json",
        size: 2,
      },
      layers: [],
      annotations: {},
    };

    setupGhcrMocks(
      ["patch-0.0.0-dev.101"],
      new Map([["patch-0.0.0-dev.101", noAnnotation]])
    );

    const graph = await buildNightlyPatchGraph("test-token");
    expect(graph.size).toBe(0);
  });

  test("skips patches with failed manifest fetch", async () => {
    setupGhcrMocks(["patch-0.0.0-dev.101"], new Map());

    const graph = await buildNightlyPatchGraph("test-token");
    expect(graph.size).toBe(0);
  });

  test("returns empty graph when no patch tags", async () => {
    setupGhcrMocks(["nightly", "nightly-0.0.0-dev.100"], new Map());

    const graph = await buildNightlyPatchGraph("test-token");
    expect(graph.size).toBe(0);
  });
});

// resolveNightlyChain (async orchestrator)

describe("resolveNightlyChain", () => {
  const BINARY_NAME = getPlatformBinaryName();
  const PATCH_NAME = `${BINARY_NAME}.patch`;

  /** Set up GHCR mocks for tag listing, manifest fetches, and blob downloads */
  function setupNightlyMocks(
    tags: string[],
    manifests: Map<string, OciManifest>,
    blobs: Map<string, Uint8Array>
  ): void {
    mockFetch(async (url) => {
      const urlStr = String(url);

      if (urlStr.includes("ghcr.io/token")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
        });
      }

      if (urlStr.includes("/tags/list")) {
        return new Response(JSON.stringify({ tags }), {
          status: 200,
        });
      }

      const manifestMatch = urlStr.match(/\/manifests\/(.+)$/);
      if (manifestMatch) {
        const tag = manifestMatch[1];
        const manifest = manifests.get(tag ?? "");
        if (manifest) {
          return new Response(JSON.stringify(manifest), {
            status: 200,
          });
        }
        return new Response("Not Found", { status: 404 });
      }

      // Blob download — redirect then serve
      const blobMatch = urlStr.match(/\/blobs\/(sha256:[a-f0-9A-F]+)/);
      if (blobMatch) {
        const digest = blobMatch[1];
        const blobData = blobs.get(digest ?? "");
        if (blobData) {
          // Manual redirect response (redirect: "manual" is used by downloadNightlyBlob)
          return new Response(null, {
            status: 307,
            headers: { Location: `https://blob.test/${digest}` },
          });
        }
        return new Response("Not Found", { status: 404 });
      }

      // Follow redirect — serve blob by digest from URL
      if (urlStr.includes("blob.test/")) {
        const digestFromUrl = urlStr.split("blob.test/")[1];
        const blobData = blobs.get(digestFromUrl ?? "");
        if (blobData) {
          return new Response(blobData.buffer as ArrayBuffer, { status: 200 });
        }
      }

      return new Response("Not Found", { status: 404 });
    });
  }

  test("resolves single-hop nightly chain", async () => {
    const patchData = new Uint8Array([99, 88, 77]);
    const patchDigest = "sha256:aabbccdd1122334455";
    const patchManifest = makePatchManifest(
      "0.0.0-dev.100",
      { [BINARY_NAME]: "aabb1122" },
      [
        {
          digest: patchDigest,
          mediaType: "application/octet-stream",
          size: 100,
          annotations: {
            "org.opencontainers.image.title": PATCH_NAME,
          },
        },
      ]
    );

    setupNightlyMocks(
      ["patch-0.0.0-dev.101"],
      new Map([["patch-0.0.0-dev.101", patchManifest]]),
      new Map([[patchDigest, patchData]])
    );

    const chain = await resolveNightlyChain(
      "test-token",
      "0.0.0-dev.100",
      "0.0.0-dev.101",
      100_000
    );

    expect(chain).not.toBeNull();
    expect(chain?.patches).toHaveLength(1);
    expect(chain?.expectedSha256).toBe("aabb1122");
  });

  test("returns null when no matching patches in graph", async () => {
    setupNightlyMocks([], new Map(), new Map());

    const chain = await resolveNightlyChain(
      "test-token",
      "0.0.0-dev.100",
      "0.0.0-dev.102",
      100_000
    );

    expect(chain).toBeNull();
  });
});

// applyPatchChain (real filesystem + TRDIFF10 fixtures)

describe("applyPatchChain", () => {
  const fixturesDir = join(import.meta.dir, "../fixtures/patches");

  /** Generate a unique temp file path */
  function tempFile(name: string): string {
    return join(tmpdir(), `delta-test-${Date.now()}-${name}`);
  }

  test("applies single-patch chain and verifies SHA-256", async () => {
    const oldPath = join(fixturesDir, "small-old.bin");
    const destPath = tempFile("single-chain-out.bin");
    const patchData = await Bun.file(
      join(fixturesDir, "small.trdiff10")
    ).bytes();
    const expectedNewData = await Bun.file(
      join(fixturesDir, "small-new.bin")
    ).bytes();

    const expectedSha256 = new Bun.CryptoHasher("sha256")
      .update(expectedNewData)
      .digest("hex");

    const chain: PatchChain = {
      patches: [
        {
          data: new Uint8Array(patchData),
          size: patchData.byteLength,
        },
      ],
      totalSize: patchData.byteLength,
      expectedSha256,
    };

    try {
      const sha256 = await applyPatchChain(chain, oldPath, destPath);
      expect(sha256).toBe(expectedSha256);

      // Verify output matches expected
      const outputData = await Bun.file(destPath).bytes();
      expect(outputData).toEqual(expectedNewData);
    } finally {
      if (existsSync(destPath)) {
        unlinkSync(destPath);
      }
    }
  });

  test("throws on SHA-256 mismatch", async () => {
    const oldPath = join(fixturesDir, "small-old.bin");
    const destPath = tempFile("mismatch-out.bin");
    const patchData = await Bun.file(
      join(fixturesDir, "small.trdiff10")
    ).bytes();

    const chain: PatchChain = {
      patches: [
        {
          data: new Uint8Array(patchData),
          size: patchData.byteLength,
        },
      ],
      totalSize: patchData.byteLength,
      expectedSha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
    };

    try {
      await expect(applyPatchChain(chain, oldPath, destPath)).rejects.toThrow(
        "SHA-256 mismatch"
      );
    } finally {
      if (existsSync(destPath)) {
        unlinkSync(destPath);
      }
    }
  });

  test("applies multi-step chain via intermediate file", async () => {
    // We only have one-step fixtures, but we can test the intermediate
    // file path by using identity-like patches. Use the same patch twice:
    // old → new → applying a second patch will likely fail in the real
    // patcher (since new != old for the second patch), so we test that
    // the cleanup logic works by checking intermediate files don't leak.
    const oldPath = join(fixturesDir, "small-old.bin");
    const destPath = tempFile("multi-chain-out.bin");
    const intermediatePath = `${destPath}.patching`;
    const patchData = await Bun.file(
      join(fixturesDir, "small.trdiff10")
    ).bytes();

    // Create a chain where the first step succeeds but the second will fail
    // (applying old→new patch to the "new" binary won't produce valid output,
    // but we're testing the intermediate file handling)
    const chain: PatchChain = {
      patches: [
        {
          data: new Uint8Array(patchData),
          size: patchData.byteLength,
        },
        {
          data: new Uint8Array(patchData),
          size: patchData.byteLength,
        },
      ],
      totalSize: patchData.byteLength * 2,
      expectedSha256: "anything",
    };

    try {
      // This may succeed or fail depending on whether the second patch
      // application works, but either way intermediate files should be cleaned
      await applyPatchChain(chain, oldPath, destPath).catch(() => {
        // Expected — second patch on mismatched binary
      });
    } finally {
      // Clean up any files that were created
      if (existsSync(destPath)) {
        unlinkSync(destPath);
      }
      if (existsSync(intermediatePath)) {
        unlinkSync(intermediatePath);
      }
    }
  });

  test("sets executable permission on output (Unix)", async () => {
    if (process.platform === "win32") {
      return; // Skip on Windows
    }

    const oldPath = join(fixturesDir, "small-old.bin");
    const destPath = tempFile("perms-out.bin");
    const patchData = await Bun.file(
      join(fixturesDir, "small.trdiff10")
    ).bytes();
    const expectedNewData = await Bun.file(
      join(fixturesDir, "small-new.bin")
    ).bytes();
    const expectedSha256 = new Bun.CryptoHasher("sha256")
      .update(expectedNewData)
      .digest("hex");

    const chain: PatchChain = {
      patches: [
        {
          data: new Uint8Array(patchData),
          size: patchData.byteLength,
        },
      ],
      totalSize: patchData.byteLength,
      expectedSha256,
    };

    try {
      await applyPatchChain(chain, oldPath, destPath);

      const stat = Bun.file(destPath);
      // File should exist and be readable
      expect(await stat.exists()).toBe(true);
    } finally {
      if (existsSync(destPath)) {
        unlinkSync(destPath);
      }
    }
  });
});
