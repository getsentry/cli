/**
 * Unit tests for ZIP archive scanning in the DIF scanner.
 *
 * Covers {@link readZipDifEntries} directly (magic/extension detection, the
 * size gate, malformed input) and the end-to-end `prepareDifs` integration
 * (entries found, no nested-archive recursion, `scanZips` toggle). Archives are
 * built in memory with `fflate.zipSync` so no binary fixtures are needed.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  buildDifFilters,
  prepareDifs,
  scanPaths,
} from "../../../src/lib/dif/scan.js";
import { readZipDifEntries } from "../../../src/lib/dif/zip.js";

/** A minimal, valid Breakpad symbol file with a known debug id. */
const BREAKPAD_FIXTURE = [
  "MODULE Linux x86_64 0F13A5DA412AFBF7C8662048F3294F3D0 example",
  "INFO CODE_ID DAA5130F2A41F7FBC8662048F3294F3D439CA7FF",
  "FUNC 1000 10 0 main",
  "1000 10 42 1",
  "PUBLIC 2000 0 some_symbol",
].join("\n");

const BREAKPAD_BYTES = new TextEncoder().encode(BREAKPAD_FIXTURE);

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "df-zip-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** Write a ZIP built from `entries` to `name` under the temp dir, return path. */
async function writeZip(
  name: string,
  entries: Record<string, Uint8Array>
): Promise<string> {
  const path = join(tempDir, name);
  await writeFile(path, zipSync(entries));
  return path;
}

describe("readZipDifEntries", () => {
  test("returns null for a non-.zip extension", async () => {
    const path = join(tempDir, "data.bin");
    await writeFile(path, zipSync({ "example.sym": BREAKPAD_BYTES }));
    expect(await readZipDifEntries(path)).toBeNull();
  });

  test("returns null for a .zip extension without PK magic", async () => {
    const path = join(tempDir, "notzip.zip");
    await writeFile(path, BREAKPAD_BYTES);
    expect(await readZipDifEntries(path)).toBeNull();
  });

  test("returns null for a malformed (truncated) zip", async () => {
    const path = join(tempDir, "broken.zip");
    // Valid local-header magic, then garbage — fflate throws, we skip.
    await writeFile(path, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff]));
    expect(await readZipDifEntries(path)).toBeNull();
  });

  test("extracts entries, dropping directory placeholders", async () => {
    const path = await writeZip("syms.zip", {
      "dir/": new Uint8Array(0),
      "example.sym": BREAKPAD_BYTES,
    });
    const result = await readZipDifEntries(path);
    expect(result).not.toBeNull();
    expect(result?.entries).toHaveLength(1);
    expect(result?.entries[0]?.path).toBe(`${path}/example.sym`);
    expect(result?.oversizedCount).toBe(0);
  });

  test("size-gates oversized entries before decompression and counts them", async () => {
    const path = await writeZip("syms.zip", {
      "example.sym": BREAKPAD_BYTES,
    });
    const result = await readZipDifEntries(path, { maxFileSize: 1 });
    expect(result?.entries).toHaveLength(0);
    expect(result?.oversizedCount).toBe(1);
  });
});

describe("prepareDifs ZIP scanning", () => {
  test("finds a debug file inside a .zip", async () => {
    const path = await writeZip("syms.zip", {
      "example.sym": BREAKPAD_BYTES,
    });
    const files = await scanPaths([path]);
    const { prepared, oversizedCount } = await prepareDifs(
      files,
      buildDifFilters({})
    );
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.path).toBe(`${path}/example.sym`);
    expect(oversizedCount).toBe(0);
  });

  test("does not double-count the .zip container itself", async () => {
    const path = await writeZip("syms.zip", {
      "example.sym": BREAKPAD_BYTES,
    });
    const files = await scanPaths([path]);
    const { prepared } = await prepareDifs(files, buildDifFilters({}));
    // Exactly the one entry — the container is never also parsed as a DIF.
    expect(prepared).toHaveLength(1);
  });

  test("does not recurse into nested .zip archives", async () => {
    const inner = zipSync({ "example.sym": BREAKPAD_BYTES });
    const path = await writeZip("outer.zip", { "inner.zip": inner });
    const files = await scanPaths([path]);
    const { prepared } = await prepareDifs(files, buildDifFilters({}));
    // The inner archive is an opaque, non-object entry — its DIF is not found.
    expect(prepared).toHaveLength(0);
  });

  test("scanZips: false ignores entries inside archives", async () => {
    const path = await writeZip("syms.zip", {
      "example.sym": BREAKPAD_BYTES,
    });
    const files = await scanPaths([path]);
    const { prepared } = await prepareDifs(files, buildDifFilters({}), {
      scanZips: false,
    });
    expect(prepared).toHaveLength(0);
  });

  test("propagates the oversized count from skipped zip entries", async () => {
    const path = await writeZip("syms.zip", {
      "example.sym": BREAKPAD_BYTES,
    });
    const files = await scanPaths([path]);
    const { prepared, oversizedCount } = await prepareDifs(
      files,
      buildDifFilters({}),
      { maxFileSize: 1 }
    );
    expect(prepared).toHaveLength(0);
    expect(oversizedCount).toBe(1);
  });

  test("falls back to normal parsing for a .zip-named non-archive", async () => {
    // A Breakpad file misnamed `.zip` lacks PK magic, so it is parsed directly.
    const path = join(tempDir, "misnamed.zip");
    await writeFile(path, BREAKPAD_FIXTURE);
    const files = await scanPaths([path]);
    const { prepared } = await prepareDifs(files, buildDifFilters({}));
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.path).toBe(path);
  });

  test("applies --type filter to zip entries", async () => {
    const path = await writeZip("syms.zip", {
      "example.sym": BREAKPAD_BYTES,
    });
    const files = await scanPaths([path]);
    // Breakpad entry filtered out by --type elf.
    const elf = await prepareDifs(files, buildDifFilters({ types: ["elf"] }));
    expect(elf.prepared).toHaveLength(0);
    // ...and kept by --type breakpad.
    const bp = await prepareDifs(
      files,
      buildDifFilters({ types: ["breakpad"] })
    );
    expect(bp.prepared).toHaveLength(1);
  });
});
