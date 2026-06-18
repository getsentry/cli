/**
 * Debug Information File (DIF) parser.
 *
 * Thin TypeScript API over the `@sentry/symbolic` WASM module. Parses object
 * files (Mach-O/dSYM, ELF, PE/PDB, Portable PDB, WASM, Breakpad, SourceBundle)
 * entirely in-process — no native binary and no dependency on the legacy Rust
 * `sentry-cli`.
 *
 * `@sentry/symbolic` is a build-time (dev) dependency: the JS glue is bundled
 * by esbuild, and the `.wasm` bytes are loaded lazily on first use:
 *   - SEA binary: embedded asset via `node:sea.getRawAsset()`
 *   - npm bundle: the `.wasm` copied next to the bundle at build time
 *   - dev (tsx): resolved from the installed `@sentry/symbolic` package
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  initSync,
  parse_debug_file as wasmParseDebugFile,
  peek_format as wasmPeekFormat,
} from "@sentry/symbolic";
import { logger } from "../logger.js";

const log = logger.withTag("dif");
const _require = createRequire(import.meta.url);

/**
 * SEA asset key for the embedded WASM bytes. Must match the `--assets`
 * argument passed to fossilize in `script/build.ts`.
 */
const DIF_WASM_ASSET_KEY = "dist-build/symbolic_bg.wasm";

/**
 * Package subpath for the WASM file, resolved at runtime only in dev (where
 * `@sentry/symbolic` is installed). It is marked `external` in the esbuild
 * configs (build.ts/bundle.ts), so the bundler never resolves/inlines it.
 */
const SYMBOLIC_WASM_SUBPATH = "@sentry/symbolic/symbolic_bg.wasm";

/** Per-object metadata extracted from a debug information file. */
export type DifObjectInfo = {
  /** Debug identifier (UUID, possibly with an age/appendix suffix). */
  debugId: string;
  /** Code identifier (GNU build-id, PE timestamp+size, etc.), if present. */
  codeId: string | null;
  /** CPU architecture (canonical name, e.g. `x86_64`, `arm64`, `unknown`). */
  arch: string;
  /** Object file format (canonical name, e.g. `elf`, `macho`, `pdb`, `pe`, `breakpad`). */
  fileFormat: string;
  /** Object kind (canonical name, e.g. `exe`, `lib`, `dbg`, `src`). */
  kind: string;
  /** Whether the object contains a symbol table. */
  hasSymbols: boolean;
  /** Whether the object contains debug info (DWARF/CodeView/...). */
  hasDebugInfo: boolean;
  /** Whether the object contains stack-unwind info. */
  hasUnwindInfo: boolean;
  /** Whether the object contains (or embeds) source files. */
  hasSources: boolean;
};

/** Result of parsing a debug information file (archive of one or more objects). */
export type DifArchiveInfo = {
  /** Container format of the archive (canonical name). */
  fileFormat: string;
  /** Objects contained in the archive (e.g. fat Mach-O has one per arch slice). */
  objects: DifObjectInfo[];
};

/**
 * Raw shape returned by the WASM module (snake_case, matching the Rust
 * serialization). Converted to {@link DifArchiveInfo} for the TS API.
 */
type RawArchiveInfo = {
  file_format: string;
  objects: Array<{
    debug_id: string;
    code_id: string | null;
    arch: string;
    file_format: string;
    kind: string;
    has_symbols: boolean;
    has_debug_info: boolean;
    has_unwind_info: boolean;
    has_sources: boolean;
  }>;
};

let initialized = false;

/** Returns the SEA API when running inside a Node SEA binary, else null. */
function isSeaBinary(): { getRawAsset: (key: string) => ArrayBuffer } | null {
  try {
    const sea = _require("node:sea") as {
      isSea?: () => boolean;
      getRawAsset?: (key: string) => ArrayBuffer;
    };
    if (sea.isSea?.() && sea.getRawAsset) {
      return { getRawAsset: sea.getRawAsset };
    }
  } catch (err) {
    log.debug("node:sea unavailable; treating as non-SEA runtime", err);
  }
  return null;
}

/**
 * Load the WASM bytes for the current runtime mode.
 *
 * In a SEA binary the bytes come from the embedded asset (fatal on error — no
 * fallback exists). In the npm bundle the `.wasm` is a sibling copied at build
 * time. In dev it is resolved from the installed `@sentry/symbolic` package.
 */
function loadWasmBytes(): Uint8Array {
  const sea = isSeaBinary();
  if (sea) {
    return new Uint8Array(sea.getRawAsset(DIF_WASM_ASSET_KEY));
  }
  const sibling = new URL("./vendor/symbolic_bg.wasm", import.meta.url);
  if (existsSync(sibling)) {
    return readFileSync(sibling);
  }
  // dev: resolve from the installed @sentry/symbolic package.
  try {
    return readFileSync(_require.resolve(SYMBOLIC_WASM_SUBPATH));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not locate the DIF parser WASM (${SYMBOLIC_WASM_SUBPATH}). ` +
        `Expected it next to the bundle or via @sentry/symbolic: ${msg}`
    );
  }
}

/** Instantiate the WASM module once, lazily. */
function ensureInitialized(): void {
  if (initialized) {
    return;
  }
  initSync({ module: loadWasmBytes() });
  initialized = true;
}

/**
 * Parse a debug information file from an in-memory buffer.
 *
 * @param data - The full contents of the object file.
 * @returns Archive metadata including each contained object's debug id,
 *   code id, architecture, kind, and feature flags.
 * @throws If the buffer cannot be parsed as a known object format.
 */
export function parseDebugFile(data: Uint8Array): DifArchiveInfo {
  ensureInitialized();
  const raw = wasmParseDebugFile(data) as RawArchiveInfo;
  if (!Array.isArray(raw?.objects)) {
    throw new Error(
      "Unexpected response from the DIF parser (missing objects)"
    );
  }
  return {
    fileFormat: raw.file_format,
    objects: raw.objects.map((o) => ({
      debugId: o.debug_id,
      codeId: o.code_id ?? null,
      arch: o.arch,
      fileFormat: o.file_format,
      kind: o.kind,
      hasSymbols: o.has_symbols,
      hasDebugInfo: o.has_debug_info,
      hasUnwindInfo: o.has_unwind_info,
      hasSources: o.has_sources,
    })),
  };
}

/**
 * Detect the object file format without a full parse.
 *
 * @param data - The (possibly partial) contents of the object file.
 * @returns The detected format name (canonical, e.g. `elf`, `macho`, `unknown`).
 */
export function peekFormat(data: Uint8Array): string {
  ensureInitialized();
  return wasmPeekFormat(data);
}
