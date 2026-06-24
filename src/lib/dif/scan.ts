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

/**
 * Peek at a file's header bytes for format detection — avoids reading the
 * whole file for large non-DIF data. Returns `null` when the file is
 * unreadable, empty, or in an unrecognised format.
 */
async function peekHeader(path: string): Promise<Uint8Array | null> {
  try {
    const fd = await open(path, "r");
    try {
      const buf = Buffer.alloc(PEEK_HEADER_BYTES);
      const { bytesRead } = await fd.read(buf, 0, PEEK_HEADER_BYTES, 0);
      const header =
        bytesRead < PEEK_HEADER_BYTES
          ? new Uint8Array(buf.subarray(0, bytesRead))
          : new Uint8Array(buf);
      if (header.length === 0 || peekFormat(header) === "unknown") {
        return null;
      }
      return header;
    } finally {
      await fd.close();
    }
  } catch (err) {
    log.debug(`Skipping unreadable file: ${path}`, err);
    return null;
  }
}

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
 * @returns The files to upload, each with its matched objects and primary id.
 */
export async function prepareDifs(
  paths: string[],
  filters: DifFilters
): Promise<PreparedDif[]> {
  const prepared: PreparedDif[] = [];

  for (const path of paths) {
    if (!(await peekHeader(path))) {
      continue;
    }

    let content: Buffer;
    try {
      content = await readFile(path);
    } catch (err) {
      log.debug(`Skipping unreadable file: ${path}`, err);
      continue;
    }
    if (content.length === 0) {
      continue;
    }

    const data = new Uint8Array(content);
    let archive: DifArchiveInfo;
    try {
      archive = parseDebugFile(data);
    } catch (err) {
      log.debug(`Skipping unparseable file: ${path}`, err);
      continue;
    }

    const matched = archive.objects.filter((obj) =>
      objectPassesFilters(obj, filters)
    );
    if (matched.length === 0) {
      continue;
    }

    prepared.push({
      path,
      content,
      debugId: selectBundledObject(matched)?.debugId,
      objects: matched,
    });
  }

  return prepared;
}
