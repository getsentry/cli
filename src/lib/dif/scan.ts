/**
 * Debug information file scanning and filtering.
 *
 * Walks files and directories for debug information files, parses each via the
 * bundled `symbolic` WASM module, and applies the `debug-files upload` filter
 * rules (`--type`, `--id`, `--no-debug`/`--no-unwind`/`--no-sources`). The pure
 * filter predicates ({@link objectPassesFilters}, {@link normalizeDebugId}) are
 * separated from the I/O ({@link scanPaths}, {@link prepareDifs}) so the matching
 * logic can be property-tested without touching the filesystem.
 *
 * `.zip` archives encountered during a scan are expanded in memory (see
 * {@link ./zip.js}) and their entries run through the same filter pipeline,
 * unless ZIP scanning is disabled via {@link PrepareDifsOptions.scanZips}.
 *
 * Type matching maps the user-facing `--type` value to the canonical object
 * file format reported by the parser (e.g. `dsym`/`macho` → `macho`,
 * `jvm` → `sourcebundle`). This is format-level matching: `--type dsym` and
 * `--type macho` are equivalent here, and the feature filters narrow further.
 */

import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { ValidationError } from "../errors.js";
import { logger } from "../logger.js";
import {
  type DifArchiveInfo,
  type DifObjectInfo,
  parseDebugFile,
  peekFormat,
  selectBundledObject,
} from "./index.js";
import { readZipDifEntries } from "./zip.js";

const log = logger.withTag("dif.scan");

/**
 * Nil debug id (hyphenated UUID form). An object whose debug id starts with
 * this carries no real identifier and cannot be symbolicated, so it is never
 * uploadable. PE/PDB ids may append an `-<age>` suffix, hence prefix matching.
 */
const NIL_DEBUG_ID_PREFIX = "00000000-0000-0000-0000-000000000000";

/**
 * Map of accepted `--type` values to the canonical object file format the
 * parser reports. Multiple type aliases can map to the same format.
 */
const TYPE_TO_FORMAT: Readonly<Record<string, string>> = {
  dsym: "macho",
  macho: "macho",
  elf: "elf",
  pe: "pe",
  pdb: "pdb",
  portablepdb: "portablepdb",
  wasm: "wasm",
  breakpad: "breakpad",
  sourcebundle: "sourcebundle",
  jvm: "sourcebundle",
};

/** Accepted `--type` filter values. */
export const VALID_DIF_TYPES: readonly string[] = Object.keys(TYPE_TO_FORMAT);

/** Resolved filter set applied to each parsed object. */
export type DifFilters = {
  /** Accepted file formats (canonical names), or `undefined` for any. */
  formats?: Set<string>;
  /** Accepted debug ids (normalized), or `undefined` for any. */
  ids?: Set<string>;
  /** Whether a symbol table satisfies the feature requirement. */
  symtab: boolean;
  /** Whether debug info satisfies the feature requirement. */
  debug: boolean;
  /** Whether unwind info satisfies the feature requirement. */
  unwind: boolean;
  /** Whether embedded/referenced sources satisfy the feature requirement. */
  sources: boolean;
};

/** Flag inputs used to build a {@link DifFilters}. */
export type DifFilterOptions = {
  /** Repeatable `--type` values (e.g. `dsym`, `elf`). */
  types?: string[];
  /** Repeatable `--id` values (debug ids). */
  ids?: string[];
  /** `--no-debug`: drop both debug and symbol-table features. */
  noDebug?: boolean;
  /** `--no-unwind`: drop unwind features. */
  noUnwind?: boolean;
  /** `--no-sources`: drop source features. */
  noSources?: boolean;
};

/** A debug information file that passed filtering, ready to upload. */
export type PreparedDif = {
  /** Filesystem path the file was read from. */
  path: string;
  /** Raw file content. */
  content: Buffer;
  /**
   * Advisory debug id of the primary (first debug-info) object among the
   * filter-matched set. This is the same id used as the source bundle's
   * debug id under `--include-sources`, so the bundle's slice matches the
   * slice whose metadata the main DIF advertises.
   */
  debugId?: string;
  /** The objects within the file that passed the filters (for reporting). */
  objects: DifObjectInfo[];
};

/**
 * Normalize a debug id for comparison: trim, lowercase, and strip braces.
 *
 * @param id - A debug id, possibly brace-wrapped or mixed-case.
 * @returns The normalized form.
 */
export function normalizeDebugId(id: string): string {
  return id.trim().toLowerCase().replace(/[{}]/g, "");
}

/**
 * Reduce a normalized debug id to its base UUID, dropping any age/appendix
 * suffix. A standard UUID has 5 hyphen-separated groups; PE/PDB ids append a
 * 6th group (`-<age>`).
 */
function baseDebugId(normalized: string): string {
  const parts = normalized.split("-");
  return parts.length > 5 ? parts.slice(0, 5).join("-") : normalized;
}

/** Whether an object carries a real (non-nil) debug id. */
function hasValidDebugId(obj: DifObjectInfo): boolean {
  const id = normalizeDebugId(obj.debugId);
  return id.length > 0 && !id.startsWith(NIL_DEBUG_ID_PREFIX);
}

/** Whether the object's format is one of the requested types (or no filter). */
function formatMatches(
  objFormat: string,
  formats: Set<string> | undefined
): boolean {
  return !formats || formats.size === 0 || formats.has(objFormat);
}

/**
 * Whether two debug ids refer to the same object, ignoring case, braces, and
 * any PE/PDB age suffix (so a base UUID matches its aged form and vice versa).
 *
 * @param a - First debug id (any casing/form).
 * @param b - Second debug id (any casing/form).
 */
export function debugIdMatches(a: string, b: string): boolean {
  const normA = normalizeDebugId(a);
  const normB = normalizeDebugId(b);
  return normA === normB || baseDebugId(normA) === baseDebugId(normB);
}

/** Whether the object's debug id matches a requested id (or no filter). */
function idMatches(objDebugId: string, ids: Set<string> | undefined): boolean {
  if (!ids || ids.size === 0) {
    return true;
  }
  for (const wanted of ids) {
    if (debugIdMatches(objDebugId, wanted)) {
      return true;
    }
  }
  return false;
}

/** Whether the object carries at least one of the wanted features. */
function featureMatches(obj: DifObjectInfo, filters: DifFilters): boolean {
  return (
    (filters.debug && obj.hasDebugInfo) ||
    (filters.symtab && obj.hasSymbols) ||
    (filters.unwind && obj.hasUnwindInfo) ||
    (filters.sources && obj.hasSources)
  );
}

/**
 * Build a {@link DifFilters} from command flags.
 *
 * `--no-debug` drops both the debug and symbol-table features (matching the
 * legacy `sentry-cli` semantics). At least one feature always remains wanted
 * unless every `--no-*` flag is set, in which case nothing would match.
 *
 * @param options - Raw flag inputs.
 * @returns The resolved filter set.
 * @throws {ValidationError} If a `--type` value is not recognized.
 */
export function buildDifFilters(options: DifFilterOptions): DifFilters {
  let formats: Set<string> | undefined;
  if (options.types && options.types.length > 0) {
    formats = new Set<string>();
    for (const raw of options.types) {
      const type = raw.trim().toLowerCase();
      const format = TYPE_TO_FORMAT[type];
      if (!format) {
        throw new ValidationError(
          `Unknown debug file type '${raw}'. Valid types: ${VALID_DIF_TYPES.join(", ")}`,
          "type"
        );
      }
      formats.add(format);
    }
  }

  let ids: Set<string> | undefined;
  if (options.ids && options.ids.length > 0) {
    ids = new Set(options.ids.map((id) => normalizeDebugId(id)));
  }

  return {
    formats,
    ids,
    symtab: !options.noDebug,
    debug: !options.noDebug,
    unwind: !options.noUnwind,
    sources: !options.noSources,
  };
}

/**
 * Whether a parsed object passes all active filters.
 *
 * An object is included when it (1) has a real debug id, (2) matches the
 * `--type` filter, (3) matches the `--id` filter, and (4) carries at least one
 * wanted feature. Pure and side-effect free.
 *
 * @param obj - The parsed object metadata.
 * @param filters - The resolved filter set.
 */
export function objectPassesFilters(
  obj: DifObjectInfo,
  filters: DifFilters
): boolean {
  return (
    hasValidDebugId(obj) &&
    formatMatches(obj.fileFormat, filters.formats) &&
    idMatches(obj.debugId, filters.ids) &&
    featureMatches(obj, filters)
  );
}

/**
 * Recursively collect every regular file under a path, with cycle-safe
 * symlink-following via visited realpath tracking.
 */
async function collectFiles(
  path: string,
  out: string[],
  visited: Set<string>
): Promise<void> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (err) {
    log.debug(`Skipping unreadable path: ${path}`, err);
    return;
  }

  if (info.isDirectory()) {
    let real: string;
    try {
      real = await realpath(path);
    } catch {
      log.debug(`Could not resolve real path for directory: ${path}`);
      return;
    }
    if (visited.has(real)) {
      log.debug(`Skipping already-visited directory (symlink cycle?): ${path}`);
      return;
    }
    visited.add(real);

    let entries: string[];
    try {
      entries = await readdir(path);
    } catch (err) {
      log.debug(`Skipping unreadable directory: ${path}`, err);
      return;
    }
    for (const entry of entries) {
      await collectFiles(join(path, entry), out, visited);
    }
    return;
  }

  if (info.isFile()) {
    out.push(path);
  }
}

/**
 * Recursively scan paths for candidate files.
 *
 * Each argument may be a file (kept as-is) or a directory (walked
 * recursively). Unreadable entries are skipped with a debug log. Symlinks
 * are followed; cycle-safe via visited-realpath tracking. A path that does
 * not exist at all throws {@link ValidationError} (unlike a walk failure
 * inside a tree, which is silently skipped).
 *
 * @param paths - Files and/or directories to scan.
 * @returns Absolute-or-relative file paths in scan order.
 * @throws {ValidationError} If an explicit path does not exist or cannot be
 *   accessed. Walk-internal failures (entries deep inside a tree) are still
 *   silently skipped.
 */
export async function scanPaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  const visited = new Set<string>();
  for (const path of paths) {
    try {
      await stat(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new ValidationError(`Path '${path}' does not exist.`, "path");
      }
      if (code === "EACCES" || code === "EPERM") {
        throw new ValidationError(
          `Path '${path}' is not readable: ${code}.`,
          "path"
        );
      }
      throw new ValidationError(
        `Cannot access path '${path}': ${code ?? "unknown error"}.`,
        "path"
      );
    }
    await collectFiles(path, files, visited);
  }
  return files;
}

const PEEK_HEADER_BYTES = 4096;

/** A candidate file's recognised format and total size in bytes. */
type PeekResult = {
  /**
   * The container format detected from the header (canonical name, e.g.
   * `elf`, `macho`, `pe`). Never `unknown` (those return `null`).
   */
  format: string;
  /** Total file size in bytes (from the open descriptor's `stat`). */
  size: number;
};

/**
 * Peek at a file's header bytes for format detection — avoids reading the
 * whole file for large non-DIF data. Also reports the total file size (from
 * the open descriptor, so no extra `stat` syscall) so callers can gate on
 * format and size before fully reading the file. Returns `null` when the file
 * is unreadable, empty, or in an unrecognised format.
 */
async function peekHeader(path: string): Promise<PeekResult | null> {
  try {
    const fd = await open(path, "r");
    try {
      const { size } = await fd.stat();
      const buf = Buffer.alloc(PEEK_HEADER_BYTES);
      const { bytesRead } = await fd.read(buf, 0, PEEK_HEADER_BYTES, 0);
      const header =
        bytesRead < PEEK_HEADER_BYTES
          ? new Uint8Array(buf.subarray(0, bytesRead))
          : new Uint8Array(buf);
      if (header.length === 0) {
        return null;
      }
      const format = peekFormat(header);
      if (format === "unknown") {
        return null;
      }
      return { format, size };
    } finally {
      await fd.close();
    }
  } catch (err) {
    log.debug(`Skipping unreadable file: ${path}`, err);
    return null;
  }
}

/** Options controlling {@link prepareDifs} behavior. */
export type PrepareDifsOptions = {
  /**
   * Maximum size, in bytes, of a file to keep. Files larger than this are
   * skipped with a warning. `0` or omitted means no size gate. Mirrors the
   * legacy `dif_upload` `valid_size` check.
   */
  maxFileSize?: number;
  /**
   * Whether to look inside `.zip` archives for debug files. Defaults to `true`
   * (matching the legacy tool); set to `false` for `--no-zips`. Nested archives
   * are never recursed regardless of this setting.
   */
  scanZips?: boolean;
};

/** Result of {@link prepareDifs}: the uploadable files plus skip telemetry. */
export type PrepareDifsResult = {
  /** The files to upload, each with its matched objects and primary id. */
  prepared: PreparedDif[];
  /**
   * Number of recognised debug files skipped solely because they exceeded
   * `maxFileSize`. Lets callers distinguish "nothing found" from "everything
   * found was too large" so they can fail with an accurate message.
   */
  oversizedCount: number;
};

/**
 * Read, parse, and filter candidate files into uploadable debug files.
 *
 * Each candidate is first cheaply inspected via a header-sized read +
 * {@link peekFormat}. Only files whose format is recognised are then fully
 * read and parsed — large non-DIF files (videos, archives) cost only the
 * header I/O and are never fully materialised.
 *
 * After a full read and parse, the file is kept only if at least one
 * contained object passes {@link objectPassesFilters}. Read/parse failures
 * are skipped with a debug log — a scanned tree contains many non-object files.
 *
 * @param paths - Candidate file paths (from {@link scanPaths}).
 * @param filters - The resolved filter set.
 * @param options - Optional size gate (see {@link PrepareDifsOptions}).
 * @returns The uploadable files plus the count of size-skipped files
 *   (see {@link PrepareDifsResult}).
 */
export async function prepareDifs(
  paths: string[],
  filters: DifFilters,
  options: PrepareDifsOptions = {}
): Promise<PrepareDifsResult> {
  const prepared: PreparedDif[] = [];
  const maxFileSize = options.maxFileSize ?? 0;
  const scanZips = options.scanZips ?? true;
  let oversizedCount = 0;

  for (const path of paths) {
    // A `.zip` archive is expanded in place; its entries replace the container,
    // which is itself never parsed as a DIF. `null` means "not a zip" — fall
    // through to normal file handling.
    if (scanZips) {
      const zipResult = await prepareZipDifs(path, filters, maxFileSize);
      if (zipResult) {
        prepared.push(...zipResult.prepared);
        oversizedCount += zipResult.oversizedCount;
        continue;
      }
    }

    const { dif, oversized } = await prepareFileDif(path, filters, maxFileSize);
    if (oversized) {
      oversizedCount += 1;
    }
    if (dif) {
      prepared.push(dif);
    }
  }

  return { prepared, oversizedCount };
}

/**
 * Peek, format-gate, size-gate, and (when matching) read a single on-disk
 * candidate file into a {@link PreparedDif}.
 *
 * The cheap, header-derivable `--type` (format) filter runs before the size
 * gate so `oversized` is reported only for files of a requested format — an
 * oversized file of an unrequested type never triggers an "all matched files
 * too large" outcome. Per-object `--id`/feature filters require a full parse
 * and run in {@link readMatchedDif}.
 *
 * @param path - The candidate file path.
 * @param filters - The resolved filter set.
 * @param maxFileSize - Size gate in bytes (`0` disables it).
 * @returns The prepared DIF (or `null`) and whether it was skipped for size.
 */
async function prepareFileDif(
  path: string,
  filters: DifFilters,
  maxFileSize: number
): Promise<{ dif: PreparedDif | null; oversized: boolean }> {
  const peeked = await peekHeader(path);
  if (!(peeked && formatMatches(peeked.format, filters.formats))) {
    return { dif: null, oversized: false };
  }
  // Gate on size before the full read so an oversized file is never buffered.
  // Only recognised debug files of a requested format reach here, so an
  // oversized skip means a real, requested DIF was too large.
  if (maxFileSize > 0 && peeked.size > maxFileSize) {
    log.warn(
      `Skipping ${path}: size ${peeked.size} exceeds maximum file size ${maxFileSize}`
    );
    return { dif: null, oversized: true };
  }
  return { dif: await readMatchedDif(path, filters), oversized: false };
}

/**
 * Parse an in-memory object buffer and return it as a {@link PreparedDif} when
 * at least one contained object passes the per-object filters, or `null` when
 * the buffer is empty, unparseable, or has no matching object. Pure (no I/O);
 * parse failures are logged at debug level. Shared by the on-disk path
 * ({@link readMatchedDif}) and in-memory ZIP entries
 * ({@link difFromCandidateBuffer}).
 *
 * @param displayPath - Path used for naming and logs (an on-disk path or a
 *   synthetic `"<zip>/<entry>"` path).
 * @param content - The object bytes.
 * @param filters - The resolved filter set.
 */
function difFromBuffer(
  displayPath: string,
  content: Buffer,
  filters: DifFilters
): PreparedDif | null {
  if (content.length === 0) {
    return null;
  }

  let archive: DifArchiveInfo;
  try {
    archive = parseDebugFile(new Uint8Array(content));
  } catch (err) {
    log.debug(`Skipping unparseable file: ${displayPath}`, err);
    return null;
  }

  const matched = archive.objects.filter((obj) =>
    objectPassesFilters(obj, filters)
  );
  if (matched.length === 0) {
    return null;
  }

  return {
    path: displayPath,
    content,
    debugId: selectBundledObject(matched)?.debugId,
    objects: matched,
  };
}

/**
 * Fully read and parse a single candidate file, returning it as a
 * {@link PreparedDif} when at least one contained object passes the per-object
 * filters, or `null` when the file is unreadable, unparseable, empty, or has no
 * matching object. Read/parse failures are logged at debug level — a scanned
 * tree contains many non-object files.
 *
 * @param path - The candidate file path (already format- and size-gated).
 * @param filters - The resolved filter set.
 */
async function readMatchedDif(
  path: string,
  filters: DifFilters
): Promise<PreparedDif | null> {
  let content: Buffer;
  try {
    content = await readFile(path);
  } catch (err) {
    log.debug(`Skipping unreadable file: ${path}`, err);
    return null;
  }
  return difFromBuffer(path, content, filters);
}

/**
 * Format-gate and parse an in-memory ZIP entry into a {@link PreparedDif}.
 *
 * Applies the cheap, header-derivable `--type` (format) filter before invoking
 * the full parser, mirroring the on-disk peek optimization so non-matching
 * entries are not handed to the WASM parser. Returns `null` for unrecognised,
 * non-matching, or non-object entries.
 *
 * @param displayPath - Synthetic `"<zip>/<entry>"` path for naming and logs.
 * @param content - The decompressed entry bytes (already size-gated).
 * @param filters - The resolved filter set.
 */
function difFromCandidateBuffer(
  displayPath: string,
  content: Buffer,
  filters: DifFilters
): PreparedDif | null {
  if (content.length === 0) {
    return null;
  }
  const header =
    content.length > PEEK_HEADER_BYTES
      ? new Uint8Array(content.subarray(0, PEEK_HEADER_BYTES))
      : new Uint8Array(content);
  const format = peekFormat(header);
  if (format === "unknown" || !formatMatches(format, filters.formats)) {
    return null;
  }
  return difFromBuffer(displayPath, content, filters);
}

/**
 * Expand a `.zip` archive at `path` into prepared debug files.
 *
 * Returns `null` when `path` is not a ZIP (the caller then handles it as a
 * normal file). Otherwise extracts each entry (bounded by `maxFileSize`, see
 * {@link readZipDifEntries}) and runs it through {@link difFromCandidateBuffer}.
 * Nested archives are not recursed.
 *
 * @param path - The candidate path (possibly a `.zip`).
 * @param filters - The resolved filter set.
 * @param maxFileSize - Size gate passed through to entry extraction.
 * @returns Matched entries plus oversized telemetry, or `null` when not a ZIP.
 */
async function prepareZipDifs(
  path: string,
  filters: DifFilters,
  maxFileSize: number
): Promise<{ prepared: PreparedDif[]; oversizedCount: number } | null> {
  const zip = await readZipDifEntries(path, { maxFileSize });
  if (!zip) {
    return null;
  }
  const prepared: PreparedDif[] = [];
  for (const entry of zip.entries) {
    const dif = difFromCandidateBuffer(entry.path, entry.content, filters);
    if (dif) {
      prepared.push(dif);
    }
  }
  return { prepared, oversizedCount: zip.oversizedCount };
}
