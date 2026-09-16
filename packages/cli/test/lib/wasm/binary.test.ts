/**
 * Tests for the wasm binary envelope.
 *
 * The headline requirement is round-trip fidelity: parsing a module and
 * re-encoding it unchanged must reproduce the input byte-for-byte, including
 * sections this parser does not understand. `wasm-split` shipped a bug here
 * once (symbolicator#311), and it is silent until symbolication fails.
 */

import { describe, expect, test } from "vitest";
import {
  decodeBuildId,
  encodeModule,
  isDebugSection,
  isNameSection,
  makeBuildIdSection,
  makeExternalDebugInfoSection,
  parseSections,
  readVarUint32,
  WasmParseError,
  writeVarUint32,
} from "../../../src/lib/wasm/binary.js";
import {
  byteVector,
  CODE_SECTION_ID,
  concat,
  customSection,
  fromHex,
  section,
  toHex,
  WASM_HEADER,
  wasmModule,
} from "./helpers.js";

describe("readVarUint32 / writeVarUint32", () => {
  test.each([
    0, 1, 127, 128, 624_485, 0xff_ff_ff_ff,
  ])("round-trips %i", (value) => {
    const encoded = writeVarUint32(value);
    expect(readVarUint32(encoded, 0)).toEqual({
      value,
      size: encoded.length,
    });
  });

  test("reads a padded, non-canonical encoding", () => {
    // 0x01 spread over four groups. Legal, and some toolchains emit it.
    expect(readVarUint32(fromHex("81808000"), 0)).toEqual({
      value: 1,
      size: 4,
    });
  });

  test.each([
    ["truncated", "80"],
    ["longer than five groups", "8080808080"],
    ["above 32 bits", "8080808010"],
  ])("rejects an encoding that is %s", (_label, hex) => {
    expect(() => readVarUint32(fromHex(hex), 0)).toThrow(WasmParseError);
  });
});

describe("parseSections", () => {
  test.each([
    ["a buffer that is not a wasm module", fromHex("6e6f742d7761736d")],
    ["a buffer too short to hold a header", fromHex("0061736d")],
    [
      "a section that runs past the end of the buffer",
      concat([WASM_HEADER, fromHex("0020"), fromHex("0102")]),
    ],
  ])("rejects %s", (_label, bytes) => {
    expect(() => parseSections(bytes)).toThrow(WasmParseError);
  });

  test("names custom sections and exposes their bodies", () => {
    const sections = parseSections(
      wasmModule([
        customSection("build_id", byteVector(fromHex("00".repeat(16)))),
      ])
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe(0);
    expect(sections[0]?.name).toBe("build_id");
    expect(toHex(sections[0]?.contents as Uint8Array)).toBe(
      `10${"00".repeat(16)}`
    );
  });

  test("keeps a custom section whose name is unreadable, without a name", () => {
    // Name claims 200 bytes inside a 4-byte section.
    const malformed = section(0, fromHex("c8017f7f"));
    const sections = parseSections(wasmModule([malformed]));
    expect(sections).toHaveLength(1);
    expect(sections[0]?.name).toBeUndefined();
    expect(toHex(encodeModule(sections))).toBe(toHex(wasmModule([malformed])));
  });
});

describe("round-trip fidelity", () => {
  test("preserves a module of known and unknown sections", () => {
    const input = wasmModule([
      section(1, fromHex("60000000")),
      customSection("name", fromHex("deadbeef")),
      section(CODE_SECTION_ID, fromHex("01020304")),
      customSection(".debug_info", fromHex("cafebabe")),
      // A section id no released wasm version defines.
      section(0x7a, fromHex("ff00ff")),
    ]);
    expect(toHex(encodeModule(parseSections(input)))).toBe(toHex(input));
  });

  test("preserves a non-canonical section length prefix", () => {
    // A padded length would be rewritten canonically by a re-encoder that did
    // not retain the original bytes, changing the file for no reason.
    const input = wasmModule([section(CODE_SECTION_ID, fromHex("0102"), 4)]);
    expect(input).toContain(0x80);
    expect(toHex(encodeModule(parseSections(input)))).toBe(toHex(input));
  });
});

describe("custom section encoding", () => {
  test("build_id matches the known-good byte layout", () => {
    const buildId = fromHex("000102030405060708090a0b0c0d0e0f");
    const encoded = encodeModule([makeBuildIdSection(buildId)]);
    expect(toHex(encoded.subarray(WASM_HEADER.length))).toBe(
      // id 0 | payload 26 | name len 8 | "build_id" | vec len 16 | 16 bytes
      "001a086275696c645f696410000102030405060708090a0b0c0d0e0f"
    );
  });

  test("external_debug_info matches the known-good byte layout", () => {
    const encoded = encodeModule([
      makeExternalDebugInfoSection("app.debug.wasm"),
    ]);
    expect(toHex(encoded.subarray(WASM_HEADER.length))).toBe(
      // id 0 | payload 35 | name len 19 | name | str len 14 | "app.debug.wasm"
      "00231365787465726e616c5f64656275675f696e666f0e6170702e64656275672e7761736d"
    );
  });
});

describe("decodeBuildId", () => {
  test.each([
    ["a length prefix that disagrees with the body", "200102"],
    ["a truncated length prefix", "80"],
    ["trailing bytes after the vector", "0201020304"],
  ])("returns null for %s", (_label, hex) => {
    expect(decodeBuildId(fromHex(hex))).toBeNull();
  });
});

describe("section predicates", () => {
  test("classifies debug, name, and ordinary sections", () => {
    const [debugSection, nameSection, producers, code] = parseSections(
      wasmModule([
        customSection(".debug_line", fromHex("00")),
        customSection("name", fromHex("00")),
        customSection("producers", fromHex("00")),
        section(CODE_SECTION_ID, fromHex("00")),
      ])
    );
    expect(isDebugSection(debugSection as never)).toBe(true);
    expect(isNameSection(debugSection as never)).toBe(false);
    expect(isNameSection(nameSection as never)).toBe(true);
    expect(isDebugSection(nameSection as never)).toBe(false);
    expect(isDebugSection(producers as never)).toBe(false);
    expect(isDebugSection(code as never)).toBe(false);
    expect(isNameSection(code as never)).toBe(false);
  });
});
