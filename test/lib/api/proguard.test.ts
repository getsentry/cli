import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ProguardMapping } from "../../../src/lib/api/proguard.js";
import { buildProguardBundle } from "../../../src/lib/api/proguard.js";

describe("buildProguardBundle", () => {
  // ZIP local file header format: at offset 8 (LE u16) is the
  // compression method (0 = STORED, 8 = DEFLATE). The CLI prefixes
  // every bundle with an 8-byte SYSB SourceBundle header.
  const SYSB_HEADER_BYTES = 8;
  const LOCAL_HEADER_METHOD_OFFSET = SYSB_HEADER_BYTES + 8;

  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "proguard-bundle-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeMapping(
    uuid = "5db7294d-87fc-5726-a5c0-4a90679657a5",
    content = "void\n"
  ): ProguardMapping {
    return {
      path: "/fake/mapping.txt",
      uuid,
      content: Buffer.from(content, "utf-8"),
    };
  }

  test("starts with SYSB magic header", async () => {
    const out = join(tmpDir, "bundle.zip");
    await buildProguardBundle(out, [makeMapping()], {});

    const bytes = await readFile(out);
    // SYSB magic: 53 59 53 42
    expect(bytes.toString("ascii", 0, 4)).toBe("SYSB");
    // Version 2
    expect(bytes.readUInt32LE(4)).toBe(2);
  });

  test("stores entry as proguard/<uuid>.txt", async () => {
    const uuid = "5db7294d-87fc-5726-a5c0-4a90679657a5";
    const out = join(tmpDir, "bundle.zip");
    await buildProguardBundle(out, [makeMapping(uuid)], {
      compression: "stored",
    });

    const bytes = await readFile(out);
    // The entry name should appear in the ZIP file data
    const entryName = `proguard/${uuid}.txt`;
    expect(bytes.includes(Buffer.from(entryName, "utf-8"))).toBe(true);
  });

  test("does not include a manifest.json", async () => {
    const out = join(tmpDir, "bundle.zip");
    await buildProguardBundle(out, [makeMapping()], {
      compression: "stored",
    });

    const bytes = await readFile(out);
    // There should be no manifest.json entry — only proguard/ entries
    expect(bytes.includes(Buffer.from("manifest.json", "utf-8"))).toBe(false);
  });

  test("default compression is DEFLATE", async () => {
    // Use redundant content so DEFLATE has work to do
    const mapping = makeMapping(
      "c038584d-c366-570c-ad1e-034fa0d194d7",
      "line\n".repeat(500)
    );
    const out = join(tmpDir, "bundle-deflate.zip");
    await buildProguardBundle(out, [mapping], {});

    const bytes = await readFile(out);
    expect(bytes.readUInt16LE(LOCAL_HEADER_METHOD_OFFSET)).toBe(8);
  });

  test("compression: 'stored' writes entries uncompressed", async () => {
    const out = join(tmpDir, "bundle-stored.zip");
    await buildProguardBundle(out, [makeMapping()], {
      compression: "stored",
    });

    const bytes = await readFile(out);
    expect(bytes.readUInt16LE(LOCAL_HEADER_METHOD_OFFSET)).toBe(0);
  });

  test("STORED archive contains raw mapping content", async () => {
    const content = "com.example.MyClass -> a:\n    void method() -> b\n";
    const out = join(tmpDir, "bundle-raw.zip");
    await buildProguardBundle(
      out,
      [makeMapping("aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee", content)],
      { compression: "stored" }
    );

    const bytes = await readFile(out);
    expect(bytes.includes(Buffer.from(content, "utf-8"))).toBe(true);
  });

  test("handles multiple mappings in a single ZIP", async () => {
    const uuid1 = "11111111-1111-5111-8111-111111111111";
    const uuid2 = "22222222-2222-5222-8222-222222222222";
    const mappings: ProguardMapping[] = [
      makeMapping(uuid1, "mapping one content"),
      makeMapping(uuid2, "mapping two content"),
    ];

    const out = join(tmpDir, "bundle-multi.zip");
    await buildProguardBundle(out, mappings, { compression: "stored" });

    const bytes = await readFile(out);
    expect(bytes.includes(Buffer.from(`proguard/${uuid1}.txt`))).toBe(true);
    expect(bytes.includes(Buffer.from(`proguard/${uuid2}.txt`))).toBe(true);
    expect(bytes.includes(Buffer.from("mapping one content"))).toBe(true);
    expect(bytes.includes(Buffer.from("mapping two content"))).toBe(true);
  });

  test("STORED archive is larger than DEFLATE for redundant input", async () => {
    const mapping = makeMapping(
      "c038584d-c366-570c-ad1e-034fa0d194d7",
      "com.example.MyClass -> a:\n".repeat(500)
    );

    const deflateOut = join(tmpDir, "bundle-deflate-size.zip");
    const storedOut = join(tmpDir, "bundle-stored-size.zip");
    await buildProguardBundle(deflateOut, [mapping], {});
    await buildProguardBundle(storedOut, [mapping], {
      compression: "stored",
    });

    const deflateSize = (await readFile(deflateOut)).length;
    const storedSize = (await readFile(storedOut)).length;
    expect(storedSize).toBeGreaterThan(deflateSize * 2);
  });
});
