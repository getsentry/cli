/**
 * Tests for snapshot archive extraction, including Zip-Slip protection.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import { extractZipToDir } from "../../../src/lib/snapshots/archive.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snap-extract-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("extractZipToDir", () => {
  test("extracts files (incl. nested) and skips directory entries", () => {
    const zip = zipSync({
      "a.png": strToU8("A"),
      "sub/b.png": strToU8("B"),
      "emptydir/": new Uint8Array(),
    });
    const out = tempDir();

    const count = extractZipToDir(zip, out);

    expect(count).toBe(2);
    expect(readFileSync(join(out, "a.png"), "utf8")).toBe("A");
    expect(readFileSync(join(out, "sub", "b.png"), "utf8")).toBe("B");
  });

  test("skips entries that would escape the output directory (Zip Slip)", () => {
    const zip = zipSync({
      "../evil.png": strToU8("X"),
      "ok.png": strToU8("Y"),
    });
    const out = tempDir();

    const count = extractZipToDir(zip, out);

    expect(count).toBe(1);
    expect(existsSync(join(out, "ok.png"))).toBe(true);
    // The traversal entry was not written above the output dir.
    expect(existsSync(join(out, "..", "evil.png"))).toBe(false);
  });
});
