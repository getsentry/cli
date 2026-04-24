/**
 * Property tests for the zstd-first transport codec.
 *
 * Any input bytes that go through zstd compression must round-trip
 * byte-for-byte when decompressed. Also verifies that string and
 * UTF-8-equivalent Uint8Array inputs produce identical wire output —
 * so the executor's string-vs-bytes normalization is on-spec.
 */

import { describe, expect, test } from "bun:test";
import {
  asyncProperty,
  assert as fcAssert,
  string,
  uint8Array,
} from "fast-check";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

describe("property: zstd round-trip", () => {
  test("Bun.zstdCompress(b) → Bun.zstdDecompress === b for all byte sequences", async () => {
    await fcAssert(
      asyncProperty(
        uint8Array({ minLength: 0, maxLength: 64 * 1024 }),
        async (bytes) => {
          const buf = Buffer.from(bytes);
          const compressed = await Bun.zstdCompress(buf, { level: 3 });
          const decompressed = await Bun.zstdDecompress(compressed);
          expect(Buffer.from(decompressed).equals(buf)).toBe(true);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("level sweep (3, 5, 6, 9) all round-trip identically", async () => {
    await fcAssert(
      asyncProperty(
        uint8Array({ minLength: 64, maxLength: 8 * 1024 }),
        async (bytes) => {
          const buf = Buffer.from(bytes);
          for (const level of [3, 5, 6, 9]) {
            const compressed = await Bun.zstdCompress(buf, { level });
            const decompressed = await Bun.zstdDecompress(compressed);
            expect(Buffer.from(decompressed).equals(buf)).toBe(true);
          }
        }
      ),
      { numRuns: 25 }
    );
  });

  test("string and equivalent Uint8Array inputs produce equal compressed output", async () => {
    await fcAssert(
      asyncProperty(
        string({ minLength: 32, maxLength: 16 * 1024 }),
        async (s) => {
          const fromString = await Bun.zstdCompress(Buffer.from(s, "utf-8"), {
            level: 3,
          });
          const fromBytes = await Bun.zstdCompress(
            new TextEncoder().encode(s),
            {
              level: 3,
            }
          );
          expect(Buffer.from(fromString).equals(Buffer.from(fromBytes))).toBe(
            true
          );
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
