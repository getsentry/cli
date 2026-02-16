import { describe, expect, test } from "bun:test";
import {
  findIcuBlob,
  holePunch,
  parseIcuToc,
  shouldRemoveEntry,
} from "../../script/hole-punch.js";

/**
 * Build a synthetic ICU data blob for testing.
 *
 * Creates a minimal valid ICU common data package with the given entry names.
 * Each entry gets 64 bytes of non-zero data (0xff fill) so we can verify
 * that zeroing actually happened.
 *
 * @param prefix ICU version prefix (e.g., "icudt75l")
 * @param entryNames Entry names without prefix (e.g., ["root.res", "coll/de.res"])
 * @param prePadding Bytes of padding before the ICU blob (simulates ELF sections)
 * @returns Buffer containing the synthetic binary
 */
function buildSyntheticBlob(
  prefix: string,
  entryNames: string[],
  prePadding = 256
): Buffer {
  const entryDataSize = 64; // Each entry gets 64 bytes of data

  // Full entry names include the prefix
  const fullNames = entryNames.map((n) => `${prefix}/${n}`);

  // Calculate sizes:
  // Header: 32 bytes (padded, includes UDataInfo + some copyright text)
  const headerSize = 32;

  // TOC: 4 bytes (count) + 8 bytes per entry (nameOffset + dataOffset)
  const tocHeaderSize = 4 + entryNames.length * 8;

  // Names area: all names null-terminated, then padded to 16 bytes
  let namesSize = 0;
  for (const name of fullNames) {
    namesSize += name.length + 1; // +1 for null terminator
  }
  // Pad names to 16-byte alignment
  const namesPadded = Math.ceil(namesSize / 16) * 16;

  // Data area: each entry gets entryDataSize bytes, aligned to 16
  const dataAreaSize = entryNames.length * entryDataSize;

  // Total blob size
  const totalSize =
    prePadding + headerSize + tocHeaderSize + namesPadded + dataAreaSize;
  const buf = Buffer.alloc(totalSize);

  // Fill prePadding with random-ish data (simulates ELF content)
  for (let i = 0; i < prePadding; i += 1) {
    buf[i] = (i * 7 + 3) % 256;
  }

  const blobStart = prePadding;

  // Write header
  buf.writeUInt16LE(headerSize, blobStart); // headerSize
  buf.writeUInt16LE(0x27_da, blobStart + 2); // magic
  buf.writeUInt16LE(20, blobStart + 4); // UDataInfo.size
  buf.writeUInt16LE(0, blobStart + 6); // UDataInfo.reserved
  buf[blobStart + 8] = 0; // isBigEndian
  buf[blobStart + 9] = 0; // charsetFamily
  buf[blobStart + 10] = 2; // sizeofUChar
  buf[blobStart + 11] = 0; // reserved
  buf.write("CmnD", blobStart + 12, 4, "ascii"); // dataFormat

  // Write TOC
  const tocStart = blobStart + headerSize;
  buf.writeUInt32LE(entryNames.length, tocStart); // entryCount

  // Compute offsets relative to tocStart
  const namesAreaOffset = tocHeaderSize;
  const dataAreaOffset = tocHeaderSize + namesPadded;

  let currentNameOffset = namesAreaOffset;

  for (let i = 0; i < entryNames.length; i += 1) {
    const tocEntryOffset = tocStart + 4 + i * 8;

    // Write name offset (relative to tocStart)
    buf.writeUInt32LE(currentNameOffset, tocEntryOffset);

    // Write data offset (relative to tocStart)
    const entryDataOffset = dataAreaOffset + i * entryDataSize;
    buf.writeUInt32LE(entryDataOffset, tocEntryOffset + 4);

    // Write the name string
    const nameAbsOffset = tocStart + currentNameOffset;
    buf.write(fullNames[i], nameAbsOffset, "ascii");
    buf[nameAbsOffset + fullNames[i].length] = 0; // null terminator

    currentNameOffset += fullNames[i].length + 1;

    // Fill entry data with non-zero bytes so we can detect zeroing
    const dataAbsOffset = tocStart + entryDataOffset;
    buf.fill(0xff, dataAbsOffset, dataAbsOffset + entryDataSize);
  }

  return buf;
}

/**
 * Check whether a data region is all zeros.
 */
function isZeroed(buf: Buffer, offset: number, size: number): boolean {
  for (let i = 0; i < size; i += 1) {
    if (buf[offset + i] !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * Check whether a data region is all 0xff (non-zero fill).
 */
function isNonZero(buf: Buffer, offset: number, size: number): boolean {
  for (let i = 0; i < size; i += 1) {
    if (buf[offset + i] !== 0xff) {
      return false;
    }
  }
  return true;
}

describe("findIcuBlob", () => {
  test("finds ICU blob at the correct offset", () => {
    const buf = buildSyntheticBlob("icudt75l", ["root.res"], 256);
    const offset = findIcuBlob(buf);
    expect(offset).toBe(256);
  });

  test("finds ICU blob with different padding", () => {
    const buf = buildSyntheticBlob("icudt75l", ["root.res"], 1024);
    const offset = findIcuBlob(buf);
    expect(offset).toBe(1024);
  });

  test("returns -1 for buffer without ICU data", () => {
    const buf = Buffer.alloc(4096);
    expect(findIcuBlob(buf)).toBe(-1);
  });

  test("returns -1 for buffer too small", () => {
    const buf = Buffer.alloc(8);
    expect(findIcuBlob(buf)).toBe(-1);
  });

  test("handles different ICU version prefixes", () => {
    const buf = buildSyntheticBlob("icudt80l", ["root.res"], 256);
    const offset = findIcuBlob(buf);
    expect(offset).toBe(256);
  });
});

describe("parseIcuToc", () => {
  test("parses entry count correctly", () => {
    const names = Array.from({ length: 200 }, (_, i) => `entry${i}.res`);
    const buf = buildSyntheticBlob("icudt75l", names);
    const offset = findIcuBlob(buf);
    const scan = parseIcuToc(buf, offset);

    expect(scan.entryCount).toBe(200);
    expect(scan.entries).toHaveLength(200);
  });

  test("extracts ICU prefix from first entry", () => {
    // Need at least 100 entries to pass validation
    const names = [
      "root.res",
      "en.res",
      ...Array.from({ length: 100 }, (_, i) => `extra${i}.res`),
    ];
    const buf = buildSyntheticBlob("icudt75l", names);
    const offset = findIcuBlob(buf);
    const scan = parseIcuToc(buf, offset);

    expect(scan.prefix).toBe("icudt75l");
  });

  test("strips prefix from entry names", () => {
    const names = [
      "root.res",
      "coll/de.res",
      ...Array.from({ length: 100 }, (_, i) => `extra${i}.res`),
    ];
    const buf = buildSyntheticBlob("icudt75l", names);
    const offset = findIcuBlob(buf);
    const scan = parseIcuToc(buf, offset);

    expect(scan.entries[0].name).toBe("root.res");
    expect(scan.entries[1].name).toBe("coll/de.res");
  });

  test("computes data sizes from entry offsets", () => {
    const names = [
      "root.res",
      "en.res",
      "coll/de.res",
      ...Array.from({ length: 100 }, (_, i) => `extra${i}.res`),
    ];
    const buf = buildSyntheticBlob("icudt75l", names);
    const offset = findIcuBlob(buf);
    const scan = parseIcuToc(buf, offset);

    // First two entries should have dataSize = 64 (the entryDataSize)
    expect(scan.entries[0].dataSize).toBe(64);
    expect(scan.entries[1].dataSize).toBe(64);
    // Last entry size is estimated, should be > 0
    const lastEntry = scan.entries.at(-1);
    expect(lastEntry).toBeDefined();
    expect(lastEntry!.dataSize).toBeGreaterThan(0);
  });
});

describe("shouldRemoveEntry", () => {
  test("removes .cnv files", () => {
    expect(shouldRemoveEntry("ibm-1252_P100-2000.cnv")).toBe(true);
    expect(shouldRemoveEntry("iso-8859-1.cnv")).toBe(true);
  });

  test("removes brkitr .dict files", () => {
    expect(shouldRemoveEntry("brkitr/cjdict.dict")).toBe(true);
    expect(shouldRemoveEntry("brkitr/burmesedict.dict")).toBe(true);
    expect(shouldRemoveEntry("brkitr/khmerdict.dict")).toBe(true);
  });

  test("keeps brkitr .brk files", () => {
    expect(shouldRemoveEntry("brkitr/word.brk")).toBe(false);
    expect(shouldRemoveEntry("brkitr/line.brk")).toBe(false);
  });

  test("removes non-English locale data in subcategories", () => {
    expect(shouldRemoveEntry("coll/de.res")).toBe(true);
    expect(shouldRemoveEntry("coll/fr.res")).toBe(true);
    expect(shouldRemoveEntry("coll/ja.res")).toBe(true);
    expect(shouldRemoveEntry("zone/de.res")).toBe(true);
    expect(shouldRemoveEntry("curr/zh.res")).toBe(true);
    expect(shouldRemoveEntry("lang/ko.res")).toBe(true);
    expect(shouldRemoveEntry("unit/ar.res")).toBe(true);
    expect(shouldRemoveEntry("region/pt.res")).toBe(true);
    expect(shouldRemoveEntry("rbnf/ru.res")).toBe(true);
    expect(shouldRemoveEntry("translit/el.res")).toBe(true);
  });

  test("keeps root entries in subcategories", () => {
    expect(shouldRemoveEntry("coll/root.res")).toBe(false);
    expect(shouldRemoveEntry("zone/root.res")).toBe(false);
    expect(shouldRemoveEntry("curr/root.res")).toBe(false);
  });

  test("keeps English entries in subcategories", () => {
    expect(shouldRemoveEntry("coll/en.res")).toBe(false);
    expect(shouldRemoveEntry("coll/en_US.res")).toBe(false);
    expect(shouldRemoveEntry("zone/en.res")).toBe(false);
    expect(shouldRemoveEntry("zone/en_GB.res")).toBe(false);
  });

  test("keeps res_index and pool files in subcategories", () => {
    expect(shouldRemoveEntry("coll/res_index.res")).toBe(false);
    expect(shouldRemoveEntry("coll/pool.res")).toBe(false);
    expect(shouldRemoveEntry("zone/res_index.res")).toBe(false);
  });

  test("keeps supplemental data", () => {
    expect(shouldRemoveEntry("coll/ucadata.res")).toBe(false);
  });

  test("keeps root-level .res files", () => {
    expect(shouldRemoveEntry("root.res")).toBe(false);
    expect(shouldRemoveEntry("en.res")).toBe(false);
    expect(shouldRemoveEntry("de.res")).toBe(false);
    expect(shouldRemoveEntry("ja.res")).toBe(false);
  });

  test("keeps .nrm, .icu, .cfu files", () => {
    expect(shouldRemoveEntry("nfc.nrm")).toBe(false);
    expect(shouldRemoveEntry("uprops.icu")).toBe(false);
    expect(shouldRemoveEntry("confusables.cfu")).toBe(false);
  });
});

describe("holePunch (apply)", () => {
  test("zeros data for removable entries", () => {
    const entryNames = [
      // Should be kept (200 entries to pass the >100 validation)
      ...Array.from({ length: 150 }, (_, i) => `entry${i}.res`),
      // Should be removed
      "ibm-1252.cnv",
      "coll/de.res",
      "coll/fr.res",
      "zone/ja.res",
      "brkitr/cjdict.dict",
      // Should be kept
      "coll/root.res",
      "coll/en.res",
      "coll/res_index.res",
    ];
    const buf = buildSyntheticBlob("icudt75l", entryNames);
    const offset = findIcuBlob(buf);
    const scan = parseIcuToc(buf, offset);
    const stats = holePunch(buf, scan);

    // Verify counts
    expect(stats.totalEntries).toBe(entryNames.length);
    expect(stats.removedEntries).toBe(5);
    expect(stats.keptEntries).toBe(entryNames.length - 5);

    // Verify removed entries are actually zeroed
    for (const entry of scan.entries) {
      if (entry.shouldRemove) {
        expect(isZeroed(buf, entry.dataOffset, entry.dataSize)).toBe(true);
      }
    }

    // Verify kept entries still have their data
    for (const entry of scan.entries) {
      if (!entry.shouldRemove && entry.dataSize > 0) {
        // Non-last entries should still be 0xff
        const idx = scan.entries.indexOf(entry);
        if (idx < scan.entries.length - 1) {
          expect(isNonZero(buf, entry.dataOffset, entry.dataSize)).toBe(true);
        }
      }
    }
  });

  test("returns zero stats when nothing is removable", () => {
    const entryNames = Array.from({ length: 150 }, (_, i) => `entry${i}.res`);
    const buf = buildSyntheticBlob("icudt75l", entryNames);
    const offset = findIcuBlob(buf);
    const scan = parseIcuToc(buf, offset);
    const stats = holePunch(buf, scan);

    expect(stats.removedEntries).toBe(0);
    expect(stats.bytesZeroed).toBe(0);
    expect(stats.keptEntries).toBe(150);
  });

  test("preserves TOC structure after hole-punch", () => {
    const entryNames = [
      ...Array.from({ length: 150 }, (_, i) => `entry${i}.res`),
      "ibm-1252.cnv",
      "coll/de.res",
    ];
    const buf = buildSyntheticBlob("icudt75l", entryNames);
    const offset = findIcuBlob(buf);

    // Parse before hole-punch
    const scanBefore = parseIcuToc(buf, offset);
    const namesBefore = scanBefore.entries.map((e) => e.name);

    // Apply hole-punch
    holePunch(buf, scanBefore);

    // Parse again — TOC should be identical
    const scanAfter = parseIcuToc(buf, offset);
    const namesAfter = scanAfter.entries.map((e) => e.name);

    expect(namesAfter).toEqual(namesBefore);
    expect(scanAfter.entryCount).toBe(scanBefore.entryCount);
  });
});
