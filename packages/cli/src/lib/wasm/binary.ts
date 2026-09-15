/**
 * Minimal WebAssembly binary reader/writer for debug-file preparation.
 *
 * Only the module envelope is parsed: the magic/version header followed by a
 * flat list of sections. Section payloads are kept as raw bytes and re-emitted
 * verbatim, so sections this module does not understand always survive a
 * round-trip untouched. That is what makes it safe to strip or append sections
 * without decoding instructions, types, or relocations.
 *
 * Custom-section encodings follow the WebAssembly tool conventions, matching
 * what Symbolicator's `wasm-split` writes via `wasmbin`:
 *   - `build_id`: a length-prefixed byte vector.
 *   - `external_debug_info`: a length-prefixed UTF-8 string.
 */

import { logger } from "../logger.js";

const log = logger.withTag("wasm");

/** `\0asm` — the four magic bytes that open every WASM module. */
const WASM_MAGIC = Uint8Array.from([0x00, 0x61, 0x73, 0x6d]);

/** Binary format version 1, little-endian. */
const WASM_VERSION = Uint8Array.from([0x01, 0x00, 0x00, 0x00]);

/** Byte length of the magic + version header. */
const HEADER_SIZE = WASM_MAGIC.length + WASM_VERSION.length;

/** Section id used by custom sections. */
const CUSTOM_SECTION_ID = 0;

/** Section id of the Code section. */
export const CODE_SECTION_ID = 10;

/** Custom section holding the module's build id. */
export const BUILD_ID_SECTION = "build_id";

/** Custom section pointing at an external DWARF companion. */
export const EXTERNAL_DEBUG_INFO_SECTION = "external_debug_info";

/** Custom section holding function/local names. */
export const NAME_SECTION = "name";

/** Prefix shared by all DWARF custom sections (`.debug_info`, ...). */
export const DWARF_SECTION_PREFIX = ".debug_";

/**
 * A single section of a WASM module.
 *
 * `bytes` is the complete on-disk encoding (id, length prefix, and payload), so
 * writing it back out reproduces the original byte-for-byte.
 */
export type WasmSection = {
  /** Section id. `0` for custom sections. */
  id: number;
  /** Custom section name, or `null` for a non-custom section. */
  name: string | null;
  /** Payload following the custom section's name, or `null` if not custom. */
  contents: Uint8Array | null;
  /** Complete section encoding, including id and length prefix. */
  bytes: Uint8Array;
};

/** Raised when a buffer is not a well-formed WASM module. */
export class WasmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WasmParseError";
  }
}

/** Maximum bytes a LEB128-encoded `u32` can occupy. */
const MAX_LEB128_U32_BYTES = 5;

/** Number of value bits carried by each LEB128 byte. */
const LEB128_PAYLOAD_BITS = 7;

/**
 * Radix of a LEB128 byte's payload (`2 ** 7`).
 *
 * A byte below this value carries no continuation marker and therefore ends the
 * integer; at or above it, the remainder is the payload and another byte
 * follows. Expressed arithmetically rather than with bit masks to satisfy the
 * repo's no-bitwise-operators rule.
 */
const LEB128_BASE = 2 ** LEB128_PAYLOAD_BITS;

/** Result of reading a LEB128 integer: the value and the next read offset. */
type Leb128Read = { value: number; offset: number };

/**
 * Read an unsigned LEB128 integer.
 *
 * @param bytes - Buffer to read from.
 * @param offset - Byte offset to start at.
 * @returns The decoded value and the offset just past it.
 * @throws {WasmParseError} If the buffer ends mid-integer or the encoding is
 *   longer than a `u32` allows.
 */
export function readVarUint32(bytes: Uint8Array, offset: number): Leb128Read {
  let value = 0;
  let shift = 0;
  let cursor = offset;

  for (let read = 0; read < MAX_LEB128_U32_BYTES; read++) {
    if (cursor >= bytes.length) {
      throw new WasmParseError("Truncated LEB128 integer");
    }
    const byte = bytes[cursor] as number;
    cursor += 1;
    value += (byte % LEB128_BASE) * 2 ** shift;
    if (byte < LEB128_BASE) {
      return { value, offset: cursor };
    }
    shift += LEB128_PAYLOAD_BITS;
  }

  throw new WasmParseError("LEB128 integer too long for a u32");
}

/**
 * Encode an unsigned integer as LEB128.
 *
 * @param value - Non-negative integer to encode.
 * @returns The LEB128 bytes.
 */
export function writeVarUint32(value: number): Uint8Array {
  const out: number[] = [];
  let remaining = value;
  do {
    let byte = remaining % LEB128_BASE;
    remaining = Math.floor(remaining / LEB128_BASE);
    if (remaining !== 0) {
      byte += LEB128_BASE;
    }
    out.push(byte);
  } while (remaining !== 0);
  return Uint8Array.from(out);
}

/** Concatenate byte buffers into one. */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Whether the buffer starts with the WASM magic bytes. */
export function hasWasmMagic(bytes: Uint8Array): boolean {
  if (bytes.length < WASM_MAGIC.length) {
    return false;
  }
  return WASM_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** Decode a length-prefixed UTF-8 string, returning it and the next offset. */
function readName(
  bytes: Uint8Array,
  offset: number
): { name: string; offset: number } {
  const { value: length, offset: afterLength } = readVarUint32(bytes, offset);
  const end = afterLength + length;
  if (end > bytes.length) {
    throw new WasmParseError("Truncated custom section name");
  }
  const name = new TextDecoder().decode(bytes.subarray(afterLength, end));
  return { name, offset: end };
}

/**
 * Split a WASM module into its sections.
 *
 * @param bytes - Complete module bytes.
 * @returns The sections, in file order.
 * @throws {WasmParseError} If the header is missing or a section is truncated.
 */
export function parseSections(bytes: Uint8Array): WasmSection[] {
  if (!hasWasmMagic(bytes)) {
    throw new WasmParseError("Not a WASM module (bad magic)");
  }
  if (bytes.length < HEADER_SIZE) {
    throw new WasmParseError("Truncated WASM header");
  }

  const sections: WasmSection[] = [];
  let cursor = HEADER_SIZE;

  while (cursor < bytes.length) {
    const sectionStart = cursor;
    const id = bytes[cursor] as number;
    cursor += 1;

    const { value: size, offset: payloadStart } = readVarUint32(bytes, cursor);
    const payloadEnd = payloadStart + size;
    if (payloadEnd > bytes.length) {
      throw new WasmParseError(`Truncated section (id ${id})`);
    }

    let name: string | null = null;
    let contents: Uint8Array | null = null;
    if (id === CUSTOM_SECTION_ID) {
      const parsed = readName(bytes, payloadStart);
      name = parsed.name;
      contents = bytes.subarray(parsed.offset, payloadEnd);
    }

    sections.push({
      id,
      name,
      contents,
      bytes: bytes.subarray(sectionStart, payloadEnd),
    });
    cursor = payloadEnd;
  }

  return sections;
}

/** Reassemble a module from its sections, prepending the standard header. */
export function encodeModule(sections: WasmSection[]): Uint8Array {
  return concatBytes([
    WASM_MAGIC,
    WASM_VERSION,
    ...sections.map((section) => section.bytes),
  ]);
}

/**
 * Build a custom section from a name and an already-encoded payload.
 *
 * @param name - Custom section name.
 * @param payload - Section contents, following the name.
 * @returns A section ready to append to a module.
 */
export function makeCustomSection(
  name: string,
  payload: Uint8Array
): WasmSection {
  const nameBytes = new TextEncoder().encode(name);
  const body = concatBytes([
    writeVarUint32(nameBytes.length),
    nameBytes,
    payload,
  ]);
  const bytes = concatBytes([
    Uint8Array.from([CUSTOM_SECTION_ID]),
    writeVarUint32(body.length),
    body,
  ]);
  return { id: CUSTOM_SECTION_ID, name, contents: payload, bytes };
}

/**
 * Build a `build_id` custom section.
 *
 * The payload is a length-prefixed byte vector, matching `wasmbin`'s
 * `CustomSection::BuildId(Vec<u8>)`.
 */
export function makeBuildIdSection(buildId: Uint8Array): WasmSection {
  return makeCustomSection(
    BUILD_ID_SECTION,
    concatBytes([writeVarUint32(buildId.length), buildId])
  );
}

/**
 * Build an `external_debug_info` custom section.
 *
 * The payload is a length-prefixed UTF-8 string, matching `wasmbin`'s
 * `CustomSection::ExternalDebugInfo(Lazy<String>)`.
 */
export function makeExternalDebugInfoSection(url: string): WasmSection {
  const urlBytes = new TextEncoder().encode(url);
  return makeCustomSection(
    EXTERNAL_DEBUG_INFO_SECTION,
    concatBytes([writeVarUint32(urlBytes.length), urlBytes])
  );
}

/** Read the byte vector out of a `build_id` custom section payload. */
export function decodeBuildId(contents: Uint8Array): Uint8Array | null {
  try {
    const { value: length, offset } = readVarUint32(contents, 0);
    if (offset + length > contents.length) {
      return null;
    }
    return contents.subarray(offset, offset + length);
  } catch (error) {
    // A malformed build_id is treated as absent: the module still parses, and
    // callers stamp a fresh id rather than fail the whole run.
    log.debug("Ignoring malformed build_id custom section", error);
    return null;
  }
}

/** Read the URL out of an `external_debug_info` custom section payload. */
export function decodeExternalDebugInfo(contents: Uint8Array): string | null {
  try {
    const { name } = readName(contents, 0);
    return name;
  } catch (error) {
    // Same rationale as decodeBuildId: unreadable metadata should not abort a
    // scan over many modules.
    log.debug("Ignoring malformed external_debug_info custom section", error);
    return null;
  }
}
