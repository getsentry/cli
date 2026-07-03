/**
 * Tests for `debug-files find` search logic.
 *
 * Uses the committed PE fixture (a real debug id) and a generated ProGuard
 * mapping (deterministic UUID) — no network, no mocks of the parser.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { findDebugFiles, idHint } from "../../../src/lib/dif/find.js";
import { computeProguardUuid } from "../../../src/lib/proguard.js";

const FIXTURES = join(process.cwd(), "test/fixtures/dif");
// The committed PE fixture's embedded debug id (see check output).
const PE_ID = "d8eb7dca-4883-4b10-a1f7-048ea1ea388b-cfb0fc89";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

describe("idHint", () => {
  test("classifies ids by shape", () => {
    expect(idHint("00000000-0000-6000-0000-000000000000-1")).toBe("likely PDB");
    expect(idHint("00000000-0000-5000-0000-000000000000")).toBe(
      "likely Proguard"
    );
    expect(idHint("00000000-0000-3000-0000-000000000000")).toBe("likely dSYM");
    expect(idHint("00000000-0000-4000-0000-000000000000")).toBe("unknown");
    expect(idHint("00000000-0000-0000-0000-000000000000")).toBe(
      "likely ELF Debug"
    );
  });
});

describe("findDebugFiles", () => {
  test("locates a PE by its exact debug id", async () => {
    const result = await findDebugFiles({ ids: [PE_ID], paths: [FIXTURES] });
    expect(result.missing).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ type: "pe", id: PE_ID });
    expect(result.matches[0].path).toContain("embedded-ppdb.dll");
  });

  test("reports an unmatched id as missing with a hint", async () => {
    const missingId = "ffffffff-0000-0000-0000-000000000000";
    const result = await findDebugFiles({
      ids: [missingId],
      paths: [FIXTURES],
    });
    expect(result.matches).toEqual([]);
    expect(result.missing).toEqual([
      { id: missingId, hint: "likely ELF Debug" },
    ]);
  });

  test("a type filter that excludes PE finds nothing", async () => {
    const result = await findDebugFiles({
      ids: [PE_ID],
      types: ["elf"],
      paths: [FIXTURES],
    });
    expect(result.matches).toEqual([]);
    expect(result.missing.map((m) => m.id)).toEqual([PE_ID]);
  });

  test("locates a ProGuard mapping by its computed UUID", async () => {
    const dir = mkdtempSync(join(tmpdir(), "find-pg-"));
    dirs.push(dir);
    const mapping =
      "com.example.Foo -> a.a:\n" +
      "    int field -> a\n" +
      "    void method() -> a\n";
    const buf = Buffer.from(mapping);
    writeFileSync(join(dir, "mapping.txt"), buf);
    const uuid = computeProguardUuid(buf);

    const result = await findDebugFiles({
      ids: [uuid],
      types: ["proguard"],
      paths: [dir],
    });
    expect(result.missing).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ type: "proguard", id: uuid });
  });

  test("de-duplicates repeated search paths", async () => {
    const result = await findDebugFiles({
      ids: [PE_ID],
      paths: [FIXTURES, FIXTURES],
    });
    expect(result.matches).toHaveLength(1);
  });
});
