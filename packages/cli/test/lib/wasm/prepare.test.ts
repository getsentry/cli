/**
 * Behavioural tests for WASM debug-file preparation.
 *
 * Note: round-trip and LEB128 invariants live in binary.property.test.ts.
 * These tests cover the prepare decisions — what gets split, stamped, skipped,
 * or left alone — and the on-disk effects of each.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  encodeModule,
  makeBuildIdSection,
  makeCustomSection,
  makeExternalDebugInfoSection,
  parseSections,
  type WasmSection,
  writeVarUint32,
} from "../../../src/lib/wasm/binary.js";
import {
  companionPath,
  debugIdFromBuildId,
  formatBuildId,
  hasDwarfQuality,
  inspectWasm,
  prepareWasmFile,
  splitWasm,
  uploadPath,
  uuidToBytes,
} from "../../../src/lib/wasm/prepare.js";

/** Section id of the Code section. */
const CODE_SECTION_ID = 10;

/** Deterministic build id used where the exact value matters. */
const FIXED_UUID = "00000000-0000-4000-8000-000000000000";

/** Build a non-custom section from a raw payload. */
function rawSection(id: number, payload: Uint8Array): WasmSection {
  const size = writeVarUint32(payload.length);
  const bytes = new Uint8Array(1 + size.length + payload.length);
  bytes[0] = id;
  bytes.set(size, 1);
  bytes.set(payload, 1 + size.length);
  return { id, name: null, contents: null, bytes };
}

/** A stand-in Code section. Contents are opaque to the section-level parser. */
function codeSection(): WasmSection {
  return rawSection(CODE_SECTION_ID, Uint8Array.from([0x00]));
}

/** A DWARF debug section. */
function dwarfSection(): WasmSection {
  return makeCustomSection(".debug_info", Uint8Array.from([0x01, 0x02]));
}

/** A name section. */
function nameSection(): WasmSection {
  return makeCustomSection("name", Uint8Array.from([0x00]));
}

/** Module with inline DWARF: the splittable case. */
function dwarfModule(): Uint8Array {
  return encodeModule([codeSection(), dwarfSection()]);
}

/** Module with DWARF and function names. */
function dwarfAndNamesModule(): Uint8Array {
  return encodeModule([codeSection(), nameSection(), dwarfSection()]);
}

/** Module with function names only: no line-level debug info. */
function nameOnlyModule(): Uint8Array {
  return encodeModule([codeSection(), nameSection()]);
}

/** Module with no debug information at all. */
function emptyModule(): Uint8Array {
  return encodeModule([codeSection()]);
}

/** Module already stripped: a build id but no debug sections. */
function strippedModule(): Uint8Array {
  const buildId = new Uint8Array(16).fill(0x07);
  return encodeModule([codeSection(), makeBuildIdSection(buildId)]);
}

/** Whether a module carries a section with the given custom name. */
function hasSection(bytes: Uint8Array, name: string): boolean {
  return parseSections(bytes).some((section) => section.name === name);
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wasm-prepare-"));
});

afterEach(() => {
  dir = "";
});

/** Write a module into the temp dir and return its path. */
async function writeModule(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

describe("splitWasm", () => {
  test("companion keeps code and DWARF, deployable drops DWARF", () => {
    const result = splitWasm(dwarfModule(), {
      companionFileName: "app.debug.wasm",
    });

    expect(hasSection(result.companion, ".debug_info")).toBe(true);
    expect(hasSection(result.stripped, ".debug_info")).toBe(false);
    // DWARF addresses are relative to the Code section, so the companion is
    // useless without it.
    expect(
      parseSections(result.companion).some((s) => s.id === CODE_SECTION_ID)
    ).toBe(true);
  });

  test("both outputs share one build id", () => {
    const result = splitWasm(dwarfModule(), {
      companionFileName: "app.debug.wasm",
    });

    const strippedId = inspectWasm(result.stripped).buildId;
    const companionId = inspectWasm(result.companion).buildId;
    expect(strippedId).toEqual(result.buildId);
    expect(companionId).toEqual(result.buildId);
  });

  test("deployable points at the companion", () => {
    const result = splitWasm(dwarfModule(), {
      companionFileName: "app.debug.wasm",
    });

    expect(inspectWasm(result.stripped).externalDebugInfo).toBe(
      "app.debug.wasm"
    );
    // The companion is the debug file, not a pointer to one.
    expect(inspectWasm(result.companion).externalDebugInfo).toBeNull();
  });

  test("keeps the name section by default", () => {
    const result = splitWasm(dwarfAndNamesModule(), {
      companionFileName: "app.debug.wasm",
    });

    expect(hasSection(result.stripped, "name")).toBe(true);
  });

  test("strips names from the deployable only when asked", () => {
    const result = splitWasm(dwarfAndNamesModule(), {
      companionFileName: "app.debug.wasm",
      stripNames: true,
    });

    expect(hasSection(result.stripped, "name")).toBe(false);
    expect(hasSection(result.companion, "name")).toBe(true);
  });

  test("preserves an existing build id", () => {
    const existing = uuidToBytes(FIXED_UUID) as Uint8Array;
    const module = encodeModule([
      codeSection(),
      dwarfSection(),
      makeBuildIdSection(existing),
    ]);

    expect(
      splitWasm(module, { companionFileName: "app.debug.wasm" }).buildId
    ).toEqual(existing);
  });
});

/**
 * Golden vectors captured from Symbolicator's `wasm-split` (via `wasmbin`),
 * splitting a module holding a single `.debug_info` section with the build id
 * pinned to {@link FIXED_UUID}.
 *
 * Sentry treats companions from either tool identically, so these bytes are a
 * compatibility contract, not an implementation detail. Decoded, the outputs
 * confirm the two custom-section encodings this module depends on: `build_id`
 * is a length-prefixed byte vector, `external_debug_info` a length-prefixed
 * UTF-8 string.
 */
const WASM_SPLIT_INPUT = "0061736d0100000000100b2e64656275675f696e666f00010203";
const WASM_SPLIT_STRIPPED =
  "0061736d01000000001a086275696c645f6964100000000000004000800000000000000000231365787465726e616c5f64656275675f696e666f0e6170702e64656275672e7761736d";
const WASM_SPLIT_COMPANION =
  "0061736d0100000000100b2e64656275675f696e666f00010203001a086275696c645f69641000000000000040008000000000000000";

/** Decode a hex string into bytes. */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Encode bytes as a lowercase hex string. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("hasDwarfQuality", () => {
  test("counts an external companion pointer as having DWARF", () => {
    // Mirrors DebugQuality::has_dwarf in the Rust CLI: this describes how the
    // module was built, not whether its debug info can be reached. The
    // --require-dwarf gate applies the reachability check on top.
    expect(hasDwarfQuality("dwarf")).toBe(true);
    expect(hasDwarfQuality("external-debug-info")).toBe(true);
    expect(hasDwarfQuality("symtab")).toBe(false);
    expect(hasDwarfQuality("none")).toBe(false);
  });
});

describe("debugIdFromBuildId", () => {
  test("formats a build id as a canonical dashed UUID", () => {
    expect(debugIdFromBuildId("00000000000040008000000000000000")).toBe(
      "00000000-0000-4000-8000-000000000000"
    );
  });

  test("returns undefined for a build id too short to be a UUID", () => {
    expect(debugIdFromBuildId("0011223344")).toBeUndefined();
  });
});

describe("wasm-split compatibility", () => {
  test("produces byte-identical output to wasm-split", () => {
    const result = splitWasm(fromHex(WASM_SPLIT_INPUT), {
      companionFileName: "app.debug.wasm",
      buildId: uuidToBytes(FIXED_UUID) as Uint8Array,
    });

    expect(toHex(result.stripped)).toBe(WASM_SPLIT_STRIPPED);
    expect(toHex(result.companion)).toBe(WASM_SPLIT_COMPANION);
  });

  test("reads back a module wasm-split wrote", () => {
    const inspection = inspectWasm(fromHex(WASM_SPLIT_STRIPPED));

    expect(inspection.quality).toBe("external-debug-info");
    expect(inspection.externalDebugInfo).toBe("app.debug.wasm");
    expect(toHex(inspection.buildId as Uint8Array)).toBe(
      "00000000000040008000000000000000"
    );
  });
});

describe("prepareWasmFile", () => {
  test("splits a module with DWARF", async () => {
    const path = await writeModule("app.wasm", dwarfModule());
    const result = await prepareWasmFile(path);

    expect(result.action).toBe("split");
    expect(result.quality).toBe("dwarf");
    expect(existsSync(companionPath(path))).toBe(true);
    expect(uploadPath(result)).toBe(companionPath(path));
    // The deployable keeps its original path so the build artifact does not move.
    expect(hasSection(await readFile(path), ".debug_info")).toBe(false);
  });

  test("stamps a symtab-only module but uploads nothing", async () => {
    const path = await writeModule("unity.wasm", nameOnlyModule());
    const result = await prepareWasmFile(path);

    expect(result.action).toBe("skipped");
    expect(result.quality).toBe("symtab");
    expect(result.warning).toContain("no line-level");
    expect(existsSync(companionPath(path))).toBe(false);
    // Stamped so a later DWARF build can be matched, but the name section stays
    // readable in the deployable, so there is nothing worth uploading.
    expect(result.buildId).toBeDefined();
    expect(uploadPath(result)).toBeNull();
    expect(inspectWasm(await readFile(path)).buildId).not.toBeNull();
  });

  test("stamps a module with no debug info", async () => {
    const path = await writeModule("app.wasm", emptyModule());
    const result = await prepareWasmFile(path);

    expect(result.action).toBe("skipped");
    expect(result.quality).toBe("none");
    expect(result.warning).toContain("no debug information");
    expect(result.buildId).toBeDefined();
  });

  test("does not re-split a module that only has a build id", async () => {
    const path = await writeModule("app.wasm", strippedModule());
    const result = await prepareWasmFile(path);

    expect(result.action).toBe("skipped");
    expect(result.quality).toBe("none");
    expect(result.warning).toContain("no debug information");
    expect(existsSync(companionPath(path))).toBe(false);
  });

  test("recommends checking build flags when debug info is missing", async () => {
    const missing = await prepareWasmFile(
      await writeModule("empty.wasm", emptyModule())
    );
    const names = await prepareWasmFile(
      await writeModule("names.wasm", nameOnlyModule())
    );

    expect(missing.recommendation).toBe("verify build flags emit DWARF");
    expect(names.recommendation).toBe("verify build flags emit DWARF");
  });

  test("detects an already-prepared pair on a second run", async () => {
    const path = await writeModule("app.wasm", dwarfModule());
    const first = await prepareWasmFile(path);
    const second = await prepareWasmFile(path);

    expect(first.action).toBe("split");
    expect(second.action).toBe("already-prepared");
    expect(second.buildId).toBe(first.buildId);
  });

  test("dry run writes nothing and stamps nothing", async () => {
    const path = await writeModule("app.wasm", dwarfModule());
    const before = await readFile(path);
    const result = await prepareWasmFile(path, { dryRun: true });

    expect(result.action).toBe("would-split");
    expect(existsSync(companionPath(path))).toBe(false);
    expect(await readFile(path)).toEqual(before);
  });

  test("dry run does not stamp a skipped module", async () => {
    const path = await writeModule("unity.wasm", nameOnlyModule());
    const result = await prepareWasmFile(path, { dryRun: true });

    expect(result.action).toBe("skipped");
    expect(result.buildId).toBeUndefined();
    expect(inspectWasm(await readFile(path)).buildId).toBeNull();
  });

  test("uses an explicit build id", async () => {
    const path = await writeModule("app.wasm", dwarfModule());
    const result = await prepareWasmFile(path, {
      buildId: uuidToBytes(FIXED_UUID) as Uint8Array,
    });

    expect(result.buildId).toBe("00000000000040008000000000000000");
  });

  test("out-dir redirects the companion but strips in place", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wasm-out-"));
    const path = await writeModule("app.wasm", dwarfModule());
    const result = await prepareWasmFile(path, { outDir });

    expect(result.companion).toBe(join(outDir, "app.debug.wasm"));
    expect(existsSync(join(outDir, "app.debug.wasm"))).toBe(true);
    expect(existsSync(companionPath(path))).toBe(false);
    // The deployed path is the one that ends up stripped and stamped.
    expect(hasSection(await readFile(path), ".debug_info")).toBe(false);
    expect(inspectWasm(await readFile(path)).buildId).not.toBeNull();
  });

  test("skips a companion given as input", async () => {
    const path = await writeModule("app.debug.wasm", dwarfModule());
    const result = await prepareWasmFile(path);

    expect(result.action).toBe("skipped");
    expect(result.warning).toContain("already a debug companion");
  });

  test("recognizes a companion named by external_debug_info", async () => {
    // A companion whose name does not follow the <stem>.debug.wasm convention
    // is only findable by following the module's own pointer.
    const path = await writeModule("app.wasm", dwarfModule());
    const split = splitWasm(dwarfModule(), {
      companionFileName: "custom-name.wasm",
      buildId: uuidToBytes(FIXED_UUID) as Uint8Array,
    });
    await writeFile(path, split.stripped);
    await writeFile(join(dir, "custom-name.wasm"), split.companion);

    const result = await prepareWasmFile(path);

    expect(result.action).toBe("already-prepared");
    expect(result.quality).toBe("external-debug-info");
    expect(result.companion).toBe(join(dir, "custom-name.wasm"));
  });

  test("ignores a remote external_debug_info URL", async () => {
    const split = splitWasm(dwarfModule(), {
      companionFileName: "https://example.com/app.debug.wasm",
      buildId: uuidToBytes(FIXED_UUID) as Uint8Array,
    });
    const path = await writeModule("app.wasm", split.stripped);

    const result = await prepareWasmFile(path);

    // Nothing local to verify, so it is reported rather than claimed prepared.
    expect(result.action).toBe("skipped");
    expect(result.quality).toBe("external-debug-info");
  });

  test("skips a file that is not a WASM module", async () => {
    const path = join(dir, "not-wasm.wasm");
    await writeFile(path, "definitely not wasm");
    const result = await prepareWasmFile(path);

    expect(result.action).toBe("skipped");
    expect(result.warning).toContain("not a valid WASM module");
  });
});

describe("prepareWasmFile: pairs split by another tool", () => {
  /** Deployable left by a tool that stripped DWARF without stamping a build id. */
  function unstampedModule(companionName: string): Uint8Array {
    return encodeModule([
      codeSection(),
      makeExternalDebugInfoSection(companionName),
    ]);
  }

  /** Companion carrying DWARF, optionally already stamped. */
  function companionModule(buildId?: Uint8Array): Uint8Array {
    const sections = [codeSection(), dwarfSection()];
    if (buildId) {
      sections.push(makeBuildIdSection(buildId));
    }
    return encodeModule(sections);
  }

  /** Write an unstamped module and its companion; return both paths. */
  async function writePair(
    companionBuildId?: Uint8Array
  ): Promise<{ module: string; companion: string }> {
    return {
      module: await writeModule("app.wasm", unstampedModule("app.dbg.wasm")),
      companion: await writeModule(
        "app.dbg.wasm",
        companionModule(companionBuildId)
      ),
    };
  }

  test("adopts the build id the companion already carries", async () => {
    const expected = uuidToBytes(FIXED_UUID) as Uint8Array;
    const { module, companion } = await writePair(expected);
    const before = await readFile(companion);

    const result = await prepareWasmFile(module);

    expect(result.action).toBe("already-prepared");
    expect(result.buildId).toBe(formatBuildId(expected));
    expect(result.companion).toBe(companion);
    expect(result.warning).toBe("reconciled build_id with companion");
    // The module gains the companion's id; the companion is left untouched.
    const stamped = inspectWasm(await readFile(module)).buildId as Uint8Array;
    expect(Uint8Array.from(stamped)).toEqual(expected);
    expect(await readFile(companion)).toEqual(before);
  });

  test("stamps one shared id when neither file has one", async () => {
    const { module, companion } = await writePair();

    const result = await prepareWasmFile(module);

    expect(result.action).toBe("already-prepared");
    expect(result.warning).toContain("stamped both files");

    const moduleId = inspectWasm(await readFile(module)).buildId;
    const companionId = inspectWasm(await readFile(companion)).buildId;
    expect(moduleId).not.toBeNull();
    expect(companionId).toEqual(moduleId);
    expect(result.buildId).toBe(formatBuildId(moduleId as Uint8Array));
  });

  test("uploads the repaired companion", async () => {
    const { module, companion } = await writePair();

    expect(uploadPath(await prepareWasmFile(module))).toBe(companion);
  });

  test("writes nothing on a dry run", async () => {
    const { module, companion } = await writePair();
    const moduleBefore = await readFile(module);
    const companionBefore = await readFile(companion);

    const result = await prepareWasmFile(module, { dryRun: true });

    expect(result.warning).toBe("would reconcile build_id with companion");
    expect(await readFile(module)).toEqual(moduleBefore);
    expect(await readFile(companion)).toEqual(companionBefore);
  });

  test("splits rather than reconciles when DWARF is still inline", async () => {
    // A pointer left by a tool that never stripped the module: the DWARF is
    // right here, so producing a real companion beats adopting a foreign id.
    const module = await writeModule(
      "app.wasm",
      encodeModule([
        codeSection(),
        dwarfSection(),
        makeExternalDebugInfoSection("app.dbg.wasm"),
      ])
    );
    await writeModule("app.dbg.wasm", companionModule());

    const result = await prepareWasmFile(module);

    expect(result.action).toBe("split");
    expect(hasSection(await readFile(module), ".debug_info")).toBe(false);
  });

  test("skips when the companion is missing", async () => {
    const module = await writeModule("app.wasm", unstampedModule("gone.wasm"));

    const result = await prepareWasmFile(module);

    expect(result.action).toBe("skipped");
    expect(result.quality).toBe("external-debug-info");
  });

  test("skips when the companion carries no DWARF", async () => {
    const module = await writeModule("app.wasm", unstampedModule("bare.wasm"));
    await writeModule("bare.wasm", emptyModule());

    const result = await prepareWasmFile(module);

    // Pairing with it would claim an id for a file holding no debug info.
    expect(result.action).toBe("skipped");
    expect(result.quality).toBe("external-debug-info");
  });
});
