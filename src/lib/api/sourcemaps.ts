/**
 * Sourcemap Upload API
 *
 * Implements the Sentry chunk-upload + assemble protocol for
 * artifact bundle uploads. Replaces the `@sentry/cli sourcemaps upload`
 * command with a native TypeScript implementation.
 *
 * Protocol overview:
 * 1. GET  chunk-upload options (chunk size, concurrency, compression)
 * 2. Build artifact bundle ZIP (streaming to disk via {@link ZipWriter})
 * 3. Split ZIP into chunks, compute SHA-1 checksums
 * 4. POST assemble request → server reports missing chunks
 * 5. Upload missing chunks in parallel as multipart/form-data. When the
 *    server advertises a codec in `compression`, chunks are compressed
 *    per-request and the codec is announced via `Content-Encoding`. Codec
 *    preference is `zstd` > `gzip` > plain. Newer servers advertise both;
 *    older servers advertise only `gzip`; the `chunk-upload.no-compression`
 *    kill-switch makes the list empty.
 * 6. Poll assemble endpoint until complete
 */

import { createHash } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
// biome-ignore lint/performance/noNamespaceImport: needed for feature-detected zstd access
import * as zlib from "node:zlib";
import pLimit from "p-limit";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";
import { resolveOrgRegion } from "../region.js";
import { getSdkConfig } from "../sentry-client.js";
import { type ZipCompression, ZipWriter } from "../sourcemap/zip.js";
import { apiRequestToRegion } from "./infrastructure.js";

const gzipAsync = promisify(zlib.gzip);
// zstdCompress is available in Node 22.15+. Feature-detect to avoid crashing
// the npm bundle on older Node versions (e.g., CI runners with Node 20).
// zstdCompress is available in Node 22.15+. Feature-detect to avoid crashing
// the npm bundle on older Node versions (e.g., CI runners with Node 20).
// biome-ignore lint/suspicious/noExplicitAny: zstd types unavailable on older @types/node
const zstdCompressFn = (zlib as any).zstdCompress as
  | ((...args: unknown[]) => unknown)
  | undefined;
const zstdCompressAsync =
  typeof zstdCompressFn === "function"
    ? (promisify(zstdCompressFn) as (
        buf: Buffer,
        opts?: unknown
      ) => Promise<Buffer>)
    : undefined;
const log = logger.withTag("api.sourcemaps");

// ── Schemas ─────────────────────────────────────────────────────────

/** Server-provided chunk upload configuration. */
export const ChunkServerOptionsSchema = z.object({
  /** Absolute URL to upload chunks to. */
  url: z.string(),
  /** Maximum size of a single chunk in bytes. */
  chunkSize: z.number(),
  /** Maximum number of chunks per upload request. */
  chunksPerRequest: z.number(),
  /** Maximum total request body size in bytes. */
  maxRequestSize: z.number(),
  /** Hash algorithm for chunk checksums (always "sha1"). */
  hashAlgorithm: z.string(),
  /** Maximum concurrent upload requests. */
  concurrency: z.number(),
  /** Supported compression methods (e.g., ["gzip"]). */
  compression: z.array(z.string()),
});

export type ChunkServerOptions = z.infer<typeof ChunkServerOptionsSchema>;

/** Response from the artifact bundle assemble endpoint. */
export const AssembleResponseSchema = z.object({
  state: z.enum(["not_found", "created", "assembling", "ok", "error"]),
  missingChunks: z.array(z.string()).optional(),
  detail: z.string().nullable().optional(),
});

export type AssembleResponse = z.infer<typeof AssembleResponseSchema>;

// ── Types ───────────────────────────────────────────────────────────

/** A source file to include in the artifact bundle. */
export type ArtifactFile = {
  /** Filesystem path to the file. */
  path: string;
  /** Debug ID injected into this file (from {@link injectDebugId}). Omitted when uploading without rewriting. */
  debugId?: string;
  /**
   * File type for the manifest.
   * `"minified_source"` for JS files, `"source_map"` for .map files.
   */
  type: "minified_source" | "source_map";
  /**
   * The URL this file will be served at (with `~` prefix convention).
   * Example: `"~/$bunfs/root/bin.js"`
   */
  url: string;
  /**
   * Optional sourcemap reference for the `Sourcemap` header (minified_source entries).
   * Relative URL from the JS file to its map, e.g., `"bin.js.map"` or `"maps/app.js.map"`.
   */
  sourcemapFilename?: string;
};

/** Options for {@link uploadSourcemaps}. */
export type UploadOptions = {
  /** Organization slug. */
  org: string;
  /** Project slug. */
  project: string;
  /** Release version (optional — debug IDs can work without releases). */
  release?: string;
  /** Distribution identifier (optional — disambiguates builds within a release). */
  dist?: string;
  /** Files to upload (must already have debug IDs injected). */
  files: ArtifactFile[];
};

/** Chunk metadata after splitting the ZIP for upload. */
type ChunkInfo = {
  /** SHA-1 checksum of this chunk. */
  sha1: string;
  /** Byte offset in the ZIP file. */
  offset: number;
  /** Byte size of this chunk. */
  size: number;
};

// ── Constants ───────────────────────────────────────────────────────

/** Interval between assemble poll requests. */
const ASSEMBLE_POLL_INTERVAL_MS = 1000;

/** Maximum time to wait for assembly. */
const ASSEMBLE_MAX_WAIT_MS = 300_000;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert a `~`-prefixed URL to the bundle path used inside the ZIP.
 *
 * `"~/foo/bar.js"` → `"_/_/foo/bar.js"`, other URLs get `"_/"` prefix.
 */
function urlToBundlePath(url: string): string {
  return url.startsWith("~/") ? `_/_/${url.slice(2)}` : `_/${url}`;
}

// ── API Functions ───────────────────────────────────────────────────

/**
 * Get chunk upload configuration for an organization.
 *
 * @param orgSlug - Organization slug
 * @returns Server-provided upload options (chunk size, concurrency, etc.)
 */
export async function getChunkUploadOptions(
  orgSlug: string
): Promise<ChunkServerOptions> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion<ChunkServerOptions>(
    regionUrl,
    `organizations/${orgSlug}/chunk-upload/`,
    { schema: ChunkServerOptionsSchema }
  );
  return data;
}

/**
 * Codecs the CLI knows how to emit, in order of preference.
 *
 * `zstd` is the forward-looking codec: advertised only by servers that
 * implement `Content-Encoding`-based detection. `gzip` is the legacy
 * codec supported by every Sentry server since forever; we still send
 * it under the original `file_gzip` multipart field name so that
 * pre-zstd servers -- which ignore `Content-Encoding` -- keep working.
 */
const UPLOAD_CODECS = ["zstd", "gzip"] as const;
export type UploadEncoding = (typeof UPLOAD_CODECS)[number];

/**
 * Select the most efficient upload codec the server advertises, or
 * `undefined` for plain (uncompressed) uploads when the server opts out
 * of compression (e.g. the `chunk-upload.no-compression` kill-switch)
 * or advertises only codecs we don't implement.
 *
 * Exported for testing.
 */
export function pickUploadEncoding(
  compression: string[]
): UploadEncoding | undefined {
  for (const codec of UPLOAD_CODECS) {
    if (compression.includes(codec)) {
      return codec;
    }
  }
  if (compression.length > 0) {
    log.debug(
      `server advertised unsupported codecs [${compression.join(", ")}]; falling back to plain upload`
    );
  }
  return;
}

/**
 * Compress a chunk buffer with the chosen codec. Exported for testing.
 *
 * Both codecs run off-thread via libuv's thread pool, so a chunk
 * being compressed doesn't block the event loop --
 * with `concurrency=8`, eight uploads truly compress in parallel.
 */
export async function encodeChunk(
  buf: Buffer,
  encoding: UploadEncoding | undefined
): Promise<Uint8Array> {
  if (encoding === "zstd" && zstdCompressAsync) {
    // L3 is libzstd's default; passed explicitly for self-documenting
    // code. L9+ trades ~14% size for 4x compress time and forces the
    // server's decoder to allocate 15-30 MiB of window state -- not
    // worth it once decode cost is counted.
    return await zstdCompressAsync(buf, {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 },
    });
  }
  if (encoding === "gzip") {
    // zlib default (L6). Counter-intuitively, lower levels (L1/L5)
    // DEcompress SLOWER on the server (sparser Huffman codes); L9
    // costs ~2x the compress CPU for no meaningful size win.
    return await gzipAsync(buf);
  }
  return buf;
}

/**
 * Read a single chunk from the staging ZIP, compress it with the server's
 * preferred codec, and POST it to the chunk-upload endpoint.
 *
 * Wire format by codec (driven by {@link pickUploadEncoding}):
 *  - `zstd`  -> `Content-Encoding: zstd` + `file` multipart field.
 *               Only works against servers that opted in via
 *               `Content-Encoding` detection (getsentry/sentry#113760+).
 *  - `gzip`  -> LEGACY `file_gzip` multipart field, NO `Content-Encoding`
 *               header. Works with every server that advertises `gzip`,
 *               including pre-zstd self-hosted deployments.
 *  - plain   -> `file` multipart field, no `Content-Encoding`.
 *
 * NB: never emit `Content-Encoding: gzip` alongside the `file_gzip`
 * field -- zstd-aware servers reject that combination (400) to avoid
 * ambiguity.
 */
async function uploadChunk(params: {
  chunk: ChunkInfo;
  tmpZipPath: string;
  encoding: UploadEncoding | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  url: string;
}): Promise<void> {
  const { chunk, tmpZipPath, encoding, fetch: authFetch, url } = params;

  const chunkFh = await open(tmpZipPath, "r");
  let buf: Buffer;
  try {
    buf = Buffer.alloc(chunk.size);
    await chunkFh.read(buf, 0, chunk.size, chunk.offset);
  } finally {
    await chunkFh.close();
  }

  const payload = await encodeChunk(buf, encoding);

  // gzip uses the legacy `file_gzip` field for backwards compatibility
  // with pre-zstd servers; zstd and plain use the standard `file` field.
  const fieldName = encoding === "gzip" ? "file_gzip" : "file";
  const form = new FormData();
  form.append(
    fieldName,
    new Blob([payload], { type: "application/octet-stream" }),
    chunk.sha1
  );

  const init: RequestInit = { method: "POST", body: form };
  if (encoding === "zstd") {
    init.headers = { "Content-Encoding": "zstd" };
  }

  const response = await authFetch(url, init);
  if (!response.ok) {
    throw new ApiError(
      `Chunk upload failed: ${response.status} ${response.statusText}`,
      response.status,
      await response.text().catch(() => ""),
      url
    );
  }
}

/**
 * Build an artifact bundle ZIP at the given path.
 *
 * Streams entries to disk via {@link ZipWriter} — only one file's
 * compressed data is held in memory at a time.
 *
 * @param outputPath - Where to write the ZIP file
 * @param files - Source files and sourcemaps to include
 * @param options.org / project / release - Bundle metadata
 * @param options.compression - ZIP entry compression. Use `"stored"`
 *   when the wire layer will compress the chunks (zstd or gzip);
 *   compressing twice wastes CPU and barely helps wire size.
 *   Defaults to `"deflate"` so callers without a wire codec still
 *   ship reasonably-sized payloads.
 */
export async function buildArtifactBundle(
  outputPath: string,
  files: ArtifactFile[],
  options: {
    org: string;
    project: string;
    release?: string;
    dist?: string;
    compression?: ZipCompression;
  }
): Promise<void> {
  // Build manifest.json
  const filesManifest: Record<
    string,
    {
      url: string;
      type: string;
      headers: Record<string, string>;
    }
  > = {};

  for (const file of files) {
    const bundlePath = urlToBundlePath(file.url);
    const headers: Record<string, string> = {};
    if (file.debugId) {
      headers["debug-id"] = file.debugId;
    }
    if (file.sourcemapFilename) {
      headers.Sourcemap = file.sourcemapFilename;
    }

    filesManifest[bundlePath] = {
      url: file.url,
      type: file.type,
      headers,
    };
  }

  const manifest = JSON.stringify({
    org: options.org,
    project: options.project,
    ...(options.release ? { release: options.release } : {}),
    ...(options.dist ? { dist: options.dist } : {}),
    files: filesManifest,
  });

  // Stream ZIP entries to disk
  const zip = await ZipWriter.create(outputPath, {
    compression: options.compression,
  });
  try {
    await zip.addEntry("manifest.json", Buffer.from(manifest, "utf-8"));

    for (const file of files) {
      const bundlePath = urlToBundlePath(file.url);
      const content = await readFile(file.path);
      await zip.addEntry(bundlePath, content);
    }

    await zip.finalize();
  } catch (error) {
    // Close handle without finalizing on entry write failure
    await zip.close();
    throw error;
  }
}

/**
 * Split a ZIP file into chunks and compute SHA-1 checksums.
 *
 * Reads the file sequentially — only one chunk buffer is live at a time.
 *
 * @param zipPath - Path to the ZIP file
 * @param chunkSize - Size of each chunk in bytes
 * @returns Per-chunk metadata and an overall SHA-1 checksum of the entire file
 */
export async function hashChunks(
  zipPath: string,
  chunkSize: number
): Promise<{ chunks: ChunkInfo[]; overallChecksum: string }> {
  const fh = await open(zipPath, "r");
  try {
    const fileSize = (await stat(zipPath)).size;
    const chunks: ChunkInfo[] = [];
    const overallHasher = createHash("sha1");

    for (let offset = 0; offset < fileSize; offset += chunkSize) {
      const size = Math.min(chunkSize, fileSize - offset);
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, offset);
      const sha1 = createHash("sha1").update(buf).digest("hex");
      overallHasher.update(buf);
      chunks.push({ sha1, offset, size });
    }

    return { chunks, overallChecksum: overallHasher.digest("hex") };
  } finally {
    await fh.close();
  }
}

/**
 * Upload sourcemaps to Sentry using the chunk-upload + assemble protocol.
 *
 * This is the main entry point that orchestrates the full upload flow:
 * build artifact bundle → chunk → upload missing → assemble.
 *
 * @param options - Upload configuration (org, project, release, files)
 * @throws {ApiError} If the upload or assembly fails
 */
export async function uploadSourcemaps(options: UploadOptions): Promise<void> {
  const { org, project, release, dist, files } = options;

  // Step 1: Get chunk upload configuration
  const serverOptions = await getChunkUploadOptions(org);

  // Pick the wire codec up-front so the ZIP can skip its own
  // compression pass when the wire layer will handle it. Re-compressing
  // an already-DEFLATE'd ZIP with zstd/gzip burns CPU for ~0% wire
  // savings; STORED + zstd saves both CPU and a few percent wire bytes.
  // Without a wire codec (kill-switch / unsupported codecs) we keep
  // DEFLATE so the ZIP itself stays small.
  const encoding = pickUploadEncoding(serverOptions.compression);
  const zipCompression: ZipCompression = encoding ? "stored" : "deflate";

  // Step 2: Build artifact bundle ZIP to a temp file, then upload
  const tmpZipPath = join(tmpdir(), `sentry-artifact-bundle-${Date.now()}.zip`);
  try {
    await buildArtifactBundle(tmpZipPath, files, {
      org,
      project,
      release,
      dist,
      compression: zipCompression,
    });
    await uploadArtifactBundle({
      tmpZipPath,
      org,
      project,
      release,
      dist,
      serverOptions,
      encoding,
    });
  } finally {
    // Always clean up the temp file
    await unlink(tmpZipPath).catch(() => {
      // Best-effort cleanup — OS temp directory will eventually purge it
    });
  }
}

/**
 * Upload an already-built artifact bundle ZIP to Sentry.
 *
 * Handles steps 3–6 of the upload protocol: chunk + hash → assemble →
 * upload missing → poll. Separated from {@link uploadSourcemaps} to keep
 * the try/finally cleanup boundary clean.
 */
async function uploadArtifactBundle(opts: {
  tmpZipPath: string;
  org: string;
  project: string;
  release: string | undefined;
  dist: string | undefined;
  serverOptions: ChunkServerOptions;
  encoding: UploadEncoding | undefined;
}): Promise<void> {
  const { tmpZipPath, org, project, release, dist, serverOptions, encoding } =
    opts;
  // Step 3: Split into chunks, hash each chunk + compute overall checksum
  const { chunks, overallChecksum } = await hashChunks(
    tmpZipPath,
    serverOptions.chunkSize
  );

  const regionUrl = await resolveOrgRegion(org);

  // Step 4: Request assembly — server tells us which chunks it needs
  const assembleBody = {
    checksum: overallChecksum,
    chunks: chunks.map((c: ChunkInfo) => c.sha1),
    projects: [project],
    ...(release ? { version: release } : {}),
    ...(dist ? { dist } : {}),
  };

  const assembleEndpoint = `organizations/${org}/artifactbundle/assemble/`;
  const { data: firstAssemble } = await apiRequestToRegion<AssembleResponse>(
    regionUrl,
    assembleEndpoint,
    {
      method: "POST",
      body: assembleBody,
      schema: AssembleResponseSchema,
    }
  );

  // If already assembled, we're done
  if (firstAssemble.state === "ok" || firstAssemble.state === "created") {
    return;
  }

  // Fail fast on server-side assembly error
  if (firstAssemble.state === "error") {
    throw new ApiError(
      "Artifact bundle assembly failed",
      500,
      firstAssemble.detail ?? "Unknown error",
      assembleEndpoint
    );
  }

  // Step 5: Upload missing chunks in parallel
  const missingSet = new Set(firstAssemble.missingChunks ?? []);
  const missingChunks = chunks.filter((c) => missingSet.has(c.sha1));

  if (missingChunks.length > 0) {
    const limit = pLimit(serverOptions.concurrency);
    // Use the CLI's authenticated fetch for chunk uploads
    const { fetch: authFetch } = getSdkConfig(regionUrl);

    await Promise.all(
      missingChunks.map((chunk) =>
        limit(() =>
          uploadChunk({
            chunk,
            tmpZipPath,
            encoding,
            fetch: authFetch,
            url: serverOptions.url,
          })
        )
      )
    );
  }

  // Step 6: Poll assemble endpoint until done
  const deadline = Date.now() + ASSEMBLE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, ASSEMBLE_POLL_INTERVAL_MS));

    const { data: pollResult } = await apiRequestToRegion<AssembleResponse>(
      regionUrl,
      assembleEndpoint,
      {
        method: "POST",
        body: assembleBody,
        schema: AssembleResponseSchema,
      }
    );

    if (pollResult.state === "ok" || pollResult.state === "created") {
      return;
    }

    if (pollResult.state === "error") {
      throw new ApiError(
        "Artifact bundle assembly failed",
        500,
        pollResult.detail ?? "Unknown error",
        assembleEndpoint
      );
    }
    // "not_found" or "assembling" — keep polling
  }

  throw new ApiError(
    "Artifact bundle assembly timed out",
    408,
    `Assembly did not complete within ${ASSEMBLE_MAX_WAIT_MS / 1000}s`,
    assembleEndpoint
  );
}
