/**
 * ProGuard/R8 DIF Upload API
 *
 * Builds a ZIP bundle with ProGuard mapping files (named
 * `proguard/<uuid>.txt`) and uploads via the DIF chunk-upload
 * + assemble protocol.
 *
 * Protocol differences from artifact bundles (sourcemaps):
 * - No manifest.json — just the mapping file entries in the ZIP
 * - Assemble endpoint: `projects/{org}/{project}/files/difs/assemble/`
 *   (not `organizations/{org}/artifactbundle/assemble/`)
 * - The assemble body keys each file by its overall checksum, with
 *   per-file metadata (`name`, `debug_id`, `chunks`)
 */

import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";
import { resolveOrgRegion } from "../region.js";
import { type ZipCompression, ZipWriter } from "../sourcemap/zip.js";
import {
  AssembleResponseSchema,
  type ChunkInfo,
  getChunkUploadOptions,
  hashChunks,
  pickUploadEncoding,
  pollAssembly,
  uploadMissingChunks,
} from "./chunk-upload.js";
import { apiRequestToRegion } from "./infrastructure.js";

const log = logger.withTag("api.proguard");

// ── Types ───────────────────────────────────────────────────────────

/** A single ProGuard mapping file to upload. */
export type ProguardMapping = {
  /** Filesystem path (for display/logging). */
  path: string;
  /** The UUID for this mapping (content-derived or user-forced). */
  uuid: string;
  /** Pre-read content buffer (avoids double-read when UUID was computed). */
  content: Buffer;
};

/** Options for {@link uploadProguardMappings}. */
export type ProguardUploadOptions = {
  /** Organization slug. */
  org: string;
  /** Project slug. */
  project: string;
  /** Mapping files to upload. */
  mappings: ProguardMapping[];
  /** Skip event reprocessing after upload. */
  noReprocessing?: boolean;
};

// ── Schemas ─────────────────────────────────────────────────────────

/**
 * DIF assemble response — keyed by overall checksum, each value has
 * the same shape as the standard assemble response.
 */
const DifAssembleResponseSchema = z.record(z.string(), AssembleResponseSchema);

type DifAssembleResponse = z.infer<typeof DifAssembleResponseSchema>;

// ── API Functions ───────────────────────────────────────────────────

/**
 * Build a ProGuard mapping ZIP at the given path.
 *
 * Each mapping is stored as `proguard/<uuid>.txt` inside the ZIP.
 * No manifest.json — Sentry's symbolicator identifies the file type
 * from the `proguard/` path prefix and UUID naming convention.
 *
 * @param outputPath - Where to write the ZIP file
 * @param mappings - Mapping files to include
 * @param options.compression - ZIP entry compression method
 */
export async function buildProguardBundle(
  outputPath: string,
  mappings: ProguardMapping[],
  options: { compression?: ZipCompression }
): Promise<void> {
  const zip = await ZipWriter.create(outputPath, {
    compression: options.compression,
  });
  try {
    for (const mapping of mappings) {
      await zip.addEntry(`proguard/${mapping.uuid}.txt`, mapping.content);
    }
    await zip.finalize();
  } catch (error) {
    await zip.close();
    throw error;
  }
}

/**
 * Upload ProGuard mapping files to Sentry via the DIF chunk-upload protocol.
 *
 * Main orchestrator: build ZIP → chunk → assemble → upload missing → poll.
 *
 * @param options - Upload configuration (org, project, mappings)
 * @throws {ApiError} If the upload or assembly fails
 */
export async function uploadProguardMappings(
  options: ProguardUploadOptions
): Promise<void> {
  const { org, project, mappings } = options;

  // Step 1: Get chunk upload configuration
  const serverOptions = await getChunkUploadOptions(org);

  // Pick wire codec — STORED + wire compression saves double-compress
  const encoding = pickUploadEncoding(serverOptions.compression);
  const zipCompression: ZipCompression = encoding ? "stored" : "deflate";

  // Step 2: Build proguard bundle ZIP to a temp file
  const tmpZipPath = join(tmpdir(), `sentry-proguard-bundle-${Date.now()}.zip`);
  try {
    await buildProguardBundle(tmpZipPath, mappings, {
      compression: zipCompression,
    });
    await uploadProguardBundle({
      tmpZipPath,
      org,
      project,
      mappings,
      serverOptions,
      encoding,
    });
  } finally {
    await unlink(tmpZipPath).catch((error) => {
      log.debug("Failed to clean up temp ZIP", error);
    });
  }
}

/**
 * Upload an already-built ProGuard bundle ZIP to Sentry.
 *
 * Handles steps 3–6 of the upload protocol: chunk + hash → assemble →
 * upload missing → poll. Uses the DIF assemble endpoint which has a
 * per-checksum keyed request/response format.
 */
async function uploadProguardBundle(opts: {
  tmpZipPath: string;
  org: string;
  project: string;
  mappings: ProguardMapping[];
  serverOptions: import("./chunk-upload.js").ChunkServerOptions;
  encoding: import("./chunk-upload.js").UploadEncoding | undefined;
}): Promise<void> {
  const { tmpZipPath, org, project, mappings, serverOptions, encoding } = opts;

  // Step 3: Split into chunks, hash each chunk + compute overall checksum
  const { chunks, overallChecksum } = await hashChunks(
    tmpZipPath,
    serverOptions.chunkSize
  );

  const regionUrl = await resolveOrgRegion(org);

  // Step 4: Request DIF assembly — body is keyed by overall checksum
  // For proguard, we upload a single ZIP containing all mappings. The
  // assemble endpoint accepts one entry per DIF. Since the ZIP is one
  // file, there's exactly one entry keyed by the overall checksum.
  // Use the first mapping's UUID as the debug_id and name; the ZIP
  // itself contains all mappings as separate entries.
  const assembleEndpoint = `projects/${org}/${project}/files/difs/assemble/`;
  const assembleBody: Record<string, unknown> = {};

  // Each mapping gets its own assemble entry keyed by checksum.
  // For a single-mapping upload this is straightforward; for multi-mapping
  // uploads the server processes all entries in the single ZIP.
  assembleBody[overallChecksum] = {
    name:
      mappings.length === 1
        ? `proguard/${mappings[0]?.uuid}.txt`
        : "proguard-mappings.zip",
    debug_id: mappings[0]?.uuid,
    chunks: chunks.map((c: ChunkInfo) => c.sha1),
  };

  const { data: firstAssemble } = await apiRequestToRegion<DifAssembleResponse>(
    regionUrl,
    assembleEndpoint,
    {
      method: "POST",
      body: assembleBody,
      schema: DifAssembleResponseSchema,
    }
  );

  // The DIF response is keyed by checksum — extract our entry
  const assembleResult = firstAssemble[overallChecksum];
  if (!assembleResult) {
    throw new ApiError(
      "DIF assembly failed: no response for checksum",
      500,
      `Checksum ${overallChecksum} not found in response`,
      assembleEndpoint
    );
  }

  // If already assembled, we're done
  if (assembleResult.state === "ok" || assembleResult.state === "created") {
    return;
  }

  // Fail fast on server-side assembly error
  if (assembleResult.state === "error") {
    throw new ApiError(
      "ProGuard mapping assembly failed",
      500,
      assembleResult.detail ?? "Unknown error",
      assembleEndpoint
    );
  }

  // Step 5: Upload missing chunks in parallel
  await uploadMissingChunks({
    chunks,
    missingChecksums: new Set(assembleResult.missingChunks ?? []),
    tmpZipPath,
    serverOptions,
    encoding,
    regionUrl,
  });

  // Step 6: Poll assemble endpoint until done
  // The DIF assemble endpoint uses the per-checksum keyed format, so
  // we need a custom polling loop that extracts our entry from the response.
  await pollDifAssembly({
    regionUrl,
    endpoint: assembleEndpoint,
    body: assembleBody,
    checksum: overallChecksum,
  });
}

/**
 * Poll a DIF assemble endpoint until the server reports completion.
 *
 * Unlike the standard {@link pollAssembly}, the DIF endpoint returns
 * a per-checksum keyed response. This extracts and checks the state
 * of a specific checksum entry.
 */
async function pollDifAssembly(params: {
  regionUrl: string;
  endpoint: string;
  body: unknown;
  checksum: string;
}): Promise<void> {
  const { regionUrl, endpoint, body, checksum } = params;
  // Import constants inline to avoid circular — they're just numbers
  const POLL_INTERVAL_MS = 1000;
  const MAX_WAIT_MS = 300_000;
  const deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const { data: pollResult } = await apiRequestToRegion<DifAssembleResponse>(
      regionUrl,
      endpoint,
      {
        method: "POST",
        body,
        schema: DifAssembleResponseSchema,
      }
    );

    const entry = pollResult[checksum];
    if (!entry) {
      log.debug(`DIF poll: checksum ${checksum} not in response, retrying...`);
      continue;
    }

    if (entry.state === "ok" || entry.state === "created") {
      return;
    }

    if (entry.state === "error") {
      throw new ApiError(
        "ProGuard mapping assembly failed",
        500,
        entry.detail ?? "Unknown error",
        endpoint
      );
    }
    // "not_found" or "assembling" — keep polling
  }

  throw new ApiError(
    "ProGuard mapping assembly timed out",
    408,
    `Assembly did not complete within ${MAX_WAIT_MS / 1000}s`,
    endpoint
  );
}
