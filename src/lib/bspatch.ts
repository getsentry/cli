/**
 * Streaming TRDIFF10 Binary Patch Application
 *
 * Implements the bspatch algorithm for applying binary delta patches in the
 * TRDIFF10 format (produced by zig-bsdiff with `--use-zstd`). Designed for
 * minimal memory usage during CLI self-upgrades:
 *
 * - Old binary: copy to temp file, then read via `readFile()` (~100 MB heap)
 * - Diff/extra blocks: streamed via zstd `Transform` from `node:zlib`
 * - Output: written incrementally to disk via `createWriteStream()`
 * - Integrity: SHA-256 computed inline via `node:crypto`
 *
 * TRDIFF10 format (from zig-bsdiff):
 * ```
 * [0..8]   magic: "TRDIFF10"
 * [8..16]  controlLen: i64 LE (compressed size of control block)
 * [16..24] diffLen:    i64 LE (compressed size of diff block)
 * [24..32] newSize:    i64 LE (expected output size)
 * [32..]   zstd(control) | zstd(diff) | zstd(extra)
 * ```
 */

import { createHash } from "node:crypto";
import { constants, copyFileSync, createWriteStream } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createZstdDecompress, zstdDecompressSync } from "node:zlib";

/** TRDIFF10 header magic bytes */
const TRDIFF10_MAGIC = "TRDIFF10";

/** Header size in bytes (magic + 3 × i64) */
const HEADER_SIZE = 32;

/** Parsed TRDIFF10 header fields */
export type PatchHeader = {
  /** Compressed size of the control block (bytes) */
  controlLen: number;
  /** Compressed size of the diff block (bytes) */
  diffLen: number;
  /** Expected output file size (bytes) */
  newSize: number;
};

/**
 * Read a signed 64-bit little-endian integer using the zig-bsdiff encoding.
 *
 * The sign is stored in bit 7 of byte 7 (the MSB of the last byte).
 * The magnitude is in the lower 63 bits, read as unsigned LE.
 * This differs from standard two's complement — it uses sign-magnitude.
 *
 * Safe for values up to 2^53 (Number.MAX_SAFE_INTEGER), which covers
 * any realistic file size.
 *
 * @param buf - Buffer to read from
 * @param offset - Byte offset to start reading
 * @returns Signed integer value
 */
export function offtin(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  const lo = view.getUint32(0, true);
  const hi = view.getUint32(4, true);

  // Magnitude from lower 63 bits (mask out sign bit in high word).
  // getUint32 already returns unsigned, so hi is in [0, 2^32).
  const magnitude = (hi % 0x80_00_00_00) * 0x1_00_00_00_00 + lo;

  // Sign in bit 7 of byte 7 (bit 31 of high word).
  // Guard magnitude === 0 to avoid returning -0.
  if (magnitude !== 0 && hi >= 0x80_00_00_00) {
    return -magnitude;
  }
  return magnitude;
}

/**
 * Parse and validate a TRDIFF10 patch header.
 *
 * @param patch - Raw patch file data (at least 32 bytes)
 * @returns Parsed header with controlLen, diffLen, and newSize
 * @throws {Error} When magic is invalid or header values are negative
 */
export function parsePatchHeader(patch: Uint8Array): PatchHeader {
  if (patch.byteLength < HEADER_SIZE) {
    throw new Error(
      `Patch too small: ${patch.byteLength} bytes (need at least ${HEADER_SIZE})`
    );
  }

  // Validate magic
  const magic = new TextDecoder().decode(patch.subarray(0, 8));
  if (magic !== TRDIFF10_MAGIC) {
    throw new Error(`Invalid patch format: expected TRDIFF10, got "${magic}"`);
  }

  const controlLen = offtin(patch, 8);
  const diffLen = offtin(patch, 16);
  const newSize = offtin(patch, 24);

  if (controlLen < 0 || diffLen < 0 || newSize < 0) {
    throw new Error("Corrupt patch: negative length in header");
  }

  const totalCompressed = HEADER_SIZE + controlLen + diffLen;
  if (totalCompressed > patch.byteLength) {
    throw new Error(
      `Corrupt patch: header lengths (${totalCompressed}) exceed file size (${patch.byteLength})`
    );
  }

  return { controlLen, diffLen, newSize };
}

/**
 * Buffered reader over a `ReadableStream` that serves exact byte counts.
 *
 * Wraps a decompression stream output reader to provide `read(n)` semantics:
 * pulls chunks from the underlying stream as needed, buffers leftover bytes,
 * and returns exactly `n` bytes per call.
 */
class BufferedStreamReader {
  private readonly chunks: Uint8Array[] = [];
  private buffered = 0;
  private done = false;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  /**
   * Read exactly `n` bytes from the stream.
   *
   * @param n - Number of bytes to read
   * @returns Uint8Array of exactly `n` bytes
   * @throws {Error} When stream ends before `n` bytes are available
   */
  async read(n: number): Promise<Uint8Array> {
    // Pull from stream until we have enough buffered
    while (this.buffered < n && !this.done) {
      const result = await this.reader.read();
      if (result.done) {
        this.done = true;
        break;
      }
      this.chunks.push(result.value);
      this.buffered += result.value.byteLength;
    }

    if (this.buffered < n) {
      throw new Error(
        `Unexpected end of stream: needed ${n} bytes, have ${this.buffered}`
      );
    }

    // Assemble exactly n bytes from buffered chunks
    const output = new Uint8Array(n);
    let written = 0;

    while (written < n) {
      const front = this.chunks[0];
      if (!front) {
        break;
      }
      const needed = n - written;

      if (front.byteLength <= needed) {
        // Consume entire chunk
        output.set(front, written);
        written += front.byteLength;
        this.buffered -= front.byteLength;
        this.chunks.shift();
      } else {
        // Consume partial chunk, keep remainder
        output.set(front.subarray(0, needed), written);
        this.chunks[0] = front.subarray(needed);
        this.buffered -= needed;
        written = n;
      }
    }

    return output;
  }
}

/**
 * Create a streaming zstd decompressor from a compressed buffer.
 *
 * Pipes the compressed data through `node:zlib`'s zstd decompressor and
 * returns a BufferedStreamReader for on-demand byte consumption.
 *
 * @param compressed - Zstd-compressed data
 * @returns BufferedStreamReader for incremental decompression
 */
function createZstdStreamReader(compressed: Uint8Array): BufferedStreamReader {
  // Convert the node:zlib Transform stream into a Web ReadableStream
  // so BufferedStreamReader can consume it with the same interface.
  const nodeStream = Readable.from(Buffer.from(compressed)).pipe(
    createZstdDecompress()
  );

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },
  });

  return new BufferedStreamReader(
    webStream.getReader() as ReadableStreamDefaultReader<Uint8Array>
  );
}

/** Result of loading the old binary for patching */
type OldFileHandle = {
  /** In-memory view of the old binary */
  data: Uint8Array;
  /** Cleanup function to call after patching (removes temp copy, if any) */
  cleanup: () => void | Promise<void>;
};

/**
 * Load the old binary for read access during patching.
 *
 * Strategy: copy to temp file, then read into memory. The copy avoids
 * ETXTBSY (Linux) / AMFI SIGKILL (macOS) issues with reading the running
 * binary directly. On CoW filesystems (btrfs, xfs, APFS) the copy is a
 * metadata-only reflink (near-instant).
 */
let loadCounter = 0;

async function loadOldBinary(oldPath: string): Promise<OldFileHandle> {
  loadCounter += 1;
  const tempCopy = join(
    tmpdir(),
    `sentry-patch-old-${process.pid}-${loadCounter}`
  );
  try {
    // COPYFILE_FICLONE: attempt CoW reflink first (near-instant on btrfs/xfs/APFS),
    // silently falls back to regular copy on filesystems that don't support it.
    copyFileSync(oldPath, tempCopy, constants.COPYFILE_FICLONE);

    return {
      data: new Uint8Array(await readFile(tempCopy)),
      cleanup: () =>
        unlink(tempCopy).catch(() => {
          /* Best-effort cleanup — OS will reclaim on reboot */
        }),
    };
  } catch {
    // Copy failed — read directly into JS heap
    await unlink(tempCopy).catch(() => {
      /* May not exist if copyFileSync failed */
    });
    return {
      data: new Uint8Array(await readFile(oldPath)),
      cleanup: () => {
        // Data is in JS heap — no temp file to clean up
      },
    };
  }
}

/**
 * Apply a TRDIFF10 binary patch with streaming I/O for minimal memory usage.
 *
 * Copies the old file to a temp path and reads it into memory. Streams
 * diff/extra blocks via `node:zlib` zstd decompressor, writes output via
 * `createWriteStream()`, and computes SHA-256 inline.
 *
 * @param oldPath - Path to the existing (old) binary file
 * @param patchData - Complete TRDIFF10 patch file contents
 * @param destPath - Path to write the patched (new) binary
 * @returns SHA-256 hex digest of the written output
 * @throws {Error} On corrupt patch, I/O failure, or size mismatch
 */
export async function applyPatch(
  oldPath: string,
  patchData: Uint8Array,
  destPath: string
): Promise<string> {
  const { controlLen, diffLen, newSize } = parsePatchHeader(patchData);

  // Slice compressed blocks from the patch buffer
  const controlStart = HEADER_SIZE;
  const diffStart = controlStart + controlLen;
  const extraStart = diffStart + diffLen;

  // Control block is tiny — decompress fully for random access to tuples
  const controlBlock = zstdDecompressSync(
    patchData.subarray(controlStart, diffStart)
  );

  // Diff and extra blocks are streamed — only a few KB in memory at a time
  const diffReader = createZstdStreamReader(
    patchData.subarray(diffStart, extraStart)
  );
  const extraReader = createZstdStreamReader(patchData.subarray(extraStart));

  // Load old binary via copy-then-read (or direct read as fallback).
  const { data: oldFile, cleanup: cleanupOldFile } =
    await loadOldBinary(oldPath);

  // Streaming output: write directly to disk, compute SHA-256 inline
  const writer = createWriteStream(destPath);
  const hasher = createHash("sha256");

  // Capture write errors early — without a listener, Node crashes with
  // ERR_UNHANDLED_ERROR if a write fails (ENOSPC, EIO, etc.) during the loop.
  let writeError: Error | undefined;
  writer.on("error", (err) => {
    writeError ??= err;
  });

  let oldpos = 0;
  let newpos = 0;

  try {
    // Process control entries: each is 3 × i64 = 24 bytes
    for (
      let controlPos = 0;
      controlPos < controlBlock.byteLength;
      controlPos += 24
    ) {
      if (writeError) {
        break;
      }
      const readDiffBy = offtin(controlBlock, controlPos);
      const readExtraBy = offtin(controlBlock, controlPos + 8);
      const seekBy = offtin(controlBlock, controlPos + 16);

      // Step 1: Read diff bytes and add to old file bytes (wrapping u8 add)
      if (readDiffBy > 0) {
        const diffChunk = await diffReader.read(readDiffBy);
        const outputChunk = new Uint8Array(readDiffBy);

        for (let i = 0; i < readDiffBy; i++) {
          // Wrapping unsigned byte addition, matching zig-bsdiff's @addWithOverflow
          outputChunk[i] =
            ((oldFile[oldpos + i] ?? 0) + (diffChunk[i] ?? 0)) % 256;
        }

        writer.write(outputChunk);
        hasher.update(outputChunk);
        oldpos += readDiffBy;
        newpos += readDiffBy;
      }

      // Step 2: Copy extra bytes directly to output (new data)
      if (readExtraBy > 0) {
        const extraChunk = await extraReader.read(readExtraBy);
        writer.write(extraChunk);
        hasher.update(extraChunk);
        newpos += readExtraBy;
      }

      // Step 3: Seek old file position
      oldpos += seekBy;
    }
  } finally {
    try {
      await new Promise<void>((resolve, reject) => {
        writer.end((err?: Error | null) => {
          const finalErr = err ?? writeError;
          if (finalErr) {
            reject(finalErr);
          } else {
            resolve();
          }
        });
      });
    } finally {
      await cleanupOldFile();
    }
  }

  // Validate output size matches header
  if (newpos !== newSize) {
    throw new Error(
      `Output size mismatch: wrote ${newpos} bytes, expected ${newSize}`
    );
  }

  return hasher.digest("hex");
}
