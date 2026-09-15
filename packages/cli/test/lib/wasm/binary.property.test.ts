/**
 * Property-based tests for the WASM binary reader/writer.
 *
 * The prepare pipeline rewrites modules by concatenating sections it did not
 * decode, so the round-trip invariants here are what make stripping and
 * stamping safe: anything parsed must re-encode to the identical bytes.
 */

import { assert as fcAssert, integer, property, uint8Array } from "fast-check";
import { describe, expect, test } from "vitest";
import {
  encodeModule,
  makeCustomSection,
  parseSections,
  readVarUint32,
  writeVarUint32,
} from "../../../src/lib/wasm/binary.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

/** Largest value the WASM spec allows in a `varuint32`. */
const MAX_U32 = 0xff_ff_ff_ff;

describe("property: LEB128", () => {
  test("round-trips any u32", () => {
    fcAssert(
      property(integer({ min: 0, max: MAX_U32 }), (value) => {
        const encoded = writeVarUint32(value);
        const { value: decoded, offset } = readVarUint32(encoded, 0);
        expect(decoded).toBe(value);
        expect(offset).toBe(encoded.length);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("decodes from a non-zero offset", () => {
    fcAssert(
      property(
        integer({ min: 0, max: MAX_U32 }),
        integer({ min: 1, max: 8 }),
        (value, padding) => {
          const encoded = writeVarUint32(value);
          const buffer = new Uint8Array(padding + encoded.length);
          buffer.set(encoded, padding);
          expect(readVarUint32(buffer, padding).value).toBe(value);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: module round-trip", () => {
  test("parse then encode reproduces the original bytes", () => {
    fcAssert(
      property(uint8Array({ maxLength: 64 }), (payload) => {
        const module = encodeModule([makeCustomSection("scratch", payload)]);
        expect(encodeModule(parseSections(module))).toEqual(module);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("custom section contents survive a round-trip", () => {
    fcAssert(
      property(uint8Array({ maxLength: 64 }), (payload) => {
        const module = encodeModule([makeCustomSection("scratch", payload)]);
        const [section] = parseSections(module);
        expect(section?.name).toBe("scratch");
        expect(section?.contents).toEqual(payload);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
