/**
 * The `build_id` custom section of a WebAssembly module.
 *
 * Sentry matches a stack frame to its debug file by build id, so every module
 * that might appear in a stack trace needs one — and a module and its debug
 * companion must carry the same one. This module owns generating, reading, and
 * stamping that id; deciding *which* modules to stamp belongs to the callers.
 *
 * The encoding follows the WebAssembly tool conventions, so ids written here
 * are interchangeable with those written by `wasm-split`.
 */

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { logger } from "../logger.js";
import {
  BUILD_ID_SECTION,
  decodeBuildId,
  encodeModule,
  makeBuildIdSection,
  parseSections,
  type WasmSection,
} from "./binary.js";

const log = logger.withTag("wasm.build-id");

/** Number of bytes in a UUID, the canonical `build_id` length. */
export const UUID_BYTE_LENGTH = 16;

/** Radix used when converting build id bytes to their hex representation. */
const HEX_RADIX = 16;

/** Hyphens in a UUID, stripped before parsing. */
const UUID_SEPARATORS = /-/g;

/** A run of lowercase hex digits, spanning the whole string. */
const HEX_ONLY = /^[0-9a-f]+$/;

/** Controls the id a module is stamped with, and whether it is written. */
export type WasmBuildIdOptions = {
  /** Build id to inject when a module has none. Defaults to a random UUID. */
  buildId?: Uint8Array;
  /** Classify only: leave the module on disk untouched. */
  dryRun?: boolean;
};

/** Render build id bytes as lowercase hex. */
export function formatBuildId(buildId: Uint8Array): string {
  return Array.from(buildId)
    .map((byte) => byte.toString(HEX_RADIX).padStart(2, "0"))
    .join("");
}

/**
 * Convert a UUID string to its 16 raw bytes.
 *
 * @param uuid - UUID, with or without hyphens.
 * @returns The raw bytes, or `null` when the input is not a UUID.
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
 * The last `build_id` section wins, matching how a full inspection surveys a
 * module. A module should carry at most one.
 */
export function buildIdFromSections(
  sections: WasmSection[]
): Uint8Array | null {
  let buildId: Uint8Array | null = null;
  for (const section of sections) {
    if (section.name === BUILD_ID_SECTION && section.contents) {
      buildId = decodeBuildId(section.contents);
    }
  }
  return buildId;
}

/**
 * Read a module's build id from disk.
 *
 * @returns The id, or `null` when the file is missing, unparseable, or carries
 *   no readable `build_id`. Callers treat all three the same way: there is no
 *   id here to match against.
 */
export async function readWasmBuildId(
  path: string
): Promise<Uint8Array | null> {
  try {
    return buildIdFromSections(parseSections(await readFile(path)));
  } catch (error) {
    log.debug(`No readable build id at ${path}`, error);
    return null;
  }
}

/**
 * Give a module a build id, writing it back in place when it has none.
 *
 * `wasm-split` stamps every module it processes regardless of debug quality.
 * Sentry matches a stack frame to its debug file by build id, so an unstamped
 * module can never be symbolicated — not even from a debug file uploaded
 * later. Stamping now keeps that option open.
 *
 * @param path - Module to stamp.
 * @param sections - Sections already parsed from that module.
 * @param existing - Id the module already carries, if any.
 * @returns The effective build id, or `null` when a dry run left the module
 *   untouched.
 */
export async function ensureWasmBuildId(
  path: string,
  sections: WasmSection[],
  existing: Uint8Array | null,
  options: WasmBuildIdOptions
): Promise<Uint8Array | null> {
  if (existing) {
    return existing;
  }
  if (options.dryRun) {
    return null;
  }
  const buildId = options.buildId ?? randomBuildId();
  const stamped = [...sections, makeBuildIdSection(buildId)];
  await writeFile(path, encodeModule(stamped));
  return buildId;
}
