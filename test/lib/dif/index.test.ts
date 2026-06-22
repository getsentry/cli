/**
 * Tests for the DIF (debug information file) parser.
 *
 * Uses Breakpad symbol files as fixtures because they are a deterministic,
 * portable TEXT format — no committed binary fixtures or platform-specific
 * system binaries required. The same WASM code path parses Mach-O/ELF/PE/PDB.
 */

import { describe, expect, test } from "vitest";
import { parseDebugFile, peekFormat } from "../../../src/lib/dif/index.js";

/** A minimal, valid Breakpad symbol file with a known debug id + code id. */
const BREAKPAD_FIXTURE = [
  "MODULE Linux x86_64 0F13A5DA412AFBF7C8662048F3294F3D0 example",
  "INFO CODE_ID DAA5130F2A41F7FBC8662048F3294F3D439CA7FF",
  "FUNC 1000 10 0 main",
  "1000 10 42 1",
  "PUBLIC 2000 0 some_symbol",
].join("\n");

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("peekFormat", () => {
  test("detects breakpad", () => {
    expect(peekFormat(toBytes(BREAKPAD_FIXTURE))).toBe("breakpad");
  });

  test("returns unknown for unrecognized data", () => {
    expect(peekFormat(toBytes("not an object file"))).toBe("unknown");
  });

  test("returns unknown for empty input", () => {
    expect(peekFormat(new Uint8Array())).toBe("unknown");
  });
});

describe("parseDebugFile", () => {
  test("extracts metadata from a Breakpad file", () => {
    const archive = parseDebugFile(toBytes(BREAKPAD_FIXTURE));
    expect(archive.fileFormat).toBe("breakpad");
    expect(archive.objects).toHaveLength(1);

    const obj = archive.objects[0];
    expect(obj).toBeDefined();
    expect(obj?.debugId).toBe("0f13a5da-412a-fbf7-c866-2048f3294f3d");
    expect(obj?.codeId).toBe("daa5130f2a41f7fbc8662048f3294f3d439ca7ff");
    expect(obj?.arch).toBe("x86_64");
    expect(obj?.fileFormat).toBe("breakpad");
    expect(obj?.hasSymbols).toBe(true);
  });

  test("normalizes the debug id to lowercase UUID form", () => {
    const archive = parseDebugFile(toBytes(BREAKPAD_FIXTURE));
    expect(archive.objects[0]?.debugId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("is deterministic for the same input", () => {
    const a = parseDebugFile(toBytes(BREAKPAD_FIXTURE));
    const b = parseDebugFile(toBytes(BREAKPAD_FIXTURE));
    expect(a).toEqual(b);
  });

  test("throws on unrecognized data", () => {
    expect(() => parseDebugFile(toBytes("not an object file"))).toThrow();
  });

  test("throws on empty input", () => {
    expect(() => parseDebugFile(new Uint8Array())).toThrow();
  });

  test("renders a nil debug id as the hyphenated nil UUID", () => {
    // Guards the check command's nil-id sentinel against format drift.
    const archive = parseDebugFile(
      toBytes("MODULE Linux x86_64 000000000000000000000000000000000 x")
    );
    expect(archive.objects[0]?.debugId).toBe(
      "00000000-0000-0000-0000-000000000000"
    );
  });
});
