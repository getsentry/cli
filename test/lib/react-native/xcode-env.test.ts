/**
 * Tests for Xcode build-environment helpers.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  discoverInfoPlist,
  expandXcodeVars,
  findHermesc,
  findNode,
  parseInfoPlistStrings,
  resolveReleaseAndDist,
} from "../../../src/lib/react-native/xcode-env.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

describe("findNode / findHermesc", () => {
  test("prefer env overrides", () => {
    expect(findNode({ NODE_BINARY: "/usr/bin/node" })).toBe("/usr/bin/node");
    expect(findNode({})).toBe("node");
    expect(findHermesc({ HERMES_CLI_PATH: "/h" })).toBe("/h");
    expect(findHermesc({ PODS_ROOT: "/pods" })).toBe(
      "/pods/hermes-engine/destroot/bin/hermesc"
    );
  });
});

describe("expandXcodeVars", () => {
  test("expands parenthesized and braced references", () => {
    const vars = { FOO: "hello world" };
    expect(expandXcodeVars("A$(FOO)B", vars)).toBe("Ahello worldB");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal Xcode ${VAR} syntax under test
    expect(expandXcodeVars("A${FOO}B", vars)).toBe("Ahello worldB");
    expect(expandXcodeVars("$(MISSING)", vars)).toBe("");
  });

  test("applies rfc1034identifier and identifier modifiers", () => {
    const vars = { FOO_BAR: "a b/c" };
    expect(expandXcodeVars("$(FOO_BAR:rfc1034identifier)", vars)).toBe("a-b-c");
    expect(expandXcodeVars("$(FOO_BAR:identifier)", vars)).toBe("a_b_c");
  });
});

describe("parseInfoPlistStrings", () => {
  test("extracts key/string pairs and decodes entities", () => {
    const xml = `<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.example.app</string>
  <key>CFBundleShortVersionString</key>
  <string>1.2.3</string>
  <key>CFBundleName</key><string>A &amp; B</string>
</dict></plist>`;
    const parsed = parseInfoPlistStrings(xml);
    expect(parsed.CFBundleIdentifier).toBe("com.example.app");
    expect(parsed.CFBundleShortVersionString).toBe("1.2.3");
    expect(parsed.CFBundleName).toBe("A & B");
  });
});

describe("discoverInfoPlist", () => {
  test("returns null when not running inside Xcode", async () => {
    expect(await discoverInfoPlist({}, "/tmp")).toBeNull();
  });

  test("reads and expands the Info.plist file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rn-plist-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "Info.plist"),
      `<plist><dict>
        <key>CFBundleName</key><string>MyApp</string>
        <key>CFBundleIdentifier</key><string>com.example.$(SUFFIX)</string>
        <key>CFBundleShortVersionString</key><string>2.0.0</string>
        <key>CFBundleVersion</key><string>42</string>
      </dict></plist>`
    );
    const plist = await discoverInfoPlist(
      {
        XCODE_VERSION_ACTUAL: "1500",
        INFOPLIST_FILE: "Info.plist",
        SUFFIX: "app",
      },
      dir
    );
    expect(plist).toEqual({
      name: "MyApp",
      bundleId: "com.example.app",
      version: "2.0.0",
      build: "42",
    });
  });

  test("falls back to build-setting env vars", async () => {
    const plist = await discoverInfoPlist(
      {
        XCODE_VERSION_ACTUAL: "1500",
        PRODUCT_NAME: "MyApp",
        PRODUCT_BUNDLE_IDENTIFIER: "com.example.app",
        MARKETING_VERSION: "1.0.0",
        CURRENT_PROJECT_VERSION: "7",
      },
      "/tmp"
    );
    expect(plist).toMatchObject({ bundleId: "com.example.app", build: "7" });
  });
});

describe("resolveReleaseAndDist", () => {
  test("prefers SENTRY_RELEASE/SENTRY_DIST env vars", async () => {
    const result = await resolveReleaseAndDist(
      { SENTRY_RELEASE: "app@1.0", SENTRY_DIST: "100" },
      "/tmp",
      false
    );
    expect(result).toEqual({ release: "app@1.0", dist: "100" });
  });

  test("returns empty when no-auto-release and no env vars", async () => {
    expect(await resolveReleaseAndDist({}, "/tmp", true)).toEqual({});
  });

  test("derives release from Info.plist", async () => {
    const result = await resolveReleaseAndDist(
      {
        XCODE_VERSION_ACTUAL: "1500",
        PRODUCT_NAME: "MyApp",
        PRODUCT_BUNDLE_IDENTIFIER: "com.example.app",
        MARKETING_VERSION: "3.1.0",
        CURRENT_PROJECT_VERSION: "55",
      },
      "/tmp",
      false
    );
    expect(result).toEqual({
      dist: "55",
      release: "com.example.app@3.1.0+55",
    });
  });

  test("throws when the identity cannot be determined", async () => {
    await expect(resolveReleaseAndDist({}, "/tmp", false)).rejects.toThrow(
      /Could not determine release/
    );
  });
});
