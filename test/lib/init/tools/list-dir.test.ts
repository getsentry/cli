import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { listDir } from "../../../../src/lib/init/tools/list-dir.js";
import type {
  DirEntry,
  ListDirPayload,
} from "../../../../src/lib/init/types.js";

function makePayload(
  cwd: string,
  params: ListDirPayload["params"]
): ListDirPayload {
  return {
    type: "tool",
    operation: "list-dir",
    cwd,
    params,
  };
}

function entriesOf(result: Awaited<ReturnType<typeof listDir>>): DirEntry[] {
  if (!result.ok) {
    throw new Error(`expected listDir to succeed, got: ${result.error}`);
  }
  return (result.data as { entries: DirEntry[] }).entries;
}

describe("listDir", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "sentry-listdir-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("lists top-level files + dirs with the right shape", async () => {
    writeFileSync(join(testDir, "index.ts"), "");
    mkdirSync(join(testDir, "src"));

    const entries = entriesOf(
      await listDir(makePayload(testDir, { path: "." }))
    );
    // Order depends on `readdir` behavior (FS-dependent — e.g., ext4
    // returns entries in insertion order while tmpfs and macOS APFS
    // do not). Sort by name for a stable assertion.
    const sorted = entries
      .map((e) => ({ name: e.name, type: e.type }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted).toEqual([
      { name: "index.ts", type: "file" },
      { name: "src", type: "directory" },
    ]);
  });

  test("non-recursive mode does not descend into subdirectories", async () => {
    writeFileSync(join(testDir, "top.ts"), "");
    mkdirSync(join(testDir, "src"));
    writeFileSync(join(testDir, "src", "deep.ts"), "");

    const entries = entriesOf(
      await listDir(makePayload(testDir, { path: ".", recursive: false }))
    );
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toEqual(["src", "top.ts"]);
  });

  test("recursive mode descends into subdirectories up to maxDepth", async () => {
    mkdirSync(join(testDir, "a", "b", "c", "d"), { recursive: true });
    writeFileSync(join(testDir, "a", "level1.ts"), "");
    writeFileSync(join(testDir, "a", "b", "level2.ts"), "");
    writeFileSync(join(testDir, "a", "b", "c", "level3.ts"), "");
    writeFileSync(join(testDir, "a", "b", "c", "d", "level4.ts"), "");

    const entries = entriesOf(
      await listDir(
        makePayload(testDir, { path: ".", recursive: true, maxDepth: 2 })
      )
    );
    const files = entries.filter((e) => e.type === "file").map((e) => e.path);
    // With maxDepth: 2, we enter `a/` (depth 1) and `a/b/` (depth 2), see
    // their files, but we do NOT descend into `a/b/c/`.
    expect(files).toContain("a/level1.ts");
    expect(files).toContain("a/b/level2.ts");
    expect(files).not.toContain("a/b/c/level3.ts");
    expect(files).not.toContain("a/b/c/d/level4.ts");
  });

  test("emits POSIX-separator paths even on nested trees", async () => {
    mkdirSync(join(testDir, "src", "nested"), { recursive: true });
    writeFileSync(join(testDir, "src", "nested", "deep.ts"), "");

    const entries = entriesOf(
      await listDir(makePayload(testDir, { path: ".", recursive: true }))
    );
    for (const entry of entries) {
      expect(entry.path).not.toContain("\\");
    }
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toContain("src/nested/deep.ts");
  });

  test("includes hidden entries and node_modules at the surface level", async () => {
    writeFileSync(join(testDir, ".env"), "");
    mkdirSync(join(testDir, ".cache"));
    mkdirSync(join(testDir, "node_modules"));

    const entries = entriesOf(
      await listDir(makePayload(testDir, { path: ".", recursive: true }))
    );
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual([".cache", ".env", "node_modules"]);
  });

  test("does NOT recurse into hidden dirs or node_modules", async () => {
    mkdirSync(join(testDir, ".cache"));
    writeFileSync(join(testDir, ".cache", "inside.ts"), "");
    mkdirSync(join(testDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(testDir, "node_modules", "pkg", "index.js"), "");

    const entries = entriesOf(
      await listDir(makePayload(testDir, { path: ".", recursive: true }))
    );
    const paths = entries.map((e) => e.path);
    expect(paths).toContain(".cache");
    expect(paths).toContain("node_modules");
    expect(paths).not.toContain(".cache/inside.ts");
    expect(paths).not.toContain("node_modules/pkg");
  });

  test("applies maxEntries as a hard cap", async () => {
    for (let i = 0; i < 20; i += 1) {
      writeFileSync(join(testDir, `f${i.toString().padStart(2, "0")}.ts`), "");
    }

    const entries = entriesOf(
      await listDir(makePayload(testDir, { path: ".", maxEntries: 5 }))
    );
    expect(entries).toHaveLength(5);
  });

  test("throws on sandbox escape via `..`", async () => {
    await expect(
      listDir(makePayload(testDir, { path: "../../etc" }))
    ).rejects.toThrow(/outside project directory/);
  });

  test("includes safe symlinks (pointing inside the sandbox)", async () => {
    const realPath = join(testDir, "real.ts");
    const linkPath = join(testDir, "link.ts");
    writeFileSync(realPath, "");
    try {
      symlinkSync(realPath, linkPath, "file");
    } catch {
      // Symlinks may not be creatable (Windows without dev mode) — skip.
      return;
    }

    const entries = entriesOf(
      await listDir(makePayload(testDir, { path: "." }))
    );
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["link.ts", "real.ts"]);
  });

  test("skips symlinks that escape the sandbox", async () => {
    writeFileSync(join(testDir, "real.ts"), "");
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    const linkPath = join(testDir, "escape");
    try {
      symlinkSync(outside, linkPath, "dir");
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return;
    }

    try {
      const entries = entriesOf(
        await listDir(makePayload(testDir, { path: "." }))
      );
      expect(entries.map((e) => e.name)).not.toContain("escape");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("returns empty entries for a missing subpath", async () => {
    // `safePath` allows nonexistent paths under the sandbox; `readdir`
    // throws, which the walker swallows.
    const entries = entriesOf(
      await listDir(makePayload(testDir, { path: "does-not-exist" }))
    );
    expect(entries).toEqual([]);
  });
});
