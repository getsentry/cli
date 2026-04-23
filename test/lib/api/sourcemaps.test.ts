import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import {
  ChunkServerOptionsSchema,
  encodeChunk,
  pickUploadEncoding,
} from "../../../src/lib/api/sourcemaps.js";

describe("pickUploadEncoding", () => {
  test("prefers zstd when both zstd and gzip are advertised", () => {
    expect(pickUploadEncoding(["gzip", "zstd"])).toBe("zstd");
    expect(pickUploadEncoding(["zstd", "gzip"])).toBe("zstd");
  });

  test("falls back to gzip when zstd is absent", () => {
    expect(pickUploadEncoding(["gzip"])).toBe("gzip");
  });

  test("returns undefined when the server opts out of compression", () => {
    expect(pickUploadEncoding([])).toBeUndefined();
  });

  test("ignores unknown codecs the CLI does not implement", () => {
    expect(pickUploadEncoding(["br", "deflate"])).toBeUndefined();
    expect(pickUploadEncoding(["br", "gzip"])).toBe("gzip");
  });
});

describe("encodeChunk", () => {
  const payload = Buffer.from("hello chunk-upload world".repeat(128));

  test("gzip encoding emits gzip magic bytes and round-trips", async () => {
    const encoded = await encodeChunk(payload, "gzip");
    expect(encoded.byteLength).toBeLessThan(payload.byteLength);
    // gzip magic: 1f 8b
    expect(encoded[0]).toBe(0x1f);
    expect(encoded[1]).toBe(0x8b);
    expect(Buffer.from(gunzipSync(encoded)).equals(payload)).toBe(true);
  });

  test("zstd encoding emits zstd magic bytes and round-trips", async () => {
    const encoded = await encodeChunk(payload, "zstd");
    expect(encoded.byteLength).toBeLessThan(payload.byteLength);
    // zstd magic: 28 b5 2f fd (little-endian 0xFD2FB528)
    expect(encoded[0]).toBe(0x28);
    expect(encoded[1]).toBe(0xb5);
    expect(encoded[2]).toBe(0x2f);
    expect(encoded[3]).toBe(0xfd);
    const decoded = Bun.zstdDecompressSync(encoded);
    expect(Buffer.from(decoded).equals(payload)).toBe(true);
  });

  test("returns the input unchanged when no encoding is selected", async () => {
    const encoded = await encodeChunk(payload, undefined);
    // Plain path returns the same buffer, not a copy.
    expect(encoded).toBe(payload);
  });
});

describe("ChunkServerOptionsSchema", () => {
  test("accepts compression: [] (server opt-out)", () => {
    const result = ChunkServerOptionsSchema.safeParse({
      url: "https://example.com/api/0/organizations/o/chunk-upload/",
      chunkSize: 8_388_608,
      chunksPerRequest: 64,
      maxRequestSize: 33_554_432,
      hashAlgorithm: "sha1",
      concurrency: 8,
      compression: [],
    });
    expect(result.success).toBe(true);
  });

  test("accepts compression with zstd + gzip advertised", () => {
    const result = ChunkServerOptionsSchema.safeParse({
      url: "https://example.com/api/0/organizations/o/chunk-upload/",
      chunkSize: 8_388_608,
      chunksPerRequest: 64,
      maxRequestSize: 33_554_432,
      hashAlgorithm: "sha1",
      concurrency: 8,
      compression: ["gzip", "zstd"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(pickUploadEncoding(result.data.compression)).toBe("zstd");
    }
  });
});
