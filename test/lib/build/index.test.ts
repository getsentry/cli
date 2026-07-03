/**
 * Tests for mobile build detection + normalization.
 *
 * Fixtures are built in-memory with fflate (no committed binaries): a "fake
 * APK/AAB" is just a ZIP carrying the marker entry names the detector keys on.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import {
  detectBuildFormat,
  extractIpaAppName,
  normalizeBuildDirectory,
  normalizeBuildFile,
  normalizeIpa,
  parsePluginFromPipeline,
} from "../../../src/lib/build/index.js";

function fakeApk(): Uint8Array {
  return zipSync({ "AndroidManifest.xml": strToU8("binary-xml") });
}

function fakeAab(): Uint8Array {
  return zipSync({
    "BundleConfig.pb": strToU8("cfg"),
    "base/manifest/AndroidManifest.xml": strToU8("xml"),
  });
}

function fakeIpa(): Uint8Array {
  return zipSync({ "Payload/MyApp.app/Info.plist": strToU8("plist") });
}

describe("detectBuildFormat", () => {
  test("detects an APK by its root AndroidManifest.xml", () => {
    expect(detectBuildFormat(fakeApk())).toBe("apk");
  });

  test("detects an AAB by BundleConfig.pb + base manifest", () => {
    expect(detectBuildFormat(fakeAab())).toBe("aab");
  });

  test("detects an IPA by its Payload/*.app/Info.plist", () => {
    expect(detectBuildFormat(fakeIpa())).toBe("ipa");
  });

  test("returns null for a ZIP without build markers", () => {
    expect(detectBuildFormat(zipSync({ "readme.txt": strToU8("hi") }))).toBe(
      null
    );
  });

  test("returns null for non-ZIP bytes", () => {
    expect(detectBuildFormat(strToU8("not a zip"))).toBe(null);
  });
});

describe("parsePluginFromPipeline", () => {
  test("parses the gradle plugin", () => {
    expect(parsePluginFromPipeline("sentry-gradle-plugin/4.12.0")).toEqual({
      name: "sentry-gradle-plugin",
      version: "4.12.0",
    });
  });

  test("parses the fastlane plugin", () => {
    expect(parsePluginFromPipeline("sentry-fastlane-plugin/1.2.3")).toEqual({
      name: "sentry-fastlane-plugin",
      version: "1.2.3",
    });
  });

  test("ignores unrecognized plugins", () => {
    expect(parsePluginFromPipeline("some-other-tool/9.9.9")).toBe(null);
  });

  test("returns null for malformed or empty input", () => {
    expect(parsePluginFromPipeline(undefined)).toBe(null);
    expect(parsePluginFromPipeline("")).toBe(null);
    expect(parsePluginFromPipeline("no-slash")).toBe(null);
    expect(parsePluginFromPipeline("sentry-gradle-plugin/")).toBe(null);
  });
});

describe("normalizeBuildFile", () => {
  test("wraps the build under its basename plus a metadata file", () => {
    const apk = fakeApk();
    const zip = normalizeBuildFile("/some/dir/app-release.apk", apk, null);

    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual([
      ".sentry-cli-metadata.txt",
      "app-release.apk",
    ]);
    // The build bytes are stored verbatim.
    expect(entries["app-release.apk"]).toEqual(apk);
    const metadata = new TextDecoder().decode(entries[".sentry-cli-metadata.txt"]);
    expect(metadata).toContain("sentry-cli-version:");
  });

  test("records a recognized plugin in the metadata file", () => {
    const zip = normalizeBuildFile("/x/app.aab", fakeAab(), {
      name: "sentry-gradle-plugin",
      version: "4.12.0",
    });
    const metadata = new TextDecoder().decode(
      unzipSync(zip)[".sentry-cli-metadata.txt"]
    );
    expect(metadata).toContain("sentry-gradle-plugin: 4.12.0");
  });

  test("is deterministic (identical input → identical bytes)", () => {
    const apk = fakeApk();
    const a = normalizeBuildFile("/x/app.apk", apk, null);
    const b = normalizeBuildFile("/x/app.apk", apk, null);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("normalizeBuildDirectory", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop();
      if (d) {
        rmSync(d, { recursive: true, force: true });
      }
    }
  });

  function fakeXcarchive(): string {
    const base = mkdtempSync(join(tmpdir(), "xc-"));
    dirs.push(base);
    const xc = join(base, "MyApp.xcarchive");
    mkdirSync(join(xc, "Products", "Applications", "MyApp.app"), {
      recursive: true,
    });
    writeFileSync(join(xc, "Info.plist"), "<plist/>");
    writeFileSync(
      join(xc, "Products", "Applications", "MyApp.app", "MyApp"),
      "binary"
    );
    return xc;
  }

  test("zips files under the directory basename plus a root metadata file", async () => {
    const zip = await normalizeBuildDirectory(fakeXcarchive(), null);
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual([
      ".sentry-cli-metadata.txt",
      "MyApp.xcarchive/Info.plist",
      "MyApp.xcarchive/Products/Applications/MyApp.app/MyApp",
    ]);
    expect(entries["MyApp.xcarchive/Info.plist"]).toEqual(strToU8("<plist/>"));
  });

  test("is deterministic (identical tree → identical bytes)", async () => {
    const xc = fakeXcarchive();
    const a = await normalizeBuildDirectory(xc, null);
    const b = await normalizeBuildDirectory(xc, null);
    expect(a.equals(b)).toBe(true);
  });
});

describe("extractIpaAppName", () => {
  test("returns the single app name", () => {
    expect(
      extractIpaAppName([
        "Payload/MyApp.app/Info.plist",
        "Payload/MyApp.app/MyApp",
      ])
    ).toBe("MyApp");
  });

  test("throws when there is no .app", () => {
    expect(() => extractIpaAppName(["readme.txt"])).toThrow("exactly one");
  });

  test("throws when there are multiple .apps", () => {
    expect(() =>
      extractIpaAppName([
        "Payload/A.app/Info.plist",
        "Payload/B.app/Info.plist",
      ])
    ).toThrow("exactly one");
  });
});

describe("normalizeIpa", () => {
  function fakeIpaBytes(): Uint8Array {
    return zipSync({
      "Payload/MyApp.app/Info.plist": strToU8("<app/>"),
      "Payload/MyApp.app/MyApp": strToU8("binary"),
      "Payload/MyApp.app/Assets.car": strToU8("carbytes"),
    });
  }

  test("remaps Payload into an XCArchive layout with a generated Info.plist", () => {
    const zip = normalizeIpa(fakeIpaBytes(), null);
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual([
      ".sentry-cli-metadata.txt",
      "archive.xcarchive/Info.plist",
      "archive.xcarchive/Products/Applications/MyApp.app/Assets.car",
      "archive.xcarchive/Products/Applications/MyApp.app/Info.plist",
      "archive.xcarchive/Products/Applications/MyApp.app/MyApp",
    ]);
    const plist = new TextDecoder().decode(
      entries["archive.xcarchive/Info.plist"]
    );
    expect(plist).toContain("<string>Applications/MyApp.app</string>");
    // Assets.car is carried through verbatim (not parsed).
    expect(
      entries["archive.xcarchive/Products/Applications/MyApp.app/Assets.car"]
    ).toEqual(strToU8("carbytes"));
  });

  test("throws when the IPA has no single .app", () => {
    expect(() => normalizeIpa(zipSync({ "readme.txt": strToU8("x") }), null)).toThrow(
      "exactly one"
    );
  });
});
