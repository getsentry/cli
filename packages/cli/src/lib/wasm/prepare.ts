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

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { logger } from "../logger.js";
import {
  decodeExternalDebugInfo,
  isCodeSection,
  isDebugSection,
  isExternalDebugInfoSection,
  isNameSection,
  parseSections,
  type WasmSection,
} from "./binary.js";
import {
  buildIdFromSections,
  formatBuildId,
  randomBuildId,
} from "./build-id.js";
import { splitWasm } from "./split.js";
import { ensureBuildIdOnDisk, stampBuildId } from "./stamp.js";

const log = logger.withTag("wasm.prepare");

/** Suffix identifying a debug companion produced by this command. */
const COMPANION_SUFFIX = ".debug.wasm";

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

/** Outcome of a whole `debug-files prepare` run. */
export type PrepareCommandResult = {
  /** Organization slug. Omitted when nothing was uploaded. */
  org?: string;
  /** Project slug. Omitted when nothing was uploaded. */
  project?: string;
  /** Whether companions were actually uploaded. */
  uploaded: boolean;
  /** Per-module outcome. */
  modules: PrepareResult[];
  /** Number of companions uploaded. */
  filesUploaded: number;
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

/** Which debug-relevant sections a module turned out to contain. */
type SectionSurvey = {
  hasDwarf: boolean;
  hasNameSection: boolean;
  hasCode: boolean;
  externalDebugInfo: string | null;
};

/** Record what one section contributes to the survey. */
function surveySection(found: SectionSurvey, section: WasmSection): void {
  if (isCodeSection(section)) {
    found.hasCode = true;
  }
  if (!section.contents) {
    return;
  }
  if (isNameSection(section)) {
    found.hasNameSection = true;
  } else if (isExternalDebugInfoSection(section)) {
    found.externalDebugInfo = decodeExternalDebugInfo(section.contents);
  } else if (isDebugSection(section)) {
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
    externalDebugInfo: null,
  };

  const sections = parseSections(bytes);
  for (const section of sections) {
    surveySection(found, section);
  }

  return {
    quality: classifyDebugQuality(found),
    buildId: buildIdFromSections(sections),
    hasCode: found.hasCode,
    externalDebugInfo: found.externalDebugInfo,
  };
}

/**
 * Read a module's build id off disk.
 *
 * @returns The id, or `null` when the file is missing, unparseable, or carries
 *   no readable `build_id`. Callers treat all three the same way: there is no
 *   id here to match against.
 */
async function readCompanionBuildId(path: string): Promise<Uint8Array | null> {
  try {
    return buildIdFromSections(parseSections(await readFile(path)));
  } catch (error) {
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
function skipWarning(quality: DebugQuality): string | null {
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
function skipRecommendation(quality: DebugQuality): string | null {
  if (quality === "symtab" || quality === "none") {
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
      buildIdsMatch(await readCompanionBuildId(referenced), inspection.buildId)
    ) {
      return { companion: referenced, quality: "external-debug-info" };
    }
  }

  if (
    buildIdsMatch(
      await readCompanionBuildId(expectedCompanion),
      inspection.buildId
    )
  ) {
    return { companion: expectedCompanion, quality: inspection.quality };
  }
  return null;
}

/**
 * Stamp a module that cannot be split, and report why it was left alone.
 *
 * @returns The skip, carrying the build id the module ends up with unless a
 *   dry run left it unstamped, or `null` when the module is splittable.
 */
async function reportSkip(
  path: string,
  bytes: Uint8Array,
  inspection: WasmInspection,
  options: PrepareOptions
): Promise<PrepareResult | null> {
  const warning = skipWarning(inspection.quality);
  if (!warning) {
    return null;
  }
  const buildId = await ensureBuildIdOnDisk(
    path,
    bytes,
    inspection.buildId,
    options
  );
  const recommendation = skipRecommendation(inspection.quality);
  return {
    path,
    action: "skipped",
    quality: inspection.quality,
    ...(buildId ? { buildId: formatBuildId(buildId) } : {}),
    warning,
    ...(recommendation ? { recommendation } : {}),
  };
}

/**
 * Give a module and the companion it names a shared build id.
 *
 * A module carrying `external_debug_info` but no build id was split by a tool
 * that never stamped it. The pair is intact apart from the id Sentry matches
 * on, so it is repairable — and stamping the module alone would make it
 * unrepairable, since a random id can never be reconciled with the companion.
 *
 * The companion is written first. A crash between the two writes then leaves
 * the module unstamped, which the next run repairs; the reverse order would
 * leave a stamped module pointing at an unstamped companion, which reads as a
 * dangling pointer forever after.
 *
 * @returns The repaired pair, or `null` when there is nothing to repair and
 *   the caller should fall through to the normal skip path.
 */
async function repairUnpairedCompanion(
  wasmPath: string,
  bytes: Uint8Array,
  inspection: WasmInspection,
  options: PrepareOptions
): Promise<PrepareResult | null> {
  if (!inspection.externalDebugInfo) {
    return null;
  }
  const companion = resolveExternalDebugPath(
    wasmPath,
    inspection.externalDebugInfo
  );
  // A remote URL names no file this run can stamp.
  if (!companion) {
    return null;
  }

  let companionBytes: Uint8Array;
  let companionInspection: WasmInspection;
  try {
    companionBytes = await readFile(companion);
    companionInspection = inspectWasm(companionBytes);
  } catch (error) {
    log.debug(`No usable companion at ${companion}`, error);
    return null;
  }

  // Without DWARF the companion is not a debug file, so pairing with it would
  // upload nothing useful under an id the module now claims.
  if (companionInspection.quality !== "dwarf") {
    return null;
  }

  const adopted = companionInspection.buildId;
  const buildId = adopted ?? options.buildId ?? randomBuildId();

  if (options.dryRun) {
    return {
      path: wasmPath,
      action: "already-prepared",
      quality: "external-debug-info",
      // A generated id does not exist yet; only report one already on disk.
      ...(adopted ? { buildId: formatBuildId(adopted) } : {}),
      companion,
      warning: "would reconcile build_id with companion",
    };
  }

  if (!adopted) {
    await writeFile(companion, stampBuildId(companionBytes, buildId).module);
  }
  await writeFile(wasmPath, stampBuildId(bytes, buildId).module);

  return {
    path: wasmPath,
    action: "already-prepared",
    quality: "external-debug-info",
    buildId: formatBuildId(buildId),
    companion,
    warning: adopted
      ? "reconciled build_id with companion"
      : "reconciled build_id with companion (stamped both files)",
  };
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
  let inspection: WasmInspection;
  try {
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

  // Repair before skipping: an unstamped module with a companion is a pair a
  // previous tool left half-finished, not a module that cannot be prepared.
  if (!inspection.buildId && inspection.quality === "external-debug-info") {
    const repaired = await repairUnpairedCompanion(
      path,
      bytes,
      inspection,
      options
    );
    if (repaired) {
      return repaired;
    }
  }

  const skipped = await reportSkip(path, bytes, inspection, options);
  if (skipped) {
    return skipped;
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
    companion: true,
    strip: true,
    ...(options.buildId ? { buildId: options.buildId } : {}),
    stripNames: options.stripNames ?? false,
    externalDebugInfo: basename(expectedCompanion),
  });

  // Write the companion first: if the process dies between the two writes, an
  // orphan companion is recoverable, whereas a stripped module whose DWARF was
  // never saved anywhere is not.
  await writeFile(expectedCompanion, split.companion as Uint8Array);
  await writeFile(path, split.module);

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
