/**
 * Tests for reading and stamping the `build_id` custom section.
 *
 * Prepare-level decisions — which modules get stamped, and what is reported —
 * live in prepare.test.ts. These cover the on-disk effects only.
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import {
  encodeModule,
  makeBuildIdSection,
  makeCustomSection,
  parseSections,
} from "../../../src/lib/wasm/binary.js";
import {
  debugIdFromBuildId,
  ensureWasmBuildId,
  formatBuildId,
  readWasmBuildId,
  uuidToBytes,
} from "../../../src/lib/wasm/build-id.js";

/** Deterministic build id used where the exact value matters. */
const FIXED_UUID = "00000000-0000-4000-8000-000000000000";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wasm-build-id-"));
});

/** A section carrying no build id, so the module has something to preserve. */
function fillerSection() {
  return makeCustomSection("name", Uint8Array.from([0x00]));
}

/** Write a module and return its path alongside its parsed sections. */
async function writeModule(name: string, buildId?: Uint8Array) {
  const sections = [fillerSection()];
  if (buildId) {
    sections.push(makeBuildIdSection(buildId));
  }
  const bytes = encodeModule(sections);
  const path = join(dir, name);
  await writeFile(path, bytes);
  return { path, sections: parseSections(bytes) };
}

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

describe("readWasmBuildId", () => {
  test("reads an id the module carries", async () => {
    const expected = uuidToBytes(FIXED_UUID) as Uint8Array;
    const { path } = await writeModule("stamped.wasm", expected);

    const found = await readWasmBuildId(path);

    expect(Uint8Array.from(found as Uint8Array)).toEqual(expected);
  });

  test("returns null for a module with no id", async () => {
    const { path } = await writeModule("bare.wasm");

    expect(await readWasmBuildId(path)).toBeNull();
  });

  test("returns null rather than throwing for a missing file", async () => {
    expect(await readWasmBuildId(join(dir, "absent.wasm"))).toBeNull();
  });

  test("returns null rather than throwing for a non-module", async () => {
    const path = join(dir, "junk.wasm");
    await writeFile(path, "not wasm at all");

    expect(await readWasmBuildId(path)).toBeNull();
  });
});

describe("ensureWasmBuildId", () => {
  test("keeps an id the module already has, without rewriting it", async () => {
    const existing = uuidToBytes(FIXED_UUID) as Uint8Array;
    const { path, sections } = await writeModule("stamped.wasm", existing);
    const before = await readFile(path);

    const result = await ensureWasmBuildId(path, sections, existing, {});

    expect(result).toBe(existing);
    expect(await readFile(path)).toEqual(before);
  });

  test("stamps a module that has none", async () => {
    const { path, sections } = await writeModule("bare.wasm");

    const result = await ensureWasmBuildId(path, sections, null, {});

    expect(result).not.toBeNull();
    const onDisk = await readWasmBuildId(path);
    expect(formatBuildId(onDisk as Uint8Array)).toBe(
      formatBuildId(result as Uint8Array)
    );
  });

  test("uses the id the caller supplied", async () => {
    const requested = uuidToBytes(FIXED_UUID) as Uint8Array;
    const { path, sections } = await writeModule("bare.wasm");

    const result = await ensureWasmBuildId(path, sections, null, {
      buildId: requested,
    });

    expect(result).toBe(requested);
    expect(formatBuildId((await readWasmBuildId(path)) as Uint8Array)).toBe(
      formatBuildId(requested)
    );
  });

  test("writes nothing on a dry run", async () => {
    const { path, sections } = await writeModule("bare.wasm");
    const before = await readFile(path);

    const result = await ensureWasmBuildId(path, sections, null, {
      dryRun: true,
    });

    expect(result).toBeNull();
    expect(await readFile(path)).toEqual(before);
  });

  test("keeps the module's other sections when stamping", async () => {
    const { path, sections } = await writeModule("bare.wasm");

    await ensureWasmBuildId(path, sections, null, {});

    const names = parseSections(await readFile(path)).map((s) => s.name);
    expect(names).toContain("name");
  });
});
