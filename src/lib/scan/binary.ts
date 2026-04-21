/**
 * Binary-file detection for the scan module.
 *
 * Uses the standard NUL-byte heuristic: a file is considered binary if
 * any of its first 8 KB is 0x00. This matches rg, git, grep, and
 * file(1). It is deliberately coarse — UTF-16-encoded text is
 * misclassified as binary because its ASCII-range code units produce
 * NUL bytes; callers that care can add a UTF-16 BOM check on top.
 *
 * Two entry points:
 *
 * - `classifyByExtension` — O(1) fast path. Returns `{ isBinary: false }`
 *   for known text extensions; returns null otherwise so the caller knows
 *   to fall through to the sniff path.
 * - `readHeadAndSniff` — opens the file, reads the first 8 KB via
 *   `fs.promises.open` + `handle.read`, runs the sniff, returns the head
 *   buffer alongside the classification.
 */

import { open } from "node:fs/promises";
import { extname } from "node:path";
import { BINARY_SNIFF_BYTES } from "./constants.js";

/**
 * Inspect up to 8 KB of `head` for a NUL byte.
 *
 * Empty buffers are treated as text — they correspond to zero-byte
 * files, which are conventionally text (nothing to be confused about).
 */
export function isLikelyBinary(head: Uint8Array): boolean {
  const sniffLen = Math.min(head.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < sniffLen; i += 1) {
    if (head[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Extension-based classification for the fast path.
 *
 * Returns `{ isBinary: false }` when the path's extension is a known
 * text extension — no disk read needed. Returns `null` when the
 * extension is unknown and the caller must read the file head.
 *
 * This intentionally does not try to classify "known binary" extensions
 * (.png, .zip, .woff…). A NUL-byte sniff is fast and more reliable than
 * maintaining a binary-extension allowlist; most text files without a
 * TEXT_EXTENSIONS membership (e.g., `.sentryclirc`, `.editorconfig`,
 * `Makefile`) would be misclassified by a naive binary-ext list.
 */
export function classifyByExtension(
  absPath: string,
  textExtensions: ReadonlySet<string>
): { isBinary: false } | null {
  const ext = extname(absPath).toLowerCase();
  if (ext && textExtensions.has(ext)) {
    return { isBinary: false };
  }
  return null;
}

/**
 * Open `absPath`, read up to 8 KB from offset 0, and classify.
 *
 * The returned `head` is a borrowed view of the read buffer — do NOT
 * retain it beyond the current stack frame, as the backing allocation
 * is not pooled. When the file is shorter than 8 KB, the buffer is
 * sliced to the actual number of bytes read.
 *
 * Errors are re-thrown. Callers that want to swallow fs errors should
 * wrap this in try/catch.
 */
export async function readHeadAndSniff(
  absPath: string
): Promise<{ head: Uint8Array; isBinary: boolean }> {
  const handle = await open(absPath, "r");
  try {
    const buf = new Uint8Array(BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buf, 0, BINARY_SNIFF_BYTES, 0);
    const head =
      bytesRead === BINARY_SNIFF_BYTES ? buf : buf.subarray(0, bytesRead);
    return { head, isBinary: isLikelyBinary(head) };
  } finally {
    await handle.close();
  }
}
