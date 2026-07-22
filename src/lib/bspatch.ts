/**
 * Streaming TRDIFF10 Binary Patch Application
 *
 * Implements the bspatch algorithm for applying binary delta patches in the
 * TRDIFF10 format (produced by zig-bsdiff with `--use-zstd`). Designed for
 * minimal memory usage during CLI self-upgrades:
 *
 * - Old binary: copy to temp file, then read on demand via positional `read()`
 *   (`pread`), so the base never sits fully in the JS heap — only the windows
 *   actually referenced are pulled in, served from the OS page cache
 * - Diff/extra blocks: streamed via zstd `Transform` from `node:zlib`
 * - Output: written incrementally to disk via `createWriteStream()`
 * - Integrity: SHA-256 computed inline via `node:crypto`
 *
 * Multi-patch chains keep every intermediate result in memory and only persist
 * (and hash) the final binary, avoiding the redundant disk write, temp-copy, and
 * SHA-256 pass that a file-by-file chain would incur per hop. The running binary
 * is the only input copied to a temp file. See {@link applyPatchChainInMemory}.
 *
 * The base ("old") bytes are accessed through an {@link OldReader} so the same
 * transform serves both an fd-backed on-disk binary (first hop / single patch)
 * and an in-memory intermediate buffer (subsequent hops).
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
import { type FileHandle, open, readFile, unlink } from "node:fs/promises";
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

  /** Release the underlying stream reader, cancelling any pending reads. */
  async cancel(): Promise<void> {
    try {
      await this.reader.cancel();
    } catch {
      // Stream may already be closed or errored — safe to ignore
    }
    try {
      this.reader.releaseLock();
    } catch {
      // Lock may already be released
    }
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
    cancel() {
      // Destroy the underlying Node.js stream so buffered data events
      // don't fire controller.enqueue() on the now-closed controller.
      nodeStream.destroy();
    },
  });

  return new BufferedStreamReader(
    webStream.getReader() as ReadableStreamDefaultReader<Uint8Array>
  );
}

/**
 * Random-access view of the base ("old") binary during patching.
 *
 * Abstracts over an fd-backed on-disk file (read on demand via `pread`) and an
 * in-memory buffer (a multi-patch intermediate), so {@link transformPatch} can
 * source old bytes the same way regardless of where they live.
 */
type OldReader = {
  /**
   * Read exactly `len` bytes starting at `pos`.
   *
   * Positions outside `[0, size)` are zero-filled, matching the original
   * `oldFile[oldpos + i] ?? 0` semantics (bsdiff seeks can reference offsets
   * past the end, and a negative/oversized seek must read as zeros rather than
   * fail). The returned buffer is always exactly `len` bytes.
   */
  read: (pos: number, len: number) => Promise<Uint8Array>;
  /** Release any held resources (fd, temp copy). Safe to call more than once. */
  close: () => Promise<void>;
};

/**
 * {@link OldReader} backed by an in-memory buffer.
 *
 * Used for multi-patch intermediates, whose bytes already live in the JS heap
 * and must stay there for the next hop's random access.
 */
class MemoryOldReader implements OldReader {
  private readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  read(pos: number, len: number): Promise<Uint8Array> {
    const out = new Uint8Array(len); // zero-filled
    const start = Math.max(pos, 0);
    const end = Math.min(pos + len, this.data.length);
    if (end > start) {
      out.set(this.data.subarray(start, end), start - pos);
    }
    return Promise.resolve(out);
  }

  close(): Promise<void> {
    // Bytes live in the JS heap — nothing to release.
    return Promise.resolve();
  }
}

/**
 * Size of {@link FileOldReader}'s read-ahead cache block (1 MiB).
 *
 * bsdiff references the base mostly forward in many small windows; caching a
 * sliding block of this size collapses thousands of per-window positional reads
 * into roughly `fileSize / BLOCK_SIZE` reads, at a bounded ~1 MiB memory cost.
 */
const OLD_READER_BLOCK_SIZE = 1024 * 1024;

/**
 * {@link OldReader} backed by an open file descriptor, read on demand via
 * positional reads (`pread`) through a single-block read-ahead cache.
 *
 * Keeps the base binary out of the JS heap — only the referenced windows are
 * pulled in, served from the OS page cache populated by the reflink copy. The
 * cache coalesces the many small windowed reads bsdiff performs (mostly forward
 * with occasional jumps) into a handful of block reads, avoiding a per-window
 * syscall storm while staying bounded at {@link OLD_READER_BLOCK_SIZE}.
 */
class FileOldReader implements OldReader {
  private closed = false;
  private readonly handle: FileHandle;
  private readonly size: number;
  private readonly tempPath: string;

  /** Read-ahead block buffer (allocated once, reused across refills). */
  private readonly block: Buffer = Buffer.alloc(OLD_READER_BLOCK_SIZE);
  /** File offset the cached block starts at, or -1 when the cache is empty. */
  private blockStart = -1;
  /** Number of valid bytes currently held in the block. */
  private blockLen = 0;

  constructor(handle: FileHandle, size: number, tempPath: string) {
    this.handle = handle;
    this.size = size;
    this.tempPath = tempPath;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    const out = Buffer.alloc(len); // zero-filled; out-of-range stays zero
    const start = Math.max(pos, 0);
    const end = Math.min(pos + len, this.size);
    if (end <= start) {
      return out; // window is entirely out of range — all zeros
    }

    const need = end - start;
    const outOffset = start - pos;

    if (need > OLD_READER_BLOCK_SIZE) {
      // Window larger than a cache block — read straight into the output and
      // leave the cache untouched (caching it would blow the memory bound).
      await this.readExact(out, outOffset, need, start);
      return out;
    }

    if (!this.blockCovers(start, end)) {
      await this.fillBlock(start);
    }
    out.set(
      this.block.subarray(start - this.blockStart, end - this.blockStart),
      outOffset
    );
    return out;
  }

  /** True when the cached block fully covers `[start, end)`. */
  private blockCovers(start: number, end: number): boolean {
    return (
      this.blockStart >= 0 &&
      start >= this.blockStart &&
      end <= this.blockStart + this.blockLen
    );
  }

  /**
   * Refill the cache block starting at `start`. The length is clamped to the
   * file size; callers only reach here when `[start, end)` fits in one block,
   * and `start + len <= size`, so the read never crosses EOF.
   */
  private async fillBlock(start: number): Promise<void> {
    const len = Math.min(OLD_READER_BLOCK_SIZE, this.size - start);
    await this.readExact(this.block, 0, len, start);
    this.blockStart = start;
    this.blockLen = len;
  }

  /**
   * Read exactly `length` bytes at file offset `filePos` into `buf` at `offset`,
   * looping over short positional reads (possible across some filesystems).
   */
  private async readExact(
    buf: Buffer,
    offset: number,
    length: number,
    filePos: number
  ): Promise<void> {
    let read = 0;
    while (read < length) {
      const { bytesRead } = await this.handle.read(
        buf,
        offset + read,
        length - read,
        filePos + read
      );
      if (bytesRead === 0) {
        break; // Unexpected EOF within bounds — leave remainder as-is
      }
      read += bytesRead;
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.handle.close();
    } catch {
      // fd may already be closed — safe to ignore
    }
    await unlink(this.tempPath).catch(() => {
      /* Best-effort cleanup — OS will reclaim on reboot */
    });
  }
}

/**
 * Open the old binary for on-demand read access during patching.
 *
 * Strategy: copy to a temp file, then read windows on demand via `pread`. The
 * copy avoids ETXTBSY (Linux) / AMFI SIGKILL (macOS) issues with reading the
 * running binary directly; on CoW filesystems (btrfs, xfs, APFS) it is a
 * metadata-only reflink (near-instant). Reading on demand keeps the ~100 MB
 * base out of the JS heap.
 *
 * Falls back to a full in-memory read of the original file if the copy or open
 * fails (rare) — correctness over the memory optimization.
 */
let loadCounter = 0;

async function loadOldBinary(oldPath: string): Promise<OldReader> {
  loadCounter += 1;
  const tempCopy = join(
    tmpdir(),
    `sentry-patch-old-${process.pid}-${loadCounter}`
  );
  // Tracked outside the try so the catch can release a handle that was opened
  // before a later step (e.g. stat) failed — otherwise the fd would leak.
  let handle: FileHandle | undefined;
  try {
    // COPYFILE_FICLONE: attempt CoW reflink first (near-instant on btrfs/xfs/APFS),
    // silently falls back to regular copy on filesystems that don't support it.
    copyFileSync(oldPath, tempCopy, constants.COPYFILE_FICLONE);
    handle = await open(tempCopy, "r");
    const { size } = await handle.stat();
    return new FileOldReader(handle, size, tempCopy);
  } catch {
    // Roll back any partially-acquired resources, then fall back to a direct
    // in-memory read of the original. Close the handle first (if open()
    // succeeded but a later step threw) so it isn't leaked, then drop the
    // temp copy.
    if (handle) {
      await handle.close().catch(() => {
        /* Already closed or never fully opened */
      });
    }
    await unlink(tempCopy).catch(() => {
      /* May not exist if copyFileSync failed */
    });
    return new MemoryOldReader(await readFile(oldPath));
  }
}

/**
 * Wrapping unsigned byte addition (`old + diff mod 256`) for a diff window.
 *
 * This is the hot inner loop of bspatch apply. Doing it byte-at-a-time in JS
 * (two typed-array property accesses + a `% 256` per byte) is the dominant CPU
 * cost on a large binary. We instead process 4 bytes per iteration with a
 * SWAR (SIMD-within-a-register) add on `Uint32Array`:
 *
 *   lows  = (a & 0x7f7f7f7f) + (b & 0x7f7f7f7f)   // top bit of each byte is 0,
 *                                                 // so carries stay in-lane
 *   highs = (a ^ b) & 0x80808080                  // high-bit carry per byte
 *   result = lows ^ highs                         // per-byte sum mod 256
 *
 * This is carry-less (each byte lane sums independently mod 256) and is
 * verified exhaustively (all byte values + every 4-byte alignment + tail 0-3).
 * A short tail loop handles the trailing `n % 4` bytes. The old bytes are read
 * as raw bytes (no `?? 0` per element) because the OldReader already zero-fills
 * out-of-range positions.
 *
 * INVARIANT: the carry masks must match the word width. The low mask clears
 * the top bit of EVERY byte lane and the high mask isolates the top bit of
 * EVERY lane — both are 0x7f7f7f7f / 0x80808080 because words are 32-bit. A
 * wider-word (BigUint64Array) variant must widen BOTH masks to 64-bit
 * (0x7f7f7f7f7f7f7f7f / 0x8080808080808080); pairing 64-bit words with the
 * 32-bit carry mask silently drops carries in the upper 4 bytes and corrupts
 * the output (caught by the exhaustive tests).
 */
export function addDiffChunk(
  output: Uint8Array,
  oldChunk: Uint8Array,
  diffChunk: Uint8Array,
  n: number
): void {
  // The SWAR fast path reinterprets each buffer as Uint32Array, which requires
  // a 4-byte-aligned byteOffset — `new Uint32Array(buf.buffer, byteOffset)`
  // throws RangeError otherwise. Today all callers pass fresh, offset-0 buffers
  // (new Uint8Array(len) / Buffer.alloc(len)), but a future caller could pass a
  // pooled or subarray view. Rather than throw (this is a perf detail that must
  // never break apply), fall back to the byte loop when any buffer is
  // misaligned. Correct for all inputs; the SWAR path is a pure optimization.
  const aligned =
    output.byteOffset % 4 === 0 &&
    oldChunk.byteOffset % 4 === 0 &&
    diffChunk.byteOffset % 4 === 0;

  const words = aligned ? Math.floor(n / 4) : 0;
  if (words > 0) {
    const oldWords = new Uint32Array(
      oldChunk.buffer,
      oldChunk.byteOffset,
      words
    );
    const diffWords = new Uint32Array(
      diffChunk.buffer,
      diffChunk.byteOffset,
      words
    );
    const outWords = new Uint32Array(output.buffer, output.byteOffset, words);
    const LOW = 0x7f_7f_7f_7f;
    const HIGH = 0x80_80_80_80;
    for (let i = 0; i < words; i++) {
      const a = oldWords[i] ?? 0;
      const b = diffWords[i] ?? 0;
      // biome-ignore lint/suspicious/noBitwiseOperators: SWAR per-lane add uses bitmask/xor by design
      const sum = ((a & LOW) + (b & LOW)) ^ ((a ^ b) & HIGH);
      // biome-ignore lint/suspicious/noBitwiseOperators: coerce to uint32
      outWords[i] = sum >>> 0;
    }
  }
  const tailStart = words * 4;
  for (let i = tailStart; i < n; i++) {
    output[i] = ((oldChunk[i] ?? 0) + (diffChunk[i] ?? 0)) % 256;
  }
}

/**
 * Core TRDIFF10 transform.
 *
 * Applies a patch to in-memory old bytes, emitting output chunks in order via
 * `onChunk`. Handles header parsing, streaming zstd decompression of the diff
 * and extra blocks, the wrapping-add reconstruction, and output-size validation.
 *
 * The base bytes are pulled from `oldReader` one diff-window at a time (the
 * algorithm only references the old binary during the diff step), so the caller
 * decides whether they come from disk or memory. Output routing is likewise the
 * caller's choice: `onChunk` writes to disk, hashes, and/or collects into a
 * buffer. The diff/extra decompression readers are always cancelled before
 * returning, even on error. `onChunk` may throw to abort the transform early
 * (used to surface a streaming write failure).
 *
 * @param oldReader - Random-access view of the base ("old") binary
 * @param patchData - Complete TRDIFF10 patch file contents
 * @param onChunk - Receives each output chunk in order; may throw to abort
 * @throws {Error} On corrupt patch, or when output size disagrees with the header
 */
async function transformPatch(
  oldReader: OldReader,
  patchData: Uint8Array,
  onChunk: (chunk: Uint8Array) => void
): Promise<void> {
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
        // Pull exactly the old-file window this step references (zero-filled
        // beyond the file's bounds — see OldReader.read).
        const oldChunk = await oldReader.read(oldpos, readDiffBy);
        const outputChunk = new Uint8Array(readDiffBy);

        // Wrapping unsigned byte addition, matching zig-bsdiff's @addWithOverflow.
        // SWAR on Uint32Array — see addDiffChunk.
        addDiffChunk(outputChunk, oldChunk, diffChunk, readDiffBy);

        onChunk(outputChunk);
        oldpos += readDiffBy;
        newpos += readDiffBy;
      }

      // Step 2: Copy extra bytes directly to output (new data)
      if (readExtraBy > 0) {
        const extraChunk = await extraReader.read(readExtraBy);
        onChunk(extraChunk);
        newpos += readExtraBy;
      }

      // Step 3: Seek old file position
      oldpos += seekBy;
    }
  } finally {
    await Promise.all([diffReader.cancel(), extraReader.cancel()]);
  }

  // Validate output size matches header
  if (newpos !== newSize) {
    throw new Error(
      `Output size mismatch: wrote ${newpos} bytes, expected ${newSize}`
    );
  }
}

/**
 * Apply a patch to the base bytes from `oldReader`, streaming the result to
 * `destPath` while computing its SHA-256.
 *
 * Used for the final hop of a chain (and single-patch upgrades), where the
 * output must be persisted and verified.
 *
 * @param oldReader - Random-access view of the base ("old") binary
 * @param patchData - Complete TRDIFF10 patch file contents
 * @param destPath - Path to write the patched output
 * @returns SHA-256 hex digest of the written output
 * @throws {Error} On corrupt patch, I/O failure, or size mismatch
 */
async function applyReaderToFile(
  oldReader: OldReader,
  patchData: Uint8Array,
  destPath: string
): Promise<string> {
  const writer = createWriteStream(destPath);
  const hasher = createHash("sha256");

  // Capture write errors early — without a listener, Node crashes with
  // ERR_UNHANDLED_ERROR if a write fails (ENOSPC, EIO, etc.) during the loop.
  let writeError: Error | undefined;
  writer.on("error", (err) => {
    writeError ??= err;
  });

  try {
    await transformPatch(oldReader, patchData, (chunk) => {
      // Abort the transform on the first I/O failure. Throwing here unwinds
      // through transformPatch's reader cleanup; the writer is then flushed
      // and the error re-surfaced in the finally below.
      if (writeError) {
        throw writeError;
      }
      writer.write(chunk);
      hasher.update(chunk);
    });
  } finally {
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
  }

  return hasher.digest("hex");
}

/**
 * Apply a patch to the base bytes from `oldReader`, returning the result as a
 * new in-memory buffer.
 *
 * Used for the intermediate hops of a multi-patch chain: the output becomes the
 * base for the next patch without ever touching disk, and no SHA-256 is computed
 * (only the final binary is hashed and verified).
 *
 * @param oldReader - Random-access view of the base ("old") binary
 * @param patchData - Complete TRDIFF10 patch file contents
 * @returns The patched output bytes
 * @throws {Error} On corrupt patch or size mismatch
 */
async function applyReaderToMemory(
  oldReader: OldReader,
  patchData: Uint8Array
): Promise<Uint8Array> {
  // Preallocate the exact output size from the header so chunks can be copied
  // in place — avoids a final concat pass over ~100 MB of output.
  const { newSize } = parsePatchHeader(patchData);
  const output = new Uint8Array(newSize);
  let offset = 0;

  await transformPatch(oldReader, patchData, (chunk) => {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  });

  return output;
}

/**
 * Apply a patch to in-memory old bytes, returning the result as a new buffer.
 *
 * Convenience wrapper over the internal reader-based path for callers that
 * already hold the base bytes in memory (e.g. tests). Production chains use
 * {@link applyPatchChainInMemory}, which reads the on-disk base on demand.
 *
 * @param oldFile - Full contents of the base ("old") binary
 * @param patchData - Complete TRDIFF10 patch file contents
 * @returns The patched output bytes
 * @throws {Error} On corrupt patch or size mismatch
 */
export function applyPatchToMemory(
  oldFile: Uint8Array,
  patchData: Uint8Array
): Promise<Uint8Array> {
  return applyReaderToMemory(new MemoryOldReader(oldFile), patchData);
}

/**
 * Apply a sequence of TRDIFF10 patches, oldest first, writing the final binary
 * to `destPath` and returning its SHA-256.
 *
 * The base binary at `oldPath` is loaded once (copied to a temp file to avoid
 * reading the running executable in place — see {@link loadOldBinary}). Every
 * intermediate result is kept in memory and fed straight into the next patch,
 * so intermediates never hit disk and only the final binary is hashed. This
 * eliminates the N−1 redundant disk writes, temp-copies, and SHA-256 passes a
 * file-by-file chain would incur — and because reads and writes never target
 * the same path, there is no risk of truncating a file that is being read.
 *
 * For a single-patch chain this is equivalent to applying that patch straight
 * to `destPath`.
 *
 * @param oldPath - Path to the base ("old") binary
 * @param patches - Patches to apply in order (oldest first); must be non-empty
 * @param destPath - Path to write the final patched binary
 * @returns SHA-256 hex digest of the final output
 * @throws {Error} When `patches` is empty, or on corrupt patch / I/O / size mismatch
 */
export async function applyPatchChainInMemory(
  oldPath: string,
  patches: Uint8Array[],
  destPath: string
): Promise<string> {
  if (patches.length === 0) {
    throw new Error("Cannot apply an empty patch chain");
  }

  // First hop reads the on-disk base on demand (fd-backed). Subsequent hops
  // read the previous in-memory output. Each reader is closed before the next
  // replaces it; the active one is closed in the finally.
  let reader = await loadOldBinary(oldPath);

  try {
    // Intermediate hops stay entirely in memory — no disk I/O, no hashing.
    for (let i = 0; i < patches.length - 1; i++) {
      const patch = patches[i];
      if (!patch) {
        throw new Error(`Missing patch at index ${i}`);
      }
      const next = await applyReaderToMemory(reader, patch);
      await reader.close();
      reader = new MemoryOldReader(next);
    }

    // Final hop streams to disk and computes the verification hash.
    const finalPatch = patches.at(-1);
    if (!finalPatch) {
      throw new Error("Missing final patch");
    }
    return await applyReaderToFile(reader, finalPatch, destPath);
  } finally {
    await reader.close();
  }
}

/**
 * Apply a single TRDIFF10 binary patch and write the result to `destPath`.
 *
 * Thin wrapper over {@link applyPatchChainInMemory} for the common single-patch
 * case; preserved as the documented entry point for one-shot patch application.
 *
 * @param oldPath - Path to the existing (old) binary file
 * @param patchData - Complete TRDIFF10 patch file contents
 * @param destPath - Path to write the patched (new) binary
 * @returns SHA-256 hex digest of the written output
 * @throws {Error} On corrupt patch, I/O failure, or size mismatch
 */
export function applyPatch(
  oldPath: string,
  patchData: Uint8Array,
  destPath: string
): Promise<string> {
  return applyPatchChainInMemory(oldPath, [patchData], destPath);
}
