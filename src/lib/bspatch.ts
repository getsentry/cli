/**
 * Streaming TRDIFF10 Binary Patch Application
 *
 * Implements the bspatch algorithm for applying binary delta patches in the
 * TRDIFF10 format (produced by zig-bsdiff with `--use-zstd`). Designed for
 * minimal memory usage during CLI self-upgrades:
 *
 * - Old binary: copy-then-mmap for 0 JS heap (CoW on btrfs/xfs/APFS),
 *   falling back to `arrayBuffer()` if copy/mmap fails
 * - Diff/extra blocks: streamed via `DecompressionStream('zstd')`
 * - Output: written incrementally to disk via `Bun.file().writer()`
 * - Integrity: SHA-256 computed inline via `Bun.CryptoHasher`
 *
 * `Bun.mmap()` cannot target the running binary directly because it opens
 * with PROT_WRITE/O_RDWR:
 * - macOS: AMFI sends uncatchable SIGKILL (writable mapping on signed Mach-O)
 * - Linux: ETXTBSY from `open()` (kernel blocks write-open on running ELF)
 *
 * The copy-then-mmap strategy sidesteps both: the copy is a regular file
 * with no running process, so mmap succeeds. On CoW-capable filesystems
 * (btrfs, xfs, APFS) the copy is near-instant with zero extra disk I/O.
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

import { constants, copyFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
 * Wraps a `DecompressionStream` output reader to provide `read(n)` semantics:
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
 * Wraps the compressed data in a ReadableStream, pipes through
 * DecompressionStream('zstd'), and returns a BufferedStreamReader
 * for on-demand byte consumption.
 *
 * @param compressed - Zstd-compressed data
 * @returns BufferedStreamReader for incremental decompression
 */
function createZstdStreamReader(compressed: Uint8Array): BufferedStreamReader {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  });

  // Bun supports 'zstd' but the standard CompressionFormat type doesn't include it
  const decompressed = input.pipeThrough(
    new DecompressionStream("zstd" as "deflate")
  );

  return new BufferedStreamReader(
    decompressed.getReader() as ReadableStreamDefaultReader<Uint8Array>
  );
}

/** Result of loading the old binary for patching */
type OldFileHandle = {
  /** Memory-mapped or in-memory view of the old binary */
  data: Uint8Array;
  /** Cleanup function to call after patching (removes temp copy, if any) */
  cleanup: () => void | Promise<void>;
};

/**
 * Load the old binary for read access during patching.
 *
 * Strategy: copy to temp file, then try mmap on the copy. The copy is a
 * regular file (no running process), so `Bun.mmap()` succeeds on both
 * Linux and macOS — ETXTBSY (Linux) and AMFI SIGKILL (macOS) only affect
 * the running binary's inode, not a copy. On CoW filesystems (btrfs, xfs,
 * APFS) the copy is a metadata-only reflink (near-instant).
 *
 * Falls back to `Bun.file().arrayBuffer()` (~100 MB heap) if copy or
 * mmap fails for any reason.
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

    // mmap the copy — safe because it's a separate inode, not the running
    // binary. MAP_PRIVATE avoids write-back to disk.
    const data = Bun.mmap(tempCopy, { shared: false });
    return {
      data,
      cleanup: () =>
        unlink(tempCopy).catch(() => {
          /* Best-effort cleanup — OS will reclaim on reboot */
        }),
    };
  } catch {
    // Copy or mmap failed — fall back to reading into JS heap
    await unlink(tempCopy).catch(() => {
      /* May not exist if copyFileSync failed */
    });
    return {
      data: new Uint8Array(await Bun.file(oldPath).arrayBuffer()),
      cleanup: () => {
        // Data is in JS heap — no temp file to clean up
      },
    };
  }
}

/**
 * Apply a TRDIFF10 binary patch with streaming I/O for minimal memory usage.
 *
 * Copies the old file to a temp path and mmaps the copy (0 JS heap), falling
 * back to `arrayBuffer()` if mmap fails. Streams diff/extra blocks via
 * `DecompressionStream('zstd')`, writes output via `Bun.file().writer()`,
 * and computes SHA-256 inline.
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
  const controlBlock = Bun.zstdDecompressSync(
    patchData.subarray(controlStart, diffStart)
  );

  // Diff and extra blocks are streamed — only a few KB in memory at a time
  const diffReader = createZstdStreamReader(
    patchData.subarray(diffStart, extraStart)
  );
  const extraReader = createZstdStreamReader(patchData.subarray(extraStart));

  // Load old binary via copy-then-mmap (0 JS heap) or arrayBuffer fallback.
  // See loadOldBinary() for why direct mmap of the running binary is impossible.
  const { data: oldFile, cleanup: cleanupOldFile } =
    await loadOldBinary(oldPath);

  // Streaming output: write directly to disk, no output buffer in memory
  const writer = Bun.file(destPath).writer();
  const hasher = new Bun.CryptoHasher("sha256");

  let oldpos = 0;
  let newpos = 0;

  try {
    // Process control entries: each is 3 × i64 = 24 bytes
    for (
      let controlPos = 0;
      controlPos < controlBlock.byteLength;
      controlPos += 24
    ) {
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
      await writer.end();
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

  return hasher.digest("hex") as string;
}
