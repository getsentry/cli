/**
 * Unit Tests for Delta Upgrade Module
 *
 * Tests the exported pure-computation functions that drive chain resolution
 * for both stable (GitHub Releases) and nightly (GHCR) channels. All tests
 * operate on in-memory data structures — no network access required.
 */

import { describe, expect, test } from "bun:test";
import {
  canAttemptDelta,
  type ExtractStableChainOpts,
  extractSha256,
  extractStableChain,
  type GitHubAsset,
  type GitHubRelease,
  getPatchFromVersion,
  getPatchTargetSha256,
  getPlatformBinaryName,
  getStableTargetSha256,
  type PatchGraphEntry,
  type WalkNightlyChainOpts,
  walkNightlyChain,
} from "../../src/lib/delta-upgrade.js";
import type { OciManifest } from "../../src/lib/ghcr.js";

// Test helpers

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
      makeOpts({ releases, targetVersion: "0.15.0", fullGzSize: 100_000 })
    );
    expect(result).toBeNull();
  });

  test("returns null when current version not in release list", () => {
    const releases = buildReleases(["0.14.0", "0.13.0"], "sentry-linux-x64");
    const result = extractStableChain(
      makeOpts({ releases, currentVersion: "0.11.0", fullGzSize: 100_000 })
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
