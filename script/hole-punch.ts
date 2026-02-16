#!/usr/bin/env bun
/**
 * Post-compile binary hole-punch tool for Bun-compiled executables.
 *
 * "Punches holes" in the binary by zeroing unused ICU data entries inside
 * the embedded ICU data blob. These zeroed regions compress to nearly nothing,
 * reducing compressed download size by ~24%.
 *
 * How it works:
 * 1. Scans the binary for the ICU data header (magic bytes 0xda27, type "CmnD")
 * 2. Reads the Table of Contents (TOC) to enumerate all data entries
 * 3. Zeros data for entries that are safe to remove (converters, CJK dictionaries,
 *    non-English locale data in subcategories)
 * 4. Keeps all root-level entries, normalization files, break iterators, and
 *    English locale data intact (Bun accesses these at startup/shutdown)
 *
 * Safety: The TOC structure is left intact — only entry data bytes are zeroed.
 * The binary remains valid and all CLI functionality works with clean exits.
 *
 * Usage:
 *   bun run script/hole-punch.ts <binary-path>        # Modify in-place
 *   bun run script/hole-punch.ts dist-bin/sentry-*    # Glob multiple binaries
 *
 * Expected savings (linux-x64):
 *   gzip:    ~37 MB -> ~28 MB (24% reduction)
 *   zstd:    ~35 MB -> ~26 MB (24% reduction)
 *   zstd-19: ~27 MB -> ~21 MB (23% reduction)
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

/** ICU data header magic value (little-endian uint16 at offset 2) */
const ICU_MAGIC = 0x27_da;

/**
 * ICU data type identifier.
 * "CmnD" = Common Data — the monolithic ICU data package format.
 */
const ICU_TYPE_CMND = "CmnD";

/** Subcategories where non-essential locale data lives */
const LOCALE_SUBCATEGORIES = new Set([
  "coll/",
  "zone/",
  "curr/",
  "lang/",
  "unit/",
  "region/",
  "rbnf/",
  "translit/",
]);

/**
 * Prefixes for entries within subcategories that must be preserved.
 * These contain core data needed by the ICU runtime and Bun.
 */
const KEEP_PREFIXES = [
  "root",
  "en",
  "res_index",
  "pool",
  "supplementalData",
  "ucadata",
  "tzdbNames",
];

/** Result of scanning a binary for ICU data */
type IcuScanResult = {
  /** Byte offset where the ICU data blob starts in the binary */
  blobOffset: number;
  /** Size of the ICU data header in bytes */
  headerSize: number;
  /** Total number of TOC entries */
  entryCount: number;
  /** Parsed TOC entries with names and data boundaries */
  entries: IcuEntry[];
  /** ICU version prefix (e.g., "icudt75l") */
  prefix: string;
};

/** A single entry in the ICU data TOC */
type IcuEntry = {
  /** Entry name relative to ICU prefix (e.g., "coll/de.res") */
  name: string;
  /** Absolute offset of entry data within the binary */
  dataOffset: number;
  /** Size of entry data in bytes */
  dataSize: number;
  /** Whether this entry should be zeroed */
  shouldRemove: boolean;
};

/** Statistics from a hole-punch operation */
type HolePunchStats = {
  totalEntries: number;
  removedEntries: number;
  keptEntries: number;
  bytesZeroed: number;
  bytesKept: number;
};

/**
 * Scan a binary buffer for the ICU data blob header.
 *
 * The ICU common data format starts with:
 * - uint16 headerSize (offset 0)
 * - uint16 magic 0xda27 (offset 2)
 * - UDataInfo structure starting at offset 4:
 *   - uint16 size (offset 4)
 *   - uint16 reserved (offset 6)
 *   - uint8 isBigEndian (offset 8)
 *   - uint8 charsetFamily (offset 9)
 *   - uint8 sizeofUChar (offset 10)
 *   - uint8 reserved (offset 11)
 *   - char[4] dataFormat (offset 12, e.g., "CmnD")
 *
 * @returns Byte offset of the blob, or -1 if not found
 */
function findIcuBlob(buf: Buffer): number {
  // Scan for the ICU magic bytes, stepping by 4 (ICU blob is at least 4-byte aligned)
  for (let i = 0; i < buf.length - 16; i += 4) {
    const magic = buf.readUInt16LE(i + 2);
    if (magic !== ICU_MAGIC) {
      continue;
    }

    // Verify the dataFormat field is "CmnD" (at offset +12 in the header)
    const dataFormat = buf.toString("ascii", i + 12, i + 16);
    if (dataFormat !== ICU_TYPE_CMND) {
      continue;
    }

    const headerSize = buf.readUInt16LE(i);
    // Header size should be reasonable (typically 64-256 bytes, includes copyright)
    if (headerSize < 16 || headerSize > 512) {
      continue;
    }

    return i;
  }

  return -1;
}

/**
 * Read raw TOC entries from the ICU data blob.
 *
 * Each TOC entry is 8 bytes: uint32 nameOffset + uint32 dataOffset,
 * both relative to the TOC start.
 */
function readRawTocEntries(
  buf: Buffer,
  tocStart: number,
  entryCount: number
): { nameOffset: number; dataOffset: number }[] {
  const tocEntriesStart = tocStart + 4;
  const rawEntries: { nameOffset: number; dataOffset: number }[] = [];

  for (let i = 0; i < entryCount; i += 1) {
    const offset = tocEntriesStart + i * 8;
    rawEntries.push({
      nameOffset: buf.readUInt32LE(offset),
      dataOffset: buf.readUInt32LE(offset + 4),
    });
  }

  return rawEntries;
}

/**
 * Read a null-terminated ASCII string from the buffer.
 */
function readNullTerminatedString(buf: Buffer, start: number): string {
  let end = start;
  while (end < buf.length && buf[end] !== 0) {
    end += 1;
  }
  return buf.toString("ascii", start, end);
}

/**
 * Estimate the data size of the last TOC entry.
 *
 * The last entry has no successor to measure against, so we estimate
 * using twice the average entry size (capped at 64KB).
 */
function estimateLastEntrySize(entries: IcuEntry[]): number {
  if (entries.length < 2) {
    return 4096;
  }

  const firstData = entries[0].dataOffset;
  const last = entries.at(-1);
  if (!last) {
    return 4096;
  }
  const avgSize = (last.dataOffset - firstData) / (entries.length - 1);
  return Math.min(Math.ceil(avgSize * 2), 65_536);
}

/**
 * Parse the ICU data blob's Table of Contents.
 *
 * After the header, the TOC structure is:
 * - uint32 entryCount (at blobOffset + headerSize)
 * - For each entry (8 bytes each):
 *   - uint32 nameOffset (relative to TOC start)
 *   - uint32 dataOffset (relative to TOC start)
 * - Names area (null-terminated strings)
 * - Data area (entry data, each aligned to 16 bytes)
 */
function parseIcuToc(buf: Buffer, blobOffset: number): IcuScanResult {
  const headerSize = buf.readUInt16LE(blobOffset);
  const tocStart = blobOffset + headerSize;
  const entryCount = buf.readUInt32LE(tocStart);

  if (entryCount < 100 || entryCount > 10_000) {
    throw new Error(
      `Unexpected ICU entry count: ${entryCount}. Binary may be corrupted.`
    );
  }

  const rawEntries = readRawTocEntries(buf, tocStart, entryCount);

  // Read names and compute data sizes
  const entries: IcuEntry[] = [];
  let prefix = "";

  for (let i = 0; i < rawEntries.length; i += 1) {
    const raw = rawEntries[i];
    const fullName = readNullTerminatedString(buf, tocStart + raw.nameOffset);

    // Extract ICU prefix from first entry (e.g., "icudt75l/")
    if (i === 0) {
      const slashIdx = fullName.indexOf("/");
      if (slashIdx !== -1) {
        prefix = fullName.substring(0, slashIdx);
      }
    }

    // Strip prefix (e.g., "icudt75l/coll/de.res" -> "coll/de.res")
    const name = prefix ? fullName.substring(prefix.length + 1) : fullName;

    // Data size = distance to next entry's data (or estimated for last entry)
    const dataAbsOffset = tocStart + raw.dataOffset;
    const dataSize =
      i < rawEntries.length - 1
        ? tocStart + rawEntries[i + 1].dataOffset - dataAbsOffset
        : 0; // Placeholder for last entry, fixed below

    entries.push({
      name,
      dataOffset: dataAbsOffset,
      dataSize,
      shouldRemove: false,
    });
  }

  // Fix last entry size estimate
  const lastEntry = entries.at(-1);
  if (lastEntry) {
    lastEntry.dataSize = estimateLastEntrySize(entries);
  }

  return { blobOffset, headerSize, entryCount, entries, prefix };
}

/**
 * Determine whether an ICU entry should be zeroed.
 *
 * Safe to remove:
 * - `.cnv` files: legacy charset converters (never used in JS/Bun)
 * - `.dict` files in `brkitr/`: CJK/Burmese/Khmer break dictionaries
 * - Non-essential locale data in subcategories (coll/, zone/, curr/, etc.)
 *
 * Must keep:
 * - All root-level `.res` files (Bun accesses these during shutdown)
 * - All `.nrm`, `.icu`, `.cfu`, `.brk`, `.spp` files
 * - `res_index.res`, `pool.res` in every subcategory
 * - Root and English entries in subcategories
 */
function shouldRemoveEntry(name: string): boolean {
  // Legacy charset converters — never used in JS
  if (name.endsWith(".cnv")) {
    return true;
  }

  // CJK/Burmese/Khmer break dictionaries — large, not needed for CLI
  if (name.includes("brkitr/") && name.endsWith(".dict")) {
    return true;
  }

  // Check subcategory locale data
  for (const subcat of LOCALE_SUBCATEGORIES) {
    if (!name.startsWith(subcat)) {
      continue;
    }

    const filename = name.substring(subcat.length);

    // Keep essential entries (root, English, indexes, pools, supplemental data)
    const shouldKeep = KEEP_PREFIXES.some(
      (p) =>
        filename === p ||
        filename.startsWith(`${p}.`) ||
        filename.startsWith(`${p}_`)
    );

    if (!shouldKeep) {
      return true;
    }
  }

  return false;
}

/**
 * Punch holes in a binary buffer by zeroing removable ICU entries in-place.
 *
 * Zeros data bytes for removable ICU entries while keeping the TOC intact.
 * This makes the zeroed regions compress to nearly nothing.
 */
function holePunch(buf: Buffer, scan: IcuScanResult): HolePunchStats {
  let removedEntries = 0;
  let keptEntries = 0;
  let bytesZeroed = 0;
  let bytesKept = 0;

  const lastIndex = scan.entries.length - 1;

  for (let i = 0; i < scan.entries.length; i += 1) {
    const entry = scan.entries[i];
    entry.shouldRemove = shouldRemoveEntry(entry.name);

    // Skip the last entry: its size is estimated (no successor to measure
    // against) and zeroing it could overwrite bytes outside the ICU blob.
    // One skipped entry has negligible impact on compression savings.
    if (i === lastIndex) {
      keptEntries += 1;
      bytesKept += entry.dataSize;
      continue;
    }

    // Clamp data size to not exceed buffer bounds
    const safeSize = Math.min(entry.dataSize, buf.length - entry.dataOffset);
    if (safeSize <= 0) {
      keptEntries += 1;
      continue;
    }

    if (entry.shouldRemove) {
      buf.fill(0, entry.dataOffset, entry.dataOffset + safeSize);
      removedEntries += 1;
      bytesZeroed += safeSize;
    } else {
      keptEntries += 1;
      bytesKept += safeSize;
    }
  }

  return {
    totalEntries: scan.entryCount,
    removedEntries,
    keptEntries,
    bytesZeroed,
    bytesKept,
  };
}

/**
 * Process a single binary file: find ICU data, zero unused entries, write back.
 *
 * Returns null (rather than throwing) when the binary has no ICU data or
 * when the ICU blob has an unexpected layout, so callers like the build
 * script can skip hole-punch gracefully instead of crashing.
 *
 * @returns Hole-punch statistics, or null if no ICU data was found/parseable
 */
function processBinary(filePath: string): HolePunchStats | null {
  const buf = readFileSync(filePath);

  const blobOffset = findIcuBlob(buf);
  if (blobOffset === -1) {
    return null;
  }

  try {
    const scan = parseIcuToc(buf, blobOffset);
    const stats = holePunch(buf, scan);

    writeFileSync(filePath, buf);
    return stats;
  } catch {
    // ICU blob matched the magic bytes but has an unexpected layout
    // (e.g., entry count out of range). Skip instead of crashing.
    return null;
  }
}

/** Format bytes as a human-readable string */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

// --- Exports for testing ---

export {
  findIcuBlob,
  parseIcuToc,
  shouldRemoveEntry,
  holePunch,
  processBinary,
  formatSize,
  estimateLastEntrySize,
  runCli,
};
export type { IcuScanResult, IcuEntry, HolePunchStats, CliFileResult };

// --- CLI Entry Point ---

/** Result from a single file processed by the CLI */
type CliFileResult = {
  filePath: string;
  status: "no_icu" | "no_removable" | "success";
  stats?: HolePunchStats;
  originalSize?: number;
};

/**
 * Run the hole-punch CLI logic.
 *
 * Extracted from main() so it can be tested in-process without mocking
 * process.exit or console output.
 *
 * @returns Error message string if validation fails, or array of results
 */
function runCli(
  args: string[]
): { error: string } | { results: CliFileResult[] } {
  const filePaths = args.filter((a) => !a.startsWith("-"));

  if (filePaths.length === 0) {
    return {
      error:
        "Usage: bun run script/hole-punch.ts [--verbose] <binary-path> ...",
    };
  }

  // Validate all files exist before processing
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) {
      return { error: `Error: File not found: ${filePath}` };
    }
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return { error: `Error: Not a file: ${filePath}` };
    }
  }

  const results: CliFileResult[] = [];

  for (const filePath of filePaths) {
    const originalSize = statSync(filePath).size;
    const stats = processBinary(filePath);

    if (!stats) {
      results.push({ filePath, status: "no_icu" });
      continue;
    }

    if (stats.removedEntries === 0) {
      results.push({ filePath, status: "no_removable", stats, originalSize });
      continue;
    }

    results.push({ filePath, status: "success", stats, originalSize });
  }

  return { results };
}

function main(): void {
  const cliArgs = process.argv.slice(2);
  const isVerbose = cliArgs.includes("--verbose") || cliArgs.includes("-v");
  const result = runCli(cliArgs);

  if ("error" in result) {
    console.error(result.error);
    if (result.error.startsWith("Usage:")) {
      console.error("");
      console.error(
        "Reduces compressed binary size by ~24% by zeroing unused ICU data."
      );
      console.error("Modifies binaries in-place.");
    }
    process.exit(1);
  }

  for (const fileResult of result.results) {
    if (fileResult.status === "no_icu") {
      console.error(
        `  Warning: No ICU data found in ${fileResult.filePath}, skipping`
      );
      continue;
    }

    if (fileResult.status === "no_removable") {
      console.log(`  ${fileResult.filePath}: no removable entries found`);
      continue;
    }

    const { stats, originalSize, filePath } = fileResult;
    if (!stats) {
      continue;
    }

    const pct = (
      (stats.bytesZeroed / (stats.bytesZeroed + stats.bytesKept)) *
      100
    ).toFixed(1);

    console.log(
      `  ${filePath}: zeroed ${stats.removedEntries}/${stats.totalEntries} ICU entries (${formatSize(stats.bytesZeroed)}, ${pct}% of ICU data)`
    );

    if (isVerbose && originalSize !== undefined) {
      console.log(`    Raw size: ${formatSize(originalSize)} (unchanged)`);
      console.log(`    ICU entries kept: ${stats.keptEntries}`);
      console.log(`    ICU data kept: ${formatSize(stats.bytesKept)}`);
      console.log(`    ICU data zeroed: ${formatSize(stats.bytesZeroed)}`);
    }
  }
}

// Only run CLI when executed directly (not imported for testing)
const isMainModule =
  typeof Bun !== "undefined" && "main" in Bun
    ? import.meta.path === (Bun as Record<string, unknown>).main
    : process.argv[1]?.endsWith("hole-punch.ts");

if (isMainModule) {
  main();
}
