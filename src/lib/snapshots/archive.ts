/**
 * Snapshot archive extraction.
 *
 * Extracts a downloaded snapshot ZIP (baseline images) to a local directory,
 * guarding against path traversal (Zip Slip): entries resolving outside the
 * output directory, and absolute paths, are skipped.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { unzipSync } from "fflate";
import { logger } from "../logger.js";

const log = logger.withTag("snapshots.extract");

/**
 * Extract a ZIP archive's file entries into a directory.
 *
 * Directory entries are skipped; parent directories are created as needed.
 * Entries that would escape `outDir` are skipped with a warning.
 *
 * @param zip - The ZIP archive bytes.
 * @param outDir - Destination directory (created if missing).
 * @returns The number of files written.
 */
export function extractZipToDir(zip: Uint8Array, outDir: string): number {
  const entries = unzipSync(zip);
  const root = resolve(outDir);
  mkdirSync(root, { recursive: true });

  let written = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    // fflate represents directories as zero-length entries with a trailing "/".
    if (name.endsWith("/")) {
      continue;
    }

    const dest = resolve(root, name);
    const rel = relative(root, dest);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      log.warn(`Skipping unsafe archive entry: ${name}`);
      continue;
    }

    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    written += 1;
  }
  return written;
}
