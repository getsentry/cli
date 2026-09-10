/**
 * Prepare WebAssembly modules for Sentry symbolication.
 *
 * A module compiled with DWARF carries its debug info inline, which is far too
 * large to ship to users and useless to Sentry unless uploaded separately.
 * Preparing a module splits it in two: a `*.debug.wasm` companion retaining
 * every section, and a deployable module with the `.debug_*` sections removed.
 * Both carry the same `build_id`, which is how Sentry matches a stack frame to
 * its debug file.
 *
 * The companion must keep the Code section: DWARF addresses are relative to it,
 * so a companion without it cannot be symbolicated. This mirrors the split
 * performed by Symbolicator's `wasm-split`, so companions produced by either
 * tool are interchangeable in Sentry.
 */

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { logger } from "../logger.js";
import {
  BUILD_ID_SECTION,
  CODE_SECTION_ID,
  DWARF_SECTION_PREFIX,
  decodeBuildId,
  decodeExternalDebugInfo,
  EXTERNAL_DEBUG_INFO_SECTION,
  encodeModule,
  makeBuildIdSection,
  makeExternalDebugInfoSection,
  NAME_SECTION,
  parseSections,
  type WasmSection,
} from "./binary.js";

const log = logger.withTag("wasm.prepare");

/** Number of bytes in a UUID, the canonical `build_id` length. */
const UUID_BYTE_LENGTH = 16;

/** Radix used when converting build id bytes to their hex representation. */
const HEX_RADIX = 16;

/** Suffix identifying a debug companion produced by this command. */
const COMPANION_SUFFIX = ".debug.wasm";

/** Hyphens in a UUID, stripped before parsing. */
const UUID_SEPARATORS = /-/g;

/** A run of lowercase hex digits, spanning the whole string. */
const HEX_ONLY = /^[0-9a-f]+$/;

/** Trailing `.wasm` extension, in any case. */
const WASM_EXTENSION = /\.wasm$/i;

/** How much debug information a module actually carries. */
export type DebugQuality =
  /** Inline DWARF: can be split into a companion. */
  | "dwarf"
  /** Points at an external companion that was not found locally. */
  | "external-debug-info"
  /** Function names only: no line-level symbolication. */
  | "symtab"
  /** No debug information at all. */
  | "none";

/** What preparation did, or would do, to a module. */
export type PrepareAction =
  /** Module was split; a companion was written. */
  | "split"
  /** Module would be split, but `--dry-run` suppressed all writes. */
  | "would-split"
  /** A companion with a matching build id already exists. */
  | "already-prepared"
  /** Module is not splittable; a warning explains why. */
  | "skipped";

/** What a module contains, as far as debug information is concerned. */
export type WasmInspection = {
  /** Classification driving the prepare decision. */
  quality: DebugQuality;
  /** Existing build id, or `null` when the module has none. */
  buildId: Uint8Array | null;
  /** Whether a Code section is present. */
  hasCode: boolean;
  /** URL from `external_debug_info`, if the module carries one. */
  externalDebugInfo: string | null;
};

/** Options controlling a split. */
export type SplitOptions = {
  /** File name to record in `external_debug_info` on the deployable module. */
  companionFileName: string;
  /** Build id to inject when the module has none. Defaults to a random UUID. */
  buildId?: Uint8Array;
  /** Also drop the `name` section from the deployable module. */
  stripNames?: boolean;
};

/** The two modules produced by a split. */
export type SplitOutput = {
  /** Effective build id, whether pre-existing or newly injected. */
  buildId: Uint8Array;
  /** Deployable module: DWARF removed, `external_debug_info` added. */
  stripped: Uint8Array;
  /** Debug companion: every section retained, including Code and DWARF. */
  companion: Uint8Array;
};

/** Outcome of preparing a single module. */
export type PrepareResult = {
  /** Path of the module that was inspected. */
  path: string;
  /** What preparation did. */
  action: PrepareAction;
  /** Debug classification of the module as found on disk. */
  quality: DebugQuality;
  /** Effective build id in hex, absent only when a dry run skipped stamping. */
  buildId?: string;
  /** Path of the companion, when one was written or already existed. */
  companion?: string;
  /** Why the module was skipped, when it was. */
  warning?: string;
  /** What to try next, when the skip looks like a build configuration issue. */
  recommendation?: string;
};

/** Options controlling preparation of one file. */
export type PrepareOptions = {
  /** Inspect and classify without writing anything. */
  dryRun?: boolean;
  /** Directory for companions. Defaults to alongside the input. */
  outDir?: string;
  /** Build id to inject when a module has none. Defaults to a random UUID. */
  buildId?: Uint8Array;
  /** Also drop the `name` section from split deployable modules. */
  stripNames?: boolean;
};

/** Render build id bytes as lowercase hex. */
export function formatBuildId(buildId: Uint8Array): string {
  return Array.from(buildId)
    .map((byte) => byte.toString(HEX_RADIX).padStart(2, "0"))
    .join("");
}

/** Hex digits in a UUID, excluding hyphens. */
const UUID_HEX_LENGTH = UUID_BYTE_LENGTH * 2;

/** Hex-digit counts of a canonical UUID's five hyphen-separated groups. */
const UUID_GROUP_SIZES = [8, 4, 4, 4, 12];

/**
 * Convert a hex build id into the canonical dashed UUID Sentry indexes as the
 * module's debug id.
 *
 * Only the first 16 bytes are significant, mirroring how `symbolic` derives a
 * WASM object's debug id from its `build_id`. Returns `undefined` for a build
 * id too short to form a UUID, in which case callers should omit the advisory
 * id rather than send a malformed one.
 */
export function debugIdFromBuildId(buildId: string): string | undefined {
  if (buildId.length < UUID_HEX_LENGTH) {
    return;
  }
  const hex = buildId.slice(0, UUID_HEX_LENGTH);
  const groups: string[] = [];
  let offset = 0;
  for (const size of UUID_GROUP_SIZES) {
    groups.push(hex.slice(offset, offset + size));
    offset += size;
  }
  return groups.join("-");
}

/**
 * Whether a quality means the module was built with DWARF.
 *
 * Mirrors `DebugQuality::has_dwarf`: a module pointing at an external companion
 * counts, because the debug info exists somewhere even when it was not found
 * locally. This is a statement about the build, not about whether Sentry can
 * reach the debug info — callers that need the latter must also check that the
 * companion resolved.
 */
export function hasDwarfQuality(quality: DebugQuality): boolean {
  return quality === "dwarf" || quality === "external-debug-info";
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
function randomBuildId(): Uint8Array {
  // randomUUID always yields a well-formed v4 UUID, so the parse cannot fail.
  return uuidToBytes(randomUUID()) as Uint8Array;
}

/** Whether a path names a debug companion produced by this command. */
export function isDebugCompanionPath(path: string): boolean {
  return basename(path).toLowerCase().endsWith(COMPANION_SUFFIX);
}

/** Whether a path names a WebAssembly module. */
export function isWasmPath(path: string): boolean {
  return basename(path).toLowerCase().endsWith(".wasm");
}

/**
 * Companion path for a module: `app.wasm` becomes `app.debug.wasm`.
 *
 * @param wasmPath - Path of the input module.
 * @param outDir - Directory to place the companion in, or omitted for
 *   alongside the input.
 */
export function companionPath(wasmPath: string, outDir?: string): string {
  const name = basename(wasmPath).replace(WASM_EXTENSION, "");
  const fileName = `${name}${COMPANION_SUFFIX}`;
  return join(outDir ?? dirname(wasmPath), fileName);
}

/** Whether a section is DWARF debug data. */
function isDwarfSection(section: WasmSection): boolean {
  return section.name?.startsWith(DWARF_SECTION_PREFIX) ?? false;
}

/**
 * Whether a section should be dropped from the deployable module.
 *
 * DWARF always goes. The `name` section only goes when explicitly requested,
 * because runtimes read it to put function names into stack traces. The Code
 * section, `build_id`, and `external_debug_info` always stay.
 */
function isStrippableSection(
  section: WasmSection,
  stripNames: boolean
): boolean {
  if (section.name === NAME_SECTION) {
    return stripNames;
  }
  return isDwarfSection(section);
}

/** Which debug-relevant sections a module turned out to contain. */
type SectionSurvey = {
  hasDwarf: boolean;
  hasNameSection: boolean;
  hasCode: boolean;
  buildId: Uint8Array | null;
  externalDebugInfo: string | null;
};

/** Record what one section contributes to the survey. */
function surveySection(found: SectionSurvey, section: WasmSection): void {
  if (section.id === CODE_SECTION_ID) {
    found.hasCode = true;
  }
  if (!section.contents) {
    return;
  }
  if (section.name === BUILD_ID_SECTION) {
    found.buildId = decodeBuildId(section.contents);
  } else if (section.name === NAME_SECTION) {
    found.hasNameSection = true;
  } else if (section.name === EXTERNAL_DEBUG_INFO_SECTION) {
    found.externalDebugInfo = decodeExternalDebugInfo(section.contents);
  } else if (isDwarfSection(section)) {
    found.hasDwarf = true;
  }
}

/**
 * Reduce a survey to a single quality, best first.
 *
 * Inline DWARF outranks an external pointer, which outranks names alone.
 */
function classifyDebugQuality(found: SectionSurvey): DebugQuality {
  if (found.hasDwarf) {
    return "dwarf";
  }
  if (found.externalDebugInfo) {
    return "external-debug-info";
  }
  return found.hasNameSection ? "symtab" : "none";
}

/**
 * Classify a module's debug information.
 *
 * @param bytes - Complete module bytes.
 * @returns What the module contains.
 * @throws {WasmParseError} If the buffer is not a well-formed module.
 */
export function inspectWasm(bytes: Uint8Array): WasmInspection {
  const found: SectionSurvey = {
    hasDwarf: false,
    hasNameSection: false,
    hasCode: false,
    buildId: null,
    externalDebugInfo: null,
  };

  for (const section of parseSections(bytes)) {
    surveySection(found, section);
  }

  return {
    quality: classifyDebugQuality(found),
    buildId: found.buildId,
    hasCode: found.hasCode,
    externalDebugInfo: found.externalDebugInfo,
  };
}

/**
 * Split a module into a deployable module and a debug companion.
 *
 * The companion is produced *before* stripping, so it retains every section
 * including Code and DWARF, and carries the build id but no
 * `external_debug_info` (it is the debug file, not a pointer to one). Ordering
 * matters here and mirrors `wasm-split`.
 *
 * @param bytes - Complete module bytes.
 * @param options - Companion name and stripping behaviour.
 * @returns The effective build id and both output modules.
 * @throws {WasmParseError} If the buffer is not a well-formed module.
 */
export function splitWasm(
  bytes: Uint8Array,
  options: SplitOptions
): SplitOutput {
  const sections = parseSections(bytes);
  const existing = inspectWasm(bytes).buildId;
  const buildId = existing ?? options.buildId ?? randomBuildId();

  const stamped = existing
    ? sections
    : [...sections, makeBuildIdSection(buildId)];

  const companion = encodeModule(stamped);

  const strippedSections = stamped.filter(
    (section) => !isStrippableSection(section, options.stripNames ?? false)
  );
  strippedSections.push(
    makeExternalDebugInfoSection(options.companionFileName)
  );

  return { buildId, stripped: encodeModule(strippedSections), companion };
}

/**
 * Give a module that will not be split a build id, writing it back in place.
 *
 * `wasm-split` stamps every module it processes regardless of debug quality.
 * Sentry matches a stack frame to its debug file by build id, so an unstamped
 * module can never be symbolicated — not even from a debug file uploaded
 * later. Stamping now keeps that option open.
 *
 * @returns The effective build id, or `null` when a dry run left the module
 *   untouched.
 */
async function ensureBuildId(
  path: string,
  sections: WasmSection[],
  existing: Uint8Array | null,
  options: PrepareOptions
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

/** Read a module's build id from disk, or `null` if it has none/unreadable. */
async function readBuildId(path: string): Promise<Uint8Array | null> {
  try {
    return inspectWasm(await readFile(path)).buildId;
  } catch (error) {
    // A missing or malformed companion simply means "not already prepared".
    log.debug(`No readable build id at ${path}`, error);
    return null;
  }
}

/** Whether two build ids are byte-identical. */
function buildIdsMatch(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!(a && b) || a.length !== b.length) {
    return false;
  }
  return a.every((byte, index) => byte === b[index]);
}

/** Explain why a module of the given quality cannot be split. */
function skipWarning(
  quality: DebugQuality,
  hasBuildId: boolean
): string | null {
  switch (quality) {
    case "dwarf":
      return null;
    case "external-debug-info":
      return "has external_debug_info but no local companion with matching build_id";
    case "symtab":
      return "no line-level symbolication (name/symtab only)";
    default:
      return "no debug information; rebuild with DWARF (Emscripten -g, wasm-pack dwarf-debug-info)";
  }
}

/**
 * Suggest a next step for a skip the build can actually fix.
 *
 * Only missing or insufficient debug info points at the build: a module the
 * compiler never emitted DWARF for, or one carrying names alone. An already
 * stripped module and a dangling companion pointer are pipeline problems, so
 * they get no suggestion here.
 */
function skipRecommendation(
  quality: DebugQuality,
  hasBuildId: boolean
): string | null {
  if (quality === "symtab" || (quality === "none")) {
    return "verify build flags emit DWARF";
  }
  return null;
}

/**
 * Resolve an `external_debug_info` URL to a local path.
 *
 * Remote URLs have no local companion to check, so they resolve to nothing.
 * Relative paths are taken against the module's own directory, which is how the
 * companion filename written during a split is meant to be read.
 */
function resolveExternalDebugPath(
  wasmPath: string,
  url: string
): string | null {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return null;
  }
  return isAbsolute(url) ? url : join(dirname(wasmPath), url);
}

/** An existing companion, and the quality to report for the pair. */
type ExistingCompanion = { companion: string; quality: DebugQuality };

/**
 * Detect a module that has already been prepared.
 *
 * A module counts as prepared when a companion carrying the same build id
 * exists. Re-splitting such a module would replace a good companion with one
 * holding no DWARF, so this check runs before the quality classification.
 *
 * The module's own `external_debug_info` pointer is followed first, so a
 * companion named anything other than `<stem>.debug.wasm` (as `wasm-split` may
 * produce) is still recognized. The conventional path is the fallback.
 */
async function findExistingCompanion(
  wasmPath: string,
  inspection: WasmInspection,
  expectedCompanion: string
): Promise<ExistingCompanion | null> {
  if (!inspection.buildId) {
    return null;
  }

  if (inspection.externalDebugInfo) {
    const referenced = resolveExternalDebugPath(
      wasmPath,
      inspection.externalDebugInfo
    );
    if (
      referenced &&
      buildIdsMatch(await readBuildId(referenced), inspection.buildId)
    ) {
      return { companion: referenced, quality: "external-debug-info" };
    }
  }

  if (buildIdsMatch(await readBuildId(expectedCompanion), inspection.buildId)) {
    return { companion: expectedCompanion, quality: inspection.quality };
  }
  return null;
}

/**
 * Classify and, where possible, split a single `.wasm` file.
 *
 * Modules that cannot be split are stamped with a build id and reported with a
 * warning rather than failing the run, so a scan over a build directory does
 * not stop at the first module lacking DWARF.
 *
 * @param path - Path of the module to prepare.
 * @param options - Dry-run, output directory, and stripping behaviour.
 * @returns What was done, including the companion path when one was produced.
 */
export async function prepareWasmFile(
  path: string,
  options: PrepareOptions = {}
): Promise<PrepareResult> {
  if (isDebugCompanionPath(path)) {
    return {
      path,
      action: "skipped",
      quality: "dwarf",
      warning: "already a debug companion (*.debug.wasm); skipping",
    };
  }

  const bytes = await readFile(path);
  let sections: WasmSection[];
  let inspection: WasmInspection;
  try {
    sections = parseSections(bytes);
    inspection = inspectWasm(bytes);
  } catch (error) {
    return {
      path,
      action: "skipped",
      quality: "none",
      warning: `not a valid WASM module: ${(error as Error).message}`,
    };
  }

  const expectedCompanion = companionPath(path, options.outDir);

  if (inspection.quality !== "dwarf") {
    const existing = await findExistingCompanion(
      path,
      inspection,
      expectedCompanion
    );
    if (existing) {
      return {
        path,
        action: "already-prepared",
        quality: existing.quality,
        buildId: formatBuildId(inspection.buildId as Uint8Array),
        companion: existing.companion,
      };
    }
  }

  const hadBuildId = Boolean(inspection.buildId);
  const warning = skipWarning(inspection.quality, hadBuildId);
  if (warning) {
    const buildId = await ensureBuildId(
      path,
      sections,
      inspection.buildId,
      options
    );
    // Classify against the build id found on disk: stamping happens above, and
    // a freshly stamped module is not an already stripped one.
    const recommendation = skipRecommendation(inspection.quality, hadBuildId);
    return {
      path,
      action: "skipped",
      quality: inspection.quality,
      ...(buildId ? { buildId: formatBuildId(buildId) } : {}),
      warning,
      ...(recommendation ? { recommendation } : {}),
    };
  }

  if (options.dryRun) {
    return {
      path,
      action: "would-split",
      quality: inspection.quality,
      ...(inspection.buildId
        ? { buildId: formatBuildId(inspection.buildId) }
        : {}),
      companion: expectedCompanion,
    };
  }

  const split = splitWasm(bytes, {
    companionFileName: basename(expectedCompanion),
    buildId: options.buildId,
    stripNames: options.stripNames,
  });

  // Write the companion first: if the process dies between the two writes, an
  // orphan companion is recoverable, whereas a stripped module whose DWARF was
  // never saved anywhere is not.
  await writeFile(expectedCompanion, split.companion);
  await writeFile(path, split.stripped);

  return {
    path,
    action: "split",
    quality: inspection.quality,
    buildId: formatBuildId(split.buildId),
    companion: expectedCompanion,
  };
}

/**
 * Path to upload to Sentry for a result, if it produced one.
 *
 * Only split modules yield a debug file. A name/symtab-only module keeps its
 * `name` section in the deployable copy and runtimes resolve function names
 * from it directly, so uploading it would add nothing the stack trace does not
 * already carry.
 */
export function uploadPath(result: PrepareResult): string | null {
  if (result.action === "split" || result.action === "already-prepared") {
    return result.companion ?? null;
  }
  return null;
}
