/**
 * Tests for the streaming ZIP builder.
 *
 * Property-based tests verify round-trip integrity (compress → decompress).
 * Unit tests verify the ZIP structure is valid and extractable.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asyncProperty,
  assert as fcAssert,
  string,
  uint8Array,
} from "fast-check";
import { ZipWriter } from "../../../src/lib/sourcemap/zip.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "zip-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("ZipWriter", () => {
  test("produces a valid ZIP file extractable by unzip", async () => {
    const zipPath = join(tmpDir, "test.zip");
    const zip = await ZipWriter.create(zipPath);
    await zip.addEntry("hello.txt", Buffer.from("Hello, world!"));
    await zip.addEntry("data.json", Buffer.from('{"key":"value"}'));
    await zip.finalize();

    // Verify with system unzip (available on Linux/macOS)
    const proc = Bun.spawnSync(["unzip", "-t", zipPath]);
    expect(proc.exitCode).toBe(0);
  });

  test("preserves file content through compression", async () => {
    const zipPath = join(tmpDir, "content.zip");
    const content = "The quick brown fox jumps over the lazy dog\n";

    const zip = await ZipWriter.create(zipPath);
    await zip.addEntry("test.txt", Buffer.from(content));
    await zip.finalize();

    // Extract via unzip and verify content matches
    const proc = Bun.spawnSync(["unzip", "-p", zipPath, "test.txt"]);
    const extracted = new TextDecoder().decode(proc.stdout);
    expect(extracted).toBe(content);
  });

  test("handles empty files", async () => {
    const zipPath = join(tmpDir, "empty.zip");
    const zip = await ZipWriter.create(zipPath);
    await zip.addEntry("empty.txt", Buffer.alloc(0));
    await zip.finalize();

    const proc = Bun.spawnSync(["unzip", "-t", zipPath]);
    expect(proc.exitCode).toBe(0);
  });

  test("handles files with subdirectory paths", async () => {
    const zipPath = join(tmpDir, "nested.zip");
    const zip = await ZipWriter.create(zipPath);
    await zip.addEntry("_/_/bundle.js", Buffer.from("var x = 1;"));
    await zip.addEntry("_/_/bundle.js.map", Buffer.from("{}"));
    await zip.addEntry("manifest.json", Buffer.from("{}"));
    await zip.finalize();

    const proc = Bun.spawnSync(["unzip", "-l", zipPath]);
    const output = new TextDecoder().decode(proc.stdout);
    expect(output).toContain("_/_/bundle.js");
    expect(output).toContain("_/_/bundle.js.map");
    expect(output).toContain("manifest.json");
  });

  test("handles large content (1 MB)", async () => {
    const zipPath = join(tmpDir, "large.zip");
    // 1 MB of pseudo-random data
    const content = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < content.length; i++) {
      content[i] = (i * 31 + 17) % 256;
    }

    const zip = await ZipWriter.create(zipPath);
    await zip.addEntry("large.bin", content);
    await zip.finalize();

    // Extract and verify content matches byte-for-byte
    const proc = Bun.spawnSync(["unzip", "-p", zipPath, "large.bin"]);
    expect(Buffer.from(proc.stdout)).toEqual(content);
  });
});

describe("property: ZipWriter round-trip", () => {
  test("arbitrary string content survives compress → extract", async () => {
    await fcAssert(
      asyncProperty(
        string({ minLength: 0, maxLength: 10_000 }),
        async (input) => {
          const zipPath = join(
            tmpDir,
            `prop-${Date.now()}-${Math.random()}.zip`
          );
          const zip = await ZipWriter.create(zipPath);
          await zip.addEntry("data.txt", Buffer.from(input, "utf-8"));
          await zip.finalize();

          const proc = Bun.spawnSync(["unzip", "-p", zipPath, "data.txt"]);
          expect(proc.exitCode).toBe(0);
          expect(new TextDecoder().decode(proc.stdout)).toBe(input);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("arbitrary binary content survives compress → extract", async () => {
    await fcAssert(
      asyncProperty(
        // minLength: 1 — empty files have a separate unit test;
        // unzip -p returns exit code 9 for empty entries on some systems
        uint8Array({ minLength: 1, maxLength: 10_000 }),
        async (input) => {
          const zipPath = join(
            tmpDir,
            `prop-bin-${Date.now()}-${Math.random()}.zip`
          );
          const zip = await ZipWriter.create(zipPath);
          await zip.addEntry("data.bin", Buffer.from(input));
          await zip.finalize();

          const proc = Bun.spawnSync(["unzip", "-p", zipPath, "data.bin"]);
          expect(proc.exitCode).toBe(0);
          expect(Buffer.from(proc.stdout)).toEqual(Buffer.from(input));
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("ZipWriter binary format", () => {
  test("starts with local file header signature", async () => {
    const zipPath = join(tmpDir, "sig.zip");
    const zip = await ZipWriter.create(zipPath);
    await zip.addEntry("a.txt", Buffer.from("a"));
    await zip.finalize();

    const data = await readFile(zipPath);
    // Local file header signature: PK\x03\x04
    expect(data[0]).toBe(0x50); // P
    expect(data[1]).toBe(0x4b); // K
    expect(data[2]).toBe(0x03);
    expect(data[3]).toBe(0x04);
  });

  test("ends with EOCD signature", async () => {
    const zipPath = join(tmpDir, "eocd.zip");
    const zip = await ZipWriter.create(zipPath);
    await zip.addEntry("a.txt", Buffer.from("a"));
    await zip.finalize();

    const data = await readFile(zipPath);
    // EOCD is the last 22 bytes, starts with PK\x05\x06
    const eocdStart = data.length - 22;
    expect(data[eocdStart]).toBe(0x50); // P
    expect(data[eocdStart + 1]).toBe(0x4b); // K
    expect(data[eocdStart + 2]).toBe(0x05);
    expect(data[eocdStart + 3]).toBe(0x06);
  });

  test("EOCD reports correct number of entries", async () => {
    const zipPath = join(tmpDir, "count.zip");
    const zip = await ZipWriter.create(zipPath);
    await zip.addEntry("a.txt", Buffer.from("a"));
    await zip.addEntry("b.txt", Buffer.from("b"));
    await zip.addEntry("c.txt", Buffer.from("c"));
    await zip.finalize();

    const data = await readFile(zipPath);
    const eocdStart = data.length - 22;
    // Entries on this disk (offset 8 from EOCD start)
    const entriesOnDisk = data.readUInt16LE(eocdStart + 8);
    // Total entries (offset 10)
    const totalEntries = data.readUInt16LE(eocdStart + 10);
    expect(entriesOnDisk).toBe(3);
    expect(totalEntries).toBe(3);
  });
});
