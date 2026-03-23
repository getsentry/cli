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
 * 5. Upload missing chunks in parallel (gzip-compressed, multipart/form-data)
 * 6. Poll assemble endpoint until complete
 */

import { createHash } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip as gzipCb } from "node:zlib";
import pLimit from "p-limit";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { resolveOrgRegion } from "../region.js";
import { getSdkConfig } from "../sentry-client.js";
import { ZipWriter } from "../sourcemap/zip.js";
import { apiRequestToRegion } from "./infrastructure.js";

const gzipAsync = promisify(gzipCb);

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
  /** Debug ID injected into this file (from {@link injectDebugId}). */
  debugId: string;
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
   * Optional associated sourcemap filename (for minified_source entries).
   * Just the basename, e.g., `"bin.js.map"`.
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
  /** Files to upload (must already have debug IDs injected). */
  files: ArtifactFile[];
  /**
   * Auth token for the Sentry API. If not provided, uses the
   * authenticated fetch from the CLI's auth system.
   */
  authToken?: string;
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
 * Build an artifact bundle ZIP at the given path.
 *
 * Streams entries to disk via {@link ZipWriter} — only one file's
 * compressed data is held in memory at a time.
 *
 * @param outputPath - Where to write the ZIP file
 * @param files - Source files and sourcemaps to include
 * @param options - Bundle metadata (org, project, release)
 */
export async function buildArtifactBundle(
  outputPath: string,
  files: ArtifactFile[],
  options: { org: string; project: string; release?: string }
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
    // Convert URL to bundle path: ~/foo/bar.js → _/_/foo/bar.js
    const bundlePath = file.url.startsWith("~/")
      ? `_/_/${file.url.slice(2)}`
      : `_/${file.url}`;

    const headers: Record<string, string> = {
      "debug-id": file.debugId,
    };
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
    files: filesManifest,
  });

  // Stream ZIP entries to disk
  const zip = await ZipWriter.create(outputPath);
  await zip.addEntry("manifest.json", Buffer.from(manifest, "utf-8"));

  for (const file of files) {
    const bundlePath = file.url.startsWith("~/")
      ? `_/_/${file.url.slice(2)}`
      : `_/${file.url}`;
    const content = await readFile(file.path);
    await zip.addEntry(bundlePath, content);
  }

  await zip.finalize();
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
  const { org, project, release, files } = options;

  // Step 1: Get chunk upload configuration
  const serverOptions = await getChunkUploadOptions(org);

  // Step 2: Build artifact bundle ZIP to a temp file
  const tmpZipPath = join(tmpdir(), `sentry-artifact-bundle-${Date.now()}.zip`);
  await buildArtifactBundle(tmpZipPath, files, { org, project, release });

  try {
    await uploadArtifactBundle({
      tmpZipPath,
      org,
      project,
      release,
      serverOptions,
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
  serverOptions: ChunkServerOptions;
}): Promise<void> {
  const { tmpZipPath, org, project, release, serverOptions } = opts;
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

  // Step 5: Upload missing chunks in parallel
  const missingSet = new Set(firstAssemble.missingChunks ?? []);
  const missingChunks = chunks.filter((c) => missingSet.has(c.sha1));

  if (missingChunks.length > 0) {
    const limit = pLimit(serverOptions.concurrency);
    const useGzip = serverOptions.compression.includes("gzip");
    // Use the CLI's authenticated fetch for chunk uploads
    const { fetch: authFetch } = getSdkConfig(regionUrl);

    await Promise.all(
      missingChunks.map((chunk) =>
        limit(async () => {
          const chunkFh = await open(tmpZipPath, "r");
          let buf: Buffer;
          try {
            buf = Buffer.alloc(chunk.size);
            await chunkFh.read(buf, 0, chunk.size, chunk.offset);
          } finally {
            await chunkFh.close();
          }

          const payload = useGzip ? await gzipAsync(buf) : buf;
          const fieldName = useGzip ? "file_gzip" : "file";

          const form = new FormData();
          form.append(
            fieldName,
            new Blob([payload], { type: "application/octet-stream" }),
            chunk.sha1
          );

          const response = await authFetch(serverOptions.url, {
            method: "POST",
            body: form,
          });

          if (!response.ok) {
            throw new ApiError(
              `Chunk upload failed: ${response.status} ${response.statusText}`,
              response.status,
              await response.text().catch(() => ""),
              serverOptions.url
            );
          }
        })
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
