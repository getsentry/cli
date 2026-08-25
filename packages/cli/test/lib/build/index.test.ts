/**
 * Tests for mobile build detection + normalization.
 *
 * Fixtures are built in-memory with fflate (no committed binaries): a "fake
 * APK/AAB" is just a ZIP carrying the marker entry names the detector keys on.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import {
  collectDsymEntries,
  detectBuildFormat,
  extractIpaAppName,
  normalizeBuildDirectory,
  normalizeBuildFile,
  normalizeIpa,
  parsePluginFromPipeline,
  validateXcarchiveDirectory,
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

  // Symlinks require privileges on Windows; the unit suite runs on Linux.
  test.skipIf(process.platform === "win32")(
    "preserves symlinks as entries (stores the target path, not followed content)",
    async () => {
      const base = mkdtempSync(join(tmpdir(), "xc-sym-"));
      dirs.push(base);
      const xc = join(base, "App.xcarchive");
      mkdirSync(xc, { recursive: true });
      writeFileSync(join(xc, "real.txt"), "REAL");
      symlinkSync("real.txt", join(xc, "link.txt"));

      const entries = unzipSync(await normalizeBuildDirectory(xc, null));
      // The symlink entry stores its target path — proof it was NOT followed
      // (following would store "REAL", the target's file content).
      expect(new TextDecoder().decode(entries["App.xcarchive/link.txt"])).toBe(
        "real.txt"
      );
      expect(new TextDecoder().decode(entries["App.xcarchive/real.txt"])).toBe(
        "REAL"
      );
    }
  );
});

describe("validateXcarchiveDirectory", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop();
      if (d) {
        rmSync(d, { recursive: true, force: true });
      }
    }
  });

  function makeArchive(build: (xc: string) => void): string {
    const base = mkdtempSync(join(tmpdir(), "xc-val-"));
    dirs.push(base);
    const xc = join(base, "MyApp.xcarchive");
    mkdirSync(xc, { recursive: true });
    build(xc);
    return xc;
  }

  test("accepts a valid XCArchive", () => {
    const xc = makeArchive((dir) => {
      const app = join(dir, "Products", "Applications", "MyApp.app");
      mkdirSync(app, { recursive: true });
      writeFileSync(join(dir, "Info.plist"), "<plist/>");
      writeFileSync(join(app, "Info.plist"), "<app/>");
    });
    expect(() => validateXcarchiveDirectory(xc)).not.toThrow();
  });

  test("rejects a directory missing the root Info.plist", () => {
    const xc = makeArchive((dir) => {
      mkdirSync(join(dir, "Products"), { recursive: true });
    });
    expect(() => validateXcarchiveDirectory(xc)).toThrow("Info.plist");
  });

  test("rejects a directory missing Products/", () => {
    const xc = makeArchive((dir) => {
      writeFileSync(join(dir, "Info.plist"), "<plist/>");
    });
    expect(() => validateXcarchiveDirectory(xc)).toThrow("Products/");
  });

  test("rejects when a .app bundle has no Info.plist", () => {
    const xc = makeArchive((dir) => {
      writeFileSync(join(dir, "Info.plist"), "<plist/>");
      mkdirSync(join(dir, "Products", "Applications", "MyApp.app"), {
        recursive: true,
      });
    });
    expect(() => validateXcarchiveDirectory(xc)).toThrow(".app bundle");
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

  test("remaps nested framework entries under the app", () => {
    const ipa = zipSync({
      "Payload/MyApp.app/Info.plist": strToU8("<app/>"),
      "Payload/MyApp.app/Frameworks/X.framework/X": strToU8("fw"),
    });
    const entries = unzipSync(normalizeIpa(ipa, null));
    expect(
      entries[
        "archive.xcarchive/Products/Applications/MyApp.app/Frameworks/X.framework/X"
      ]
    ).toEqual(strToU8("fw"));
  });

  test("includes only the identified app's entries", () => {
    const ipa = zipSync({
      "Payload/MyApp.app/Info.plist": strToU8("<app/>"),
      "Payload/MyApp.app/MyApp": strToU8("bin"),
      // A stray second .app (no Info.plist so extractIpaAppName still sees one)
      // must not be bundled.
      "Payload/Stray.app/junk": strToU8("junk"),
    });
    const names = Object.keys(unzipSync(normalizeIpa(ipa, null)));
    expect(names.some((n) => n.includes("Stray"))).toBe(false);
    expect(
      names.includes(
        "archive.xcarchive/Products/Applications/MyApp.app/MyApp"
      )
    ).toBe(true);
  });

  test("skips path-traversal entries", () => {
    const ipa = zipSync({
      "Payload/MyApp.app/Info.plist": strToU8("<app/>"),
      "Payload/MyApp.app/../../evil": strToU8("x"),
    });
    const names = Object.keys(unzipSync(normalizeIpa(ipa, null)));
    expect(names.some((n) => n.includes("evil"))).toBe(false);
  });

  test("is deterministic (identical IPA → identical bytes)", () => {
    const ipa = fakeIpaBytes();
    expect(normalizeIpa(ipa, null).equals(normalizeIpa(ipa, null))).toBe(true);
  });

  test("throws when the IPA has no single .app", () => {
    expect(() => normalizeIpa(zipSync({ "readme.txt": strToU8("x") }), null)).toThrow(
      "exactly one"
    );
  });

  test("embeds dSYM entries under the archive's dSYMs/ directory", () => {
    const entries = unzipSync(
      normalizeIpa(fakeIpaBytes(), null, [
        {
          relPath: "MyApp.app.dSYM/Contents/Resources/DWARF/MyApp",
          content: strToU8("dwarf"),
        },
      ])
    );
    expect(
      entries["archive.xcarchive/dSYMs/MyApp.app.dSYM/Contents/Resources/DWARF/MyApp"]
    ).toEqual(strToU8("dwarf"));
  });
});

describe("collectDsymEntries", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  function makeTmp(): string {
    tmp = mkdtempSync(join(tmpdir(), "dsym-test-"));
    return tmp;
  }

  /** Write a minimal `.dSYM` bundle with a single symbols file. */
  function writeDsym(root: string, name: string, contents: string): string {
    const bundle = join(root, name);
    mkdirSync(join(bundle, "Contents", "Resources", "DWARF"), {
      recursive: true,
    });
    writeFileSync(
      join(bundle, "Contents", "Resources", "DWARF", "sym"),
      contents
    );
    return bundle;
  }

  test("accepts a direct .dSYM bundle and a directory of bundles", async () => {
    const root = makeTmp();
    const direct = writeDsym(root, "DemoApp.app.dSYM", "app symbols");
    const symbolsDir = join(root, "Symbols");
    writeDsym(symbolsDir, "DemoFramework.framework.dSYM", "framework symbols");
    writeFileSync(join(symbolsDir, "README.txt"), "ignored");

    const entries = await collectDsymEntries([direct, symbolsDir]);
    const byPath = new Map(
      entries.map((e) => [e.relPath, new TextDecoder().decode(e.content)])
    );
    expect(
      byPath.get("DemoApp.app.dSYM/Contents/Resources/DWARF/sym")
    ).toBe("app symbols");
    expect(
      byPath.get("DemoFramework.framework.dSYM/Contents/Resources/DWARF/sym")
    ).toBe("framework symbols");
    expect([...byPath.keys()].some((k) => k.includes("README"))).toBe(false);
  });

  test("accepts a bare ZIP and a ZIP wrapping a single directory", async () => {
    const root = makeTmp();
    const bareZip = join(root, "bundle.zip");
    writeFileSync(
      bareZip,
      zipSync({
        "DemoApp.app.dSYM/Contents/Resources/DWARF/sym": strToU8("app"),
      })
    );
    const wrappedZip = join(root, "wrapped.zip");
    writeFileSync(
      wrappedZip,
      zipSync({
        "dSYMs/DemoFramework.framework.dSYM/Contents/Resources/DWARF/sym":
          strToU8("fw"),
      })
    );

    const entries = await collectDsymEntries([bareZip, wrappedZip]);
    const byPath = new Map(
      entries.map((e) => [e.relPath, new TextDecoder().decode(e.content)])
    );
    expect(
      byPath.get("DemoApp.app.dSYM/Contents/Resources/DWARF/sym")
    ).toBe("app");
    expect(
      byPath.get("DemoFramework.framework.dSYM/Contents/Resources/DWARF/sym")
    ).toBe("fw");
  });

  test("ignores macOS metadata inside a ZIP", async () => {
    const root = makeTmp();
    const zip = join(root, "symbols.zip");
    writeFileSync(
      zip,
      zipSync({
        "dSYMs/DemoApp.app.dSYM/Contents/Resources/DWARF/sym": strToU8("sym"),
        "__MACOSX/dSYMs/DemoApp.app.dSYM/._sym": strToU8("meta"),
      })
    );

    const entries = await collectDsymEntries([zip]);
    expect(entries.every((e) => !e.relPath.includes("__MACOSX"))).toBe(true);
    expect(entries.some((e) => e.relPath.includes("._sym"))).toBe(false);
  });

  test("throws when a path does not exist", async () => {
    const root = makeTmp();
    await expect(
      collectDsymEntries([join(root, "missing.dSYM")])
    ).rejects.toThrow("does not exist");
  });

  test("throws when a directory contains no bundles", async () => {
    const root = makeTmp();
    const empty = join(root, "empty");
    mkdirSync(empty);
    writeFileSync(join(empty, "note.txt"), "x");
    await expect(collectDsymEntries([empty])).rejects.toThrow(
      "No .dSYM bundles found"
    );
  });

  test("rejects two inputs contributing the same bundle name", async () => {
    const root = makeTmp();
    const a = join(root, "a");
    const b = join(root, "b");
    writeDsym(a, "DemoApp.app.dSYM", "one");
    writeDsym(b, "DemoApp.app.dSYM", "two");
    await expect(
      collectDsymEntries([join(a, "DemoApp.app.dSYM"), join(b, "DemoApp.app.dSYM")])
    ).rejects.toThrow("multiple dSYM bundles named");
  });

  test("rejects a symlinked dSYM path", async () => {
    const root = makeTmp();
    const real = writeDsym(root, "Real.app.dSYM", "sym");
    const link = join(root, "Link.app.dSYM");
    symlinkSync(real, link);
    await expect(collectDsymEntries([link])).rejects.toThrow(
      "cannot be symlinks"
    );
  });
});
