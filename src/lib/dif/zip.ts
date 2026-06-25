/**
 * ZIP archive scanning for debug information files.
 *
 * The `debug-files upload` scanner can look inside `.zip` archives for debug
 * files, matching the legacy `sentry-cli` behavior (`try_open_zip` /
 * `walk_difs_zip`). A file is treated as a ZIP only when its extension is
 * `.zip` and its first two bytes are the `PK` local-file-header magic; anything
 * else falls back to normal file handling.
 *
 * Decompression is bounded to guard against zip bombs: entries whose declared
 * uncompressed size exceeds the configured maximum are skipped via fflate's
 * pre-decompression `filter` and never inflated. Nested archives are not
 * recursed (a `.zip` inside a `.zip` is ignored), matching the legacy tool.
 */

import { open, readFile } from "node:fs/promises";
import { type UnzipFileInfo, unzipSync } from "fflate";
import { logger } from "../logger.js";

const log = logger.withTag("dif.zip");

/** Local-file-header signature ("PK\x03\x04") — first two bytes are enough. */
const ZIP_MAGIC_0 = 0x50; // 'P'
const ZIP_MAGIC_1 = 0x4b; // 'K'

/** A debug-file candidate extracted from a ZIP archive. */
export type ZipDifEntry = {
  /**
   * Synthetic display path `"<zipPath>/<entryName>"`. `basename()` of it yields
   * the entry's own base name (the DIF name), and the full string preserves the
   * archive origin in logs and error messages.
   */
  path: string;
  /** Decompressed entry bytes. */
  content: Buffer;
};

/** Result of {@link readZipDifEntries}. */
export type ReadZipResult = {
  /** Decompressed, non-directory entries that passed the size gate. */
  entries: ZipDifEntry[];
  /**
   * Count of entries skipped because their uncompressed size exceeded
   * `maxFileSize`. This is format-agnostic: unlike the on-disk path, a
   * compressed entry's container format is unknown until it is decompressed, so
   * every oversized entry is counted regardless of `--type`. The count only
   * feeds advisory output, never which files are uploaded.
   */
  oversizedCount: number;
};

/** Options for {@link readZipDifEntries}. */
export type ReadZipOptions = {
  /**
   * Maximum uncompressed size, in bytes, of an entry to extract. Entries above
   * this are skipped without decompression. `0` or omitted means no gate.
   */
  maxFileSize?: number;
};

/** Whether a ZIP entry name denotes a directory (trailing slash). */
function isDirectoryEntry(name: string): boolean {
  return name.endsWith("/");
}

/**
 * Cheaply check whether a file begins with the ZIP local-file-header magic,
 * without reading the whole file.
 */
async function hasZipMagic(path: string): Promise<boolean> {
  try {
    const fd = await open(path, "r");
    try {
      const buf = Buffer.alloc(2);
      const { bytesRead } = await fd.read(buf, 0, 2, 0);
      return (
        bytesRead === 2 && buf[0] === ZIP_MAGIC_0 && buf[1] === ZIP_MAGIC_1
      );
    } finally {
      await fd.close();
    }
  } catch (err) {
    log.debug(`Could not read header of ${path}`, err);
    return false;
  }
}

/**
 * Open `path` as a ZIP archive and return its candidate debug-file entries.
 *
 * Returns `null` when the file is not a ZIP — its extension is not `.zip` or it
 * lacks the `PK` magic — signalling the caller to handle it as a normal file.
 * A malformed or unreadable archive also yields `null` (logged at debug), so
 * the container is skipped rather than parsed as a debug file.
 *
 * Directory and empty entries are dropped. Entries whose uncompressed size
 * exceeds `maxFileSize` are skipped before decompression and reflected in
 * `oversizedCount`. Nested archives are not recursed.
 *
 * @param path - Filesystem path to inspect.
 * @param options - Optional size gate (see {@link ReadZipOptions}).
 * @returns Extracted entries plus oversized telemetry, or `null` when not a ZIP.
 */
export async function readZipDifEntries(
  path: string,
  options: ReadZipOptions = {}
): Promise<ReadZipResult | null> {
  if (!path.toLowerCase().endsWith(".zip")) {
    return null;
  }
  if (!(await hasZipMagic(path))) {
    return null;
  }

  const maxFileSize = options.maxFileSize ?? 0;
  let oversizedCount = 0;

  let data: Buffer;
  try {
    data = await readFile(path);
  } catch (err) {
    log.debug(`Skipping unreadable zip: ${path}`, err);
    return null;
  }

  // The filter runs before decompression, so oversized and directory entries
  // are never inflated into memory (zip-bomb guard).
  const filter = (file: UnzipFileInfo): boolean => {
    if (isDirectoryEntry(file.name) || file.originalSize === 0) {
      return false;
    }
    if (maxFileSize > 0 && file.originalSize > maxFileSize) {
      oversizedCount += 1;
      log.warn(
        `Skipping ${path}/${file.name}: uncompressed size ${file.originalSize} exceeds maximum file size ${maxFileSize}`
      );
      return false;
    }
    return true;
  };

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(new Uint8Array(data), { filter });
  } catch (err) {
    log.debug(`Skipping malformed zip: ${path}`, err);
    return null;
  }

  const entries: ZipDifEntry[] = [];
  for (const [name, bytes] of Object.entries(unzipped)) {
    entries.push({ path: `${path}/${name}`, content: Buffer.from(bytes) });
  }

  return { entries, oversizedCount };
}
