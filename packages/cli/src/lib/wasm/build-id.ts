/**
 * The `build_id` custom section of a WebAssembly module.
 *
 * Sentry matches a stack frame to its debug file by build id, so every module
 * that might appear in a stack trace needs one — and a module and its debug
 * companion must carry the same one. This module owns generating and reading
 * that id; deciding *which* modules to stamp belongs to the callers.
 *
 * The encoding follows the WebAssembly tool conventions, so ids written here
 * are interchangeable with those written by the Rust `wasm-split`.
 */

import { randomUUID } from "node:crypto";
import { BUILD_ID_SECTION, decodeBuildId, type WasmSection } from "./binary.js";

/** Number of bytes in a UUID, the canonical `build_id` length. */
const UUID_BYTE_LENGTH = 16;

/** Radix used when converting build id bytes to their hex representation. */
const HEX_RADIX = 16;

/** Hyphens in a UUID, stripped before parsing. */
const UUID_SEPARATORS = /-/g;

/** A run of lowercase hex digits, spanning the whole string. */
const HEX_ONLY = /^[0-9a-f]+$/;

/** Render build id bytes as lowercase hex. */
export function formatBuildId(buildId: Uint8Array): string {
  return Array.from(buildId)
    .map((byte) => byte.toString(HEX_RADIX).padStart(2, "0"))
    .join("");
}

/**
 * Parse a UUID string into its 16 raw bytes.
 *
 * @param uuid - A UUID, with or without hyphens, in either case
 * @returns The bytes, or `null` when the string is not a UUID
 */
export function uuidToBytes(uuid: string): Uint8Array | null {
  const hex = uuid.replace(UUID_SEPARATORS, "").toLowerCase();
  if (hex.length !== UUID_BYTE_LENGTH * 2 || !HEX_ONLY.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(UUID_BYTE_LENGTH);
  for (let index = 0; index < UUID_BYTE_LENGTH; index++) {
    bytes[index] = Number.parseInt(
      hex.slice(index * 2, index * 2 + 2),
      HEX_RADIX
    );
  }
  return bytes;
}

/** Generate a random v4 build id. */
export function randomBuildId(): Uint8Array {
  // randomUUID always yields a well-formed v4 UUID, so the parse cannot fail.
  return uuidToBytes(randomUUID()) as Uint8Array;
}

/**
 * Read the build id out of already-parsed sections.
 *
 * The first readable `build_id` wins, and a malformed section is skipped rather
 * than treated as an answer — both matching the Rust tool, where a section that
 * fails to decode never reaches `find_map`. A module should carry at most one
 * id, but the distinction still matters: minting a fresh id for a module that
 * already has a good one would orphan every debug file uploaded against it.
 */
export function buildIdFromSections(
  sections: WasmSection[]
): Uint8Array | null {
  for (const section of sections) {
    if (section.name !== BUILD_ID_SECTION || !section.contents) {
      continue;
    }
    const buildId = decodeBuildId(section.contents);
    if (buildId) {
      return buildId;
    }
  }
  return null;
}
