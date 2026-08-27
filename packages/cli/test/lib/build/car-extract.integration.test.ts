/**
 * End-to-end integration test for the native CoreUI `car-extract` helper.
 *
 * Unlike the unit tests (which mock the decoder), this compiles the Swift
 * helper with `swiftc`, builds a *real* `Assets.car` from an `.xcassets`
 * fixture via `actool`, runs the helper against it, and asserts actual PNGs
 * come out with sane geometry. It is the only check that exercises real pixel
 * decoding via CoreUI.
 *
 * Requires macOS with the Xcode command-line tools (`actool`, `swiftc`), so it
 * is skipped everywhere else. On CI it runs on the `darwin-arm64` build runner
 * (see the PR build matrix in `.github/workflows/ci.yml`).
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildCarExtract } from "../../../script/build-car-extract.js";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Whether the macOS asset-catalog toolchain is available. */
function hasAssetToolchain(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    // actool ships inside Xcode, not on PATH — locate it via xcrun.
    execFileSync("xcrun", ["--find", "actool"], { stdio: "ignore" });
    execFileSync("swiftc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A 10x10 opaque red PNG (generated at authoring time, not decoded here). */
const RED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFElEQVR4nGM4IafxnxjMMKqQvgoB" +
  "IgzNFQJIdHQAAAAASUVORK5CYII=";

/**
 * Build a real `Assets.car` from a synthetic `.xcassets` using `actool`.
 *
 * @returns Path to the compiled `Assets.car`.
 */
function compileAssetCatalog(workDir: string): string {
  const xcassets = join(workDir, "Assets.xcassets");
  const imageset = join(xcassets, "Logo.imageset");
  mkdirSync(imageset, { recursive: true });

  writeFileSync(
    join(xcassets, "Contents.json"),
    JSON.stringify({ info: { author: "xcode", version: 1 } })
  );
  writeFileSync(join(imageset, "logo.png"), Buffer.from(RED_PNG_BASE64, "base64"));
  writeFileSync(
    join(imageset, "Contents.json"),
    JSON.stringify({
      images: [{ idiom: "universal", scale: "1x", filename: "logo.png" }],
      info: { author: "xcode", version: 1 },
    })
  );

  const outDir = join(workDir, "compiled");
  mkdirSync(outDir, { recursive: true });
  execFileSync(
    "xcrun",
    [
      "actool",
      xcassets,
      "--compile",
      outDir,
      "--platform",
      "iphoneos",
      "--minimum-deployment-target",
      "15.0",
      "--output-format",
      "human-readable-text",
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );

  const car = join(outDir, "Assets.car");
  if (!existsSync(car)) {
    throw new Error(`actool did not produce ${car}`);
  }
  return car;
}

const toolchainAvailable = hasAssetToolchain();
const dirs: string[] = [];

describe.skipIf(!toolchainAvailable)("car-extract (native CoreUI)", () => {
  let helper: string | null = null;

  beforeAll(() => {
    // buildCarExtract resolves SOURCE/OUTPUT relative to cwd, so run it from
    // the package root. It returns a package-relative path; resolve it against
    // PKG_ROOT so it's still valid after the cwd is restored.
    const prev = process.cwd();
    process.chdir(PKG_ROOT);
    try {
      const out = buildCarExtract();
      helper = out === null ? null : join(PKG_ROOT, out);
    } finally {
      process.chdir(prev);
    }
  });

  afterAll(() => {
    while (dirs.length > 0) {
      const d = dirs.pop();
      if (d) {
        rmSync(d, { recursive: true, force: true });
      }
    }
  });

  type HelperImage = {
    name: string;
    file: string;
    width: number;
    height: number;
    scale: number;
    bytes: number;
  };

  test("decodes a real Assets.car into PNGs with sane geometry", () => {
    expect(helper).not.toBeNull();

    const workDir = mkdtempSync(join(tmpdir(), "car-extract-it-"));
    dirs.push(workDir);
    const car = compileAssetCatalog(workDir);

    const outDir = join(workDir, "out");
    const stdout = execFileSync(helper ?? "", [car, outDir], {
      encoding: "utf-8",
    });
    const manifest = JSON.parse(stdout) as { images: HelperImage[] };

    // The fixture has one rendition; CoreUI should decode at least that.
    const logo = manifest.images.find((img) => img.name === "Logo");
    expect(logo).toMatchObject({ width: 10, height: 10 });
    expect(logo?.bytes).toBeGreaterThan(0);

    // The manifest points at a real PNG on disk (magic bytes, not a stub).
    const bytes = readFileSync(join(outDir, logo?.file ?? ""));
    expect(Array.from(bytes.subarray(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(readdirSync(outDir).length).toBe(manifest.images.length);
  });
});
